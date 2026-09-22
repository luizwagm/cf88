/* ==========================================================================
   armazem.js — o caderno que funciona sem internet.

   LOCAL PRIMEIRO. O tablet guarda no IndexedDB uma cópia do texto (páginas
   da Constituição), das anotações de cada página, das preferências e do
   resumo. Toda leitura tenta a rede e, falhando, serve a cópia. Toda
   escrita entra numa FILA persistente (ordem garantida) que é esvaziada
   quando a rede volta — e o espelho local já reflete a mudança na hora,
   então a tela nunca "desfaz" o que o estudante acabou de escrever.

   Como a fila é reenviada na ordem e os ids nascem no cliente, reenviar
   duas vezes não duplica nada (o servidor ignora id repetido).
   ========================================================================== */
import { api, ErroApi } from "./api.js";

const NOME_BD = "lacarta";
const VERSAO_BD = 1;
let bdPromessa = null;
const memoria = new Map();      // reserva quando o IndexedDB não existe (aba anônima)
let semIndexedDb = false;

function abrir() {
  if (bdPromessa) return bdPromessa;
  bdPromessa = new Promise((resolver, rejeitar) => {
    if (!("indexedDB" in window)) { semIndexedDb = true; return resolver(null); }
    const pedido = indexedDB.open(NOME_BD, VERSAO_BD);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("fila")) db.createObjectStore("fila", { keyPath: "n", autoIncrement: true });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => { semIndexedDb = true; resolver(null); };
    pedido.onblocked = () => rejeitar(new Error("IndexedDB bloqueado por outra aba."));
  });
  return bdPromessa;
}

function transacao(loja, modo, fn) {
  return abrir().then((db) => new Promise((resolver, rejeitar) => {
    if (!db) return resolver(fn(null));
    const t = db.transaction(loja, modo);
    const r = fn(t.objectStore(loja));
    t.oncomplete = () => resolver(r && "result" in r ? r.result : r);
    t.onerror = () => rejeitar(t.error);
    t.onabort = () => rejeitar(t.error);
  }));
}

/* ---------- chave/valor ---------- */
export async function obter(chave) {
  if (semIndexedDb) return memoria.get(chave);
  const r = await transacao("kv", "readonly", (loja) => (loja ? loja.get(chave) : { result: memoria.get(chave) }));
  return r;
}
export async function guardar(chave, valor) {
  memoria.set(chave, valor);
  if (semIndexedDb) return;
  await transacao("kv", "readwrite", (loja) => loja && loja.put(valor, chave));
}
export async function apagar(chave) {
  memoria.delete(chave);
  if (semIndexedDb) return;
  await transacao("kv", "readwrite", (loja) => loja && loja.delete(chave));
}
export async function chaves(prefixo) {
  if (semIndexedDb) return [...memoria.keys()].filter((k) => k.startsWith(prefixo));
  const todas = await transacao("kv", "readonly", (loja) => loja.getAllKeys());
  return (todas || []).filter((k) => typeof k === "string" && k.startsWith(prefixo));
}
export async function limparTudo() {
  memoria.clear();
  if (semIndexedDb) return;
  await transacao("kv", "readwrite", (loja) => loja && loja.clear());
  await transacao("fila", "readwrite", (loja) => loja && loja.clear());
}

/* ---------- estado da rede e ouvintes ---------- */
const ouvintes = new Set();
export const estado = { online: typeof navigator === "undefined" ? true : navigator.onLine, pendentes: 0, baixadoEm: null, enviando: false };
export function aoMudarEstado(fn) { ouvintes.add(fn); fn(estado); return () => ouvintes.delete(fn); }
function notificar() { for (const fn of ouvintes) { try { fn(estado); } catch { /* ouvinte quebrado não derruba os outros */ } } }
function marcarOnline(v) { if (estado.online !== v) { estado.online = v; notificar(); } }

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { marcarOnline(true); void esvaziar(); });
  window.addEventListener("offline", () => marcarOnline(false));
  setInterval(() => { if (estado.pendentes > 0) void esvaziar(); }, 30_000);
}

/* ---------- fila de escrita ---------- */
const filaMemoria = [];
let proximoN = 1;

async function listarFila() {
  if (semIndexedDb) return [...filaMemoria];
  return (await transacao("fila", "readonly", (loja) => loja.getAll())) || [];
}
async function gravarOp(op) {
  if (semIndexedDb) {
    if (!op.n) op.n = proximoN++;
    const i = filaMemoria.findIndex((x) => x.n === op.n);
    if (i >= 0) filaMemoria[i] = op; else filaMemoria.push(op);
    return;
  }
  await transacao("fila", "readwrite", (loja) => loja.put(op));
}
async function removerOp(n) {
  if (semIndexedDb) { const i = filaMemoria.findIndex((x) => x.n === n); if (i >= 0) filaMemoria.splice(i, 1); return; }
  await transacao("fila", "readwrite", (loja) => loja.delete(n));
}
async function contarFila() {
  estado.pendentes = (await listarFila()).length;
  notificar();
}

/* Enfileira uma escrita e tenta enviar já. `chave` coalesce: a posição de
   leitura da mesma página e as preferências não precisam de dez envios. */
export async function mutar({ metodo, caminho, corpo, chave = null, modo = "substituir" }) {
  let op = { metodo, caminho, corpo, chave, criado_em: new Date().toISOString() };
  if (chave) {
    const existente = (await listarFila()).find((x) => x.chave === chave);
    if (existente) {
      op = { ...existente, caminho, corpo: modo === "mesclar" ? { ...existente.corpo, ...corpo } : corpo };
    }
  }
  await gravarOp(op);
  await contarFila();
  void esvaziar();
}

let esvaziando = null;
export function esvaziar() {
  if (esvaziando) return esvaziando;
  esvaziando = (async () => {
    estado.enviando = true;
    try {
      const ops = (await listarFila()).sort((a, b) => a.n - b.n);
      for (const op of ops) {
        try {
          await api.requisicao(op.metodo, op.caminho, op.corpo);
          await removerOp(op.n);
          marcarOnline(true);
        } catch (e) {
          if (e.status === 0) { marcarOnline(false); break; }         // sem rede: fica para depois
          if (e.status === 401 || e.status === 429 || e.status >= 500) break;   // sessão, freio ou servidor: tenta depois
          /* 400/403/404: a operação é inválida ou já foi aplicada (apagar o
             que não existe). Descartar é o certo — reenviar não vai mudar. */
          console.warn("fila: operação descartada", op.metodo, op.caminho, e.message);
          await removerOp(op.n);
        }
      }
    } finally {
      estado.enviando = false;
      esvaziando = null;
      await contarFila();
    }
  })();
  return esvaziando;
}

/* ---------- leitura com reserva local ---------- */
export async function ler(caminho, chave, opcoes = {}) {
  if (!opcoes.semFila) await esvaziar();
  try {
    const dados = await api.get(caminho);
    marcarOnline(true);
    await guardar(chave, dados);
    return dados;
  } catch (e) {
    if (e.status !== 0) throw e;
    marcarOnline(false);
    const local = await obter(chave);
    if (local !== undefined) return local;
    throw new ErroApi(0, opcoes.semCopia || "Sem internet e sem cópia local disto. Baixe o caderno para uso offline quando estiver conectado.");
  }
}

/* ---------- leitores de alto nível ---------- */
export const lerSumario = () => ler("/api/v1/texto/sumario", "texto:sumario");
export const lerPagina = (id) => ler(`/api/v1/texto/paginas/${encodeURIComponent(id)}`, `texto:pagina:${id}`, { semCopia: "Esta página ainda não foi baixada para uso offline." });
export const lerAnotacoes = (id) => ler(`/api/v1/paginas/${encodeURIComponent(id)}/anotacoes`, `anot:${id}`).catch(async (e) => {
  if (e.status !== 0) throw e;
  return { pagina_id: id, tracos: [], marcacoes: [], notas: [], leitura: null };
});
export const lerPrefs = () => ler("/api/v1/preferencias", "prefs");
export const lerEu = () => ler("/api/v1/eu", "eu");
export const guardarAnotacoes = (id, dados) => guardar(`anot:${id}`, dados);
export async function removerDoEspelho(paginaId, lista, itemId) {
  const a = await obter(`anot:${paginaId}`);
  if (a && Array.isArray(a[lista])) { a[lista] = a[lista].filter((x) => x.id !== itemId); await guardar(`anot:${paginaId}`, a); }
  const rev = await obter("revisao");
  if (rev && Array.isArray(rev.itens)) { rev.itens = rev.itens.filter((x) => x.id !== itemId); await guardar("revisao", rev); }
  const res = await obter("resumo");
  if (res && Array.isArray(res.paginas)) {
    const p = res.paginas.find((x) => x.pagina_id === paginaId);
    if (p) p[lista] = Math.max(0, (p[lista] ?? 1) - 1);
    if (res.contagens) res.contagens[lista] = Math.max(0, (res.contagens[lista] ?? 1) - 1);
    await guardar("resumo", res);
  }
}

export async function lerResumo(sumario) {
  try { return await ler("/api/v1/resumo", "resumo"); }
  catch (e) { if (e.status !== 0) throw e; return resumoLocal(sumario); }
}
export async function lerRevisao(sumario) {
  try { return await ler("/api/v1/anotacoes", "revisao"); }
  catch (e) { if (e.status !== 0) throw e; return revisaoLocal(sumario); }
}

/* Resumo montado do espelho local: o que o tablet sabe sem perguntar. */
export async function resumoLocal(sumario) {
  const paginas = [];
  const contagens = { tracos: 0, marcacoes: 0, notas: 0 };
  let ultima = null;
  for (const k of await chaves("anot:")) {
    const a = await obter(k);
    if (!a) continue;
    const p = sumario?.paginas.find((x) => x.id === a.pagina_id);
    const item = {
      pagina_id: a.pagina_id, tracos: a.tracos?.length ?? 0, marcacoes: a.marcacoes?.length ?? 0, notas: a.notas?.length ?? 0,
      visitas: a.leitura?.visitas ?? 0, posicao: a.leitura?.posicao ?? 0, ultima_em: a.leitura?.ultima_em ?? null,
      ordem: p?.ordem ?? 0, rotulo: p?.rotulo ?? a.pagina_id, nome: p?.nome ?? "", livro: p?.livro ?? "", trilha: (p?.trilha ?? []).map((t) => t.rotulo).join(" › "),
    };
    contagens.tracos += item.tracos; contagens.marcacoes += item.marcacoes; contagens.notas += item.notas;
    if (item.tracos + item.marcacoes + item.notas > 0 || item.visitas > 0) paginas.push(item);
    if (item.ultima_em && (!ultima || item.ultima_em > ultima.ultima_em)) ultima = item;
  }
  paginas.sort((a, b) => a.ordem - b.ordem);
  return {
    offline: true, atualizado_ate: sumario?.atualizado_ate ?? "", total_paginas: sumario?.paginas.length ?? 0,
    paginas_lidas: paginas.filter((p) => p.visitas > 0).length, contagens,
    ultima: ultima ? { pagina_id: ultima.pagina_id, posicao: ultima.posicao, ultima_em: ultima.ultima_em, rotulo: ultima.rotulo, nome: ultima.nome, trilha: ultima.trilha } : null,
    paginas,
  };
}

export async function revisaoLocal(sumario) {
  const itens = [];
  for (const k of await chaves("anot:")) {
    const a = await obter(k);
    if (!a) continue;
    const p = sumario?.paginas.find((x) => x.id === a.pagina_id);
    const pagina = await obter(`texto:pagina:${a.pagina_id}`);
    const ordemDisp = [];
    const refs = new Map();
    if (pagina) for (const art of pagina.artigos) for (const d of art.dispositivos) { ordemDisp.push(d.id); refs.set(d.id, d.rotulo ? `${art.rotulo}, ${d.rotulo}` : art.rotulo); }
    const base = (tipo, m) => ({
      tipo, ...m, pagina_id: a.pagina_id, ordem: p?.ordem ?? 0, posicao: ordemDisp.indexOf(m.dispositivo_id),
      referencia: refs.get(m.dispositivo_id) ?? m.dispositivo_id, pagina_rotulo: p?.rotulo ?? "", pagina_nome: p?.nome ?? "",
    });
    for (const m of a.marcacoes ?? []) itens.push(base("marcacao", m));
    for (const n of a.notas ?? []) itens.push(base("nota", n));
  }
  itens.sort((x, y) => x.ordem - y.ordem || x.posicao - y.posicao || String(x.criado_em).localeCompare(String(y.criado_em)));
  return { offline: true, itens };
}

/* Busca na cópia local (todas as palavras, sem acento) — a reserva da busca do servidor. */
const normalizar = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export async function buscarLocal(consulta, limite = 60) {
  const termos = normalizar(consulta).split(" ").filter((t) => t.length >= 2);
  const itens = [];
  let total = 0, paginasLidas = 0;
  if (!termos.length) return { offline: true, total, itens, paginas: 0, artigo: null };
  for (const k of await chaves("texto:pagina:")) {
    const p = await obter(k);
    if (!p) continue;
    paginasLidas += 1;
    for (const a of p.artigos) for (const d of a.dispositivos) {
      const n = normalizar(d.texto);
      if (!termos.every((t) => n.includes(t))) continue;
      total += 1;
      if (itens.length >= limite) continue;
      const pos = n.indexOf(termos[0]);
      const inicio = Math.max(0, pos - 70), fim = Math.min(d.texto.length, pos + termos[0].length + 110);
      itens.push({
        pagina_id: p.id, pagina_rotulo: p.rotulo, pagina_nome: p.nome, trilha: p.trilha.map((t) => t.rotulo).join(" › "),
        artigo_id: a.id, artigo_rotulo: a.rotulo, dispositivo_id: d.id, dispositivo_rotulo: d.rotulo,
        trecho: (inicio > 0 ? "…" : "") + d.texto.slice(inicio, fim) + (fim < d.texto.length ? "…" : ""),
      });
    }
  }
  itens.sort((x, y) => x.pagina_id.localeCompare(y.pagina_id));
  return { offline: true, total, itens, paginas: paginasLidas, artigo: acharArtigoNoSumario(consulta, await obter("texto:sumario")) };
}

/* "art 5", "37", "adct 2", "103-A" → a página do sumário que lista o artigo. */
export function acharArtigoNoSumario(consulta, sumario) {
  if (!sumario) return null;
  const q = normalizar(consulta);
  const m = /^(?:(adct)\s*)?(?:art\.?s?\.?\s*)?(\d{1,3})\s*(?:-\s*)?([a-e])?\b(?:\s*(?:do\s+)?(adct))?/.exec(q);
  if (!m) return null;
  const livro = m[1] || m[4] ? "adct" : "cf";
  const numero = Number(m[2]);
  const sufixo = m[3] ? `-${m[3].toUpperCase()}` : "";
  const rotulo = `Art. ${numero}${numero < 10 ? "º" : ""}${sufixo}`;
  const p = sumario.paginas.find((x) => x.livro === livro && x.artigos.includes(rotulo));
  if (!p) return null;
  return { pagina_id: p.id, artigo_id: `${livro}-art-${numero}${sufixo.toLowerCase()}`, rotulo };
}

/* ---------- baixar tudo para uso offline ---------- */
export async function baixarTudo(aoProgredir = () => {}) {
  await esvaziar();
  const s = await api.get("/api/v1/texto/sumario");
  await guardar("texto:sumario", s);
  const versaoTexto = await obter("texto:versao");
  const total = s.paginas.length;
  let feitas = 0;
  const lista = [...s.paginas];
  const trabalhador = async () => {
    while (lista.length) {
      const p = lista.shift();
      const pedidos = [api.get(`/api/v1/paginas/${encodeURIComponent(p.id)}/anotacoes`).then((a) => guardar(`anot:${p.id}`, a))];
      if (versaoTexto !== s.atualizado_ate || !(await obter(`texto:pagina:${p.id}`))) {
        pedidos.push(api.get(`/api/v1/texto/paginas/${encodeURIComponent(p.id)}`).then((t) => guardar(`texto:pagina:${p.id}`, t)));
      }
      await Promise.all(pedidos);
      feitas += 1;
      aoProgredir(feitas, total, p);
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  await guardar("texto:versao", s.atualizado_ate);
  for (const [caminho, chave] of [["/api/v1/preferencias", "prefs"], ["/api/v1/eu", "eu"], ["/api/v1/resumo", "resumo"], ["/api/v1/anotacoes", "revisao"]]) {
    await guardar(chave, await api.get(caminho));
  }
  estado.baixadoEm = new Date().toISOString();
  await guardar("meta:baixado_em", estado.baixadoEm);
  notificar();
  return { paginas: total };
}

export async function iniciarArmazem() {
  estado.baixadoEm = (await obter("meta:baixado_em")) ?? null;
  await contarFila();
  void esvaziar();
}

export const novoIdLocal = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
