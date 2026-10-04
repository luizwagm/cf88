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
/* A Constituição guarda o sumário na chave antiga ("texto:sumario"): quem já
   tinha a cópia offline continua com ela. As demais obras ganham a sua. */
const chaveSumario = (obra) => (!obra || obra === "cf" ? "texto:sumario" : `texto:sumario:${obra}`);
export const lerObras = () => ler("/api/v1/texto/obras", "texto:obras");
export const lerSumario = (obra = "cf") => ler(`/api/v1/texto/sumario?obra=${encodeURIComponent(obra)}`, chaveSumario(obra), { semCopia: "Esta lei ainda não foi baixada para uso offline." });
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

export async function lerResumo() {
  try { return await ler("/api/v1/resumo", "resumo"); }
  catch (e) { if (e.status !== 0) throw e; return resumoLocal(); }
}
export async function lerRevisao() {
  try { return await ler("/api/v1/anotacoes", "revisao"); }
  catch (e) { if (e.status !== 0) throw e; return revisaoLocal(); }
}

/* O que o tablet sabe das páginas sem perguntar ao servidor: junta os
   sumários que já estão guardados (um por obra) num mapa página → dados. */
async function paginasConhecidas() {
  const cat = (await obter("texto:obras")) ?? { obras: [] };
  const mapa = new Map();
  const obrasLocais = [];
  for (const k of ["texto:sumario", ...(await chaves("texto:sumario:"))]) {
    const s = await obter(k);
    if (!s) continue;
    const id = s.obra?.id ?? "cf";
    const meta = cat.obras.find((o) => o.id === id) ?? s.obra ?? { id, sigla: id === "cf" ? "CF/88" : id.toUpperCase(), nome: "", paginas: s.paginas.length, ordem: 0 };
    const ordemObra = cat.obras.findIndex((o) => o.id === id);
    obrasLocais.push(meta);
    for (const p of s.paginas) mapa.set(p.id, { ...p, obra_id: id, obra_sigla: meta.sigla, ordemGlobal: (ordemObra < 0 ? 0 : ordemObra) * 100000 + p.ordem });
  }
  return { mapa, obras: obrasLocais, catalogo: cat };
}

/* Resumo montado do espelho local. */
export async function resumoLocal() {
  const { mapa, obras, catalogo } = await paginasConhecidas();
  const paginas = [];
  const contagens = { tracos: 0, marcacoes: 0, notas: 0 };
  let ultima = null;
  for (const k of await chaves("anot:")) {
    const a = await obter(k);
    if (!a) continue;
    const p = mapa.get(a.pagina_id);
    const item = {
      pagina_id: a.pagina_id, tracos: a.tracos?.length ?? 0, marcacoes: a.marcacoes?.length ?? 0, notas: a.notas?.length ?? 0,
      visitas: a.leitura?.visitas ?? 0, posicao: a.leitura?.posicao ?? 0, ultima_em: a.leitura?.ultima_em ?? null,
      ordem: p?.ordemGlobal ?? 0, rotulo: p?.rotulo ?? a.pagina_id, nome: p?.nome ?? "", livro: p?.livro ?? "",
      obra_id: p?.obra_id ?? "", obra_sigla: p?.obra_sigla ?? "", trilha: (p?.trilha ?? []).map((t) => t.rotulo).join(" › "),
    };
    contagens.tracos += item.tracos; contagens.marcacoes += item.marcacoes; contagens.notas += item.notas;
    if (item.tracos + item.marcacoes + item.notas > 0 || item.visitas > 0) paginas.push(item);
    if (item.ultima_em && (!ultima || item.ultima_em > ultima.ultima_em)) ultima = item;
  }
  paginas.sort((a, b) => a.ordem - b.ordem);
  const porObra = new Map();
  for (const it of paginas) {
    if (!it.obra_id) continue;
    const o = obras.find((x) => x.id === it.obra_id);
    const e = porObra.get(it.obra_id) ?? { obra_id: it.obra_id, sigla: it.obra_sigla, nome: o?.nome ?? "", total: o?.paginas ?? 0, lidas: 0, tracos: 0, marcacoes: 0, notas: 0, ultima_em: null, ultima_pagina: null };
    if (it.visitas > 0) e.lidas += 1;
    e.tracos += it.tracos; e.marcacoes += it.marcacoes; e.notas += it.notas;
    if (it.ultima_em && (!e.ultima_em || it.ultima_em > e.ultima_em)) { e.ultima_em = it.ultima_em; e.ultima_pagina = it.pagina_id; }
    porObra.set(it.obra_id, e);
  }
  return {
    offline: true, atualizado_ate: "", total_paginas: mapa.size, total_obras: catalogo.obras.length,
    paginas_lidas: paginas.filter((p) => p.visitas > 0).length, contagens, obras: [...porObra.values()],
    ultima: ultima ? { pagina_id: ultima.pagina_id, posicao: ultima.posicao, ultima_em: ultima.ultima_em, rotulo: ultima.rotulo, nome: ultima.nome, trilha: ultima.trilha, obra_id: ultima.obra_id, obra_sigla: ultima.obra_sigla } : null,
    paginas,
  };
}

export async function revisaoLocal() {
  const { mapa } = await paginasConhecidas();
  const itens = [];
  for (const k of await chaves("anot:")) {
    const a = await obter(k);
    if (!a) continue;
    if (!(a.marcacoes?.length || a.notas?.length)) continue;
    const p = mapa.get(a.pagina_id);
    const pagina = await obter(`texto:pagina:${a.pagina_id}`);
    const ordemDisp = [];
    const refs = new Map();
    if (pagina) for (const art of pagina.artigos) for (const d of art.dispositivos) { ordemDisp.push(d.id); refs.set(d.id, d.rotulo ? `${art.rotulo}, ${d.rotulo}` : art.rotulo); }
    const base = (tipo, m) => ({
      tipo, ...m, pagina_id: a.pagina_id, ordem: p?.ordemGlobal ?? 0, posicao: ordemDisp.indexOf(m.dispositivo_id),
      referencia: refs.get(m.dispositivo_id) ?? m.dispositivo_id, pagina_rotulo: p?.rotulo ?? "", pagina_nome: p?.nome ?? "",
      obra_id: p?.obra_id ?? "", obra_sigla: p?.obra_sigla ?? "",
    });
    for (const m of a.marcacoes ?? []) itens.push(base("marcacao", m));
    for (const n of a.notas ?? []) itens.push(base("nota", n));
  }
  itens.sort((x, y) => x.ordem - y.ordem || x.posicao - y.posicao || String(x.criado_em).localeCompare(String(y.criado_em)));
  return { offline: true, itens };
}

/* Busca na cópia local (todas as palavras, sem acento) — a reserva da busca do servidor. */
const normalizar = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export async function buscarLocal(consulta, obraFiltro = "", limite = 60) {
  const termos = normalizar(consulta).split(" ").filter((t) => t.length >= 2);
  const itens = [];
  const contagem = new Map();
  let total = 0, paginasLidas = 0;
  if (!termos.length) return { offline: true, total, itens, paginas: 0, artigo: null, por_obra: [] };
  const { mapa } = await paginasConhecidas();
  for (const k of await chaves("texto:pagina:")) {
    const p = await obter(k);
    if (!p) continue;
    const info = mapa.get(p.id);
    const obraId = info?.obra_id ?? p.obra ?? "cf";
    if (obraFiltro && obraId !== obraFiltro) continue;
    paginasLidas += 1;
    for (const a of p.artigos) for (const d of a.dispositivos) {
      const n = normalizar(d.texto);
      if (!termos.every((t) => n.includes(t))) continue;
      total += 1;
      const c = contagem.get(obraId) ?? { obra_id: obraId, obra_sigla: info?.obra_sigla ?? obraId.toUpperCase(), total: 0 };
      c.total += 1; contagem.set(obraId, c);
      if (itens.length >= limite) continue;
      const pos = n.indexOf(termos[0]);
      const inicio = Math.max(0, pos - 70), fim = Math.min(d.texto.length, pos + termos[0].length + 110);
      itens.push({
        obra_id: obraId, obra_sigla: info?.obra_sigla ?? obraId.toUpperCase(), ordem: info?.ordemGlobal ?? 0,
        pagina_id: p.id, pagina_rotulo: p.rotulo, pagina_nome: p.nome, trilha: p.trilha.map((t) => t.rotulo).join(" › "),
        artigo_id: a.id, artigo_rotulo: a.rotulo, dispositivo_id: d.id, dispositivo_rotulo: d.rotulo,
        trecho: (inicio > 0 ? "…" : "") + d.texto.slice(inicio, fim) + (fim < d.texto.length ? "…" : ""),
      });
    }
  }
  itens.sort((x, y) => x.ordem - y.ordem);
  const s = await obter(chaveSumario(obraFiltro || "cf"));
  const salto = acharArtigoNoSumario(consulta, s);
  return { offline: true, total, itens, paginas: paginasLidas, artigo: salto ? { ...salto, obra_sigla: s?.obra?.sigla ?? "CF/88" } : null, por_obra: [...contagem.values()].sort((a, b) => b.total - a.total) };
}

/* "art 5", "37", "adct 2", "103-A", "1.639" → a página do sumário (da obra
   aberta) que lista o artigo. É o salto que funciona sem internet. */
export function acharArtigoNoSumario(consulta, sumario) {
  if (!sumario) return null;
  const obraId = sumario.obra?.id ?? "cf";
  const q = normalizar(consulta).replace(/[º°ª]/g, "");
  const m = /^(?:(adct)\s*)?(?:arts?\.?\s*)?(\d{1,4}(?:\.\d{3})?)\s*(?:-\s*|\s+)?([a-z]{1,2}(?:-[a-z])?)?\b(?:\s*(?:do\s+)?(adct))?/.exec(q);
  if (!m) return null;
  const livro = obraId !== "cf" ? obraId : (m[1] || m[4] ? "adct" : "cf");
  const numero = Number(m[2].replace(".", ""));
  const sufixo = m[3] && m[3] !== "do" ? `-${m[3].toUpperCase()}` : "";
  const n = numero >= 1000 ? `${Math.floor(numero / 1000)}.${String(numero % 1000).padStart(3, "0")}` : String(numero);
  const rotulo = `Art. ${n}${numero < 10 ? "º" : ""}${sufixo}`;
  const rotuloDe = (a) => (typeof a === "string" ? a : a.rotulo);
  const p = sumario.paginas.find((x) => x.livro === livro && x.artigos.some((a) => rotuloDe(a) === rotulo));
  if (!p) return null;
  const achado = p.artigos.find((a) => rotuloDe(a) === rotulo);
  return { pagina_id: p.id, artigo_id: (achado && achado.id) || `${livro}-art-${numero}${sufixo.toLowerCase()}`, rotulo };
}

/* ---------- baixar para uso offline, lei por lei ---------- */
export async function obrasBaixadas() {
  const ids = (await chaves("meta:baixado:")).map((k) => k.slice("meta:baixado:".length));
  /* quem baixou "tudo" quando só existia a Constituição */
  if (!ids.includes("cf") && (await obter("meta:baixado_em"))) ids.push("cf");
  return ids;
}

/* Baixa as obras pedidas: o texto inteiro de cada uma vem numa resposta só;
   das anotações, só as páginas que têm alguma (o resumo diz quais). */
export async function baixarObras(ids, aoProgredir = () => {}) {
  await esvaziar();
  const cat = await api.get("/api/v1/texto/obras");
  await guardar("texto:obras", cat);
  const resumo = await api.get("/api/v1/resumo");
  await guardar("resumo", resumo);
  const agora = new Date().toISOString();
  let feitas = 0, paginas = 0;
  for (const id of ids) {
    const meta = cat.obras.find((o) => o.id === id);
    aoProgredir(feitas, ids.length, meta, "texto");
    const completo = await api.requisicao("GET", `/api/v1/texto/obras/${encodeURIComponent(id)}/completo`, undefined, { tempoLimite: 90_000 });
    await guardar(chaveSumario(id), completo.sumario);
    for (const p of completo.paginas) await guardar(`texto:pagina:${p.id}`, p);
    paginas += completo.paginas.length;
    const anotadas = resumo.paginas.filter((p) => p.obra_id === id);
    for (const p of anotadas) {
      await guardar(`anot:${p.pagina_id}`, await api.get(`/api/v1/paginas/${encodeURIComponent(p.pagina_id)}/anotacoes`));
    }
    await guardar(`meta:baixado:${id}`, agora);
    feitas += 1;
    aoProgredir(feitas, ids.length, meta, "pronto");
  }
  for (const [caminho, chave] of [["/api/v1/preferencias", "prefs"], ["/api/v1/eu", "eu"], ["/api/v1/anotacoes", "revisao"]]) {
    await guardar(chave, await api.get(caminho));
  }
  estado.baixadoEm = agora;
  await guardar("meta:baixado_em", agora);
  notificar();
  return { obras: feitas, paginas };
}

export async function iniciarArmazem() {
  estado.baixadoEm = (await obter("meta:baixado_em")) ?? null;
  await contarFila();
  void esvaziar();
}

export const novoIdLocal = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
