/* ==========================================================================
   app.js — boot, login, barra do topo, gaveta do sumário, roteamento por
   hash, instalação no tablet (PWA) e o estado da rede.

   O boot tenta a rede; sem ela, abre com a cópia local (usuário, sumário e
   preferências guardados no armazém). O login em si precisa de rede — mas
   a sessão dura 60 dias, então o tablet raramente vai precisar dele.
   ========================================================================== */
import { api, definirQuedaDeSessao } from "./api.js";
import { el, preencher, avisar, avisarComAcao, icone, abrirModal, fecharModal, fmtRelativo } from "./ui.js";
import * as voz from "./voz.js";
import * as armazem from "./armazem.js";
import { telaEstante, telaSumario, telaObra, telaAnotacoes, telaBusca, telaAjustes, arvoreSumario } from "./telas.js";
import { telaLeitor, limparLeitor, salvarPendentes } from "./leitor.js";
import { modo, aplicarModo, aoMudarModo } from "./aparelho.js";

let eu = null;
let catalogo = { categorias: [], obras: [] };   // todas as leis do Vade Mecum
const sumarios = new Map();                     // obra → sumário (carregado sob demanda)
let obraAberta = "cf";                          // a lei em que o estudante está
let preferencias = {};
let promptInstalacao = null;      // o evento beforeinstallprompt, guardado até o toque no menu
let registroSw = null;
/* Atualização pendente: o worker novo já instalado (esperando) e/ou a versão
   que o servidor anuncia. O aviso fica no topo e no menu até ser aplicado. */
export const atualizacao = { worker: null, versaoNova: null, ultimaVerificacao: null, avisada: false };
const ouvintesAtualizacao = new Set();
export function aoMudarAtualizacao(fn) { ouvintesAtualizacao.add(fn); return () => ouvintesAtualizacao.delete(fn); }

export function usuarioAtual() { return eu; }
/* ---------- o Vade Mecum: obras e sumários ---------- */
export function obras() { return catalogo; }
export function obraAtual() { return obraAberta; }
export function metaDaObra(id) { return catalogo.obras.find((o) => o.id === id) ?? null; }
/* O sumário da obra aberta (já carregado pelo roteador antes de a tela nascer). */
export function sumario() { return sumarios.get(obraAberta) ?? null; }
export async function sumarioDe(id) {
  if (!sumarios.has(id)) sumarios.set(id, await armazem.lerSumario(id, metaDaObra(id)?.versao));
  return sumarios.get(id);
}

/* ---------- leis atualizadas no Planalto ----------
   O catálogo traz a versão de cada lei. Mudou: o sumário em memória cai, e a
   cópia offline (se houver) é renovada em segundo plano, sem perguntar — o
   estudante só fica sabendo pelo aviso. As anotações não são tocadas. */
let renovando = false;
async function conferirLeis(catalogoNovo) {
  const mudaram = catalogoNovo.obras.filter((o) => { const v = metaDaObra(o.id)?.versao; return v && o.versao && v !== o.versao; }).map((o) => o.id);
  catalogo = catalogoNovo;
  for (const id of mudaram) sumarios.delete(id);
  if (!armazem.estado.online || renovando) return mudaram;
  const desatualizadas = await armazem.obrasDesatualizadas(catalogo);
  if (!desatualizadas.length) return mudaram;
  renovando = true;
  try {
    await armazem.baixarObras(desatualizadas);
    const siglas = desatualizadas.map((id) => metaDaObra(id)?.sigla ?? id);
    avisar(`Texto novo do Planalto guardado no aparelho: ${siglas.slice(0, 4).join(", ")}${siglas.length > 4 ? ` e mais ${siglas.length - 4}` : ""}.`);
    montarMenuUsuario();
  } catch { /* tenta de novo na próxima conferência */ }
  finally { renovando = false; }
  return mudaram;
}
async function recarregarCatalogo() {
  try {
    const novo = await armazem.lerObras();
    const mudaram = await conferirLeis(novo);
    const abertaMudou = mudaram.includes(obraAberta);
    if (abertaMudou && /^#\/(obra|ler)\//.test(window.location.hash)) avisarComAcao(`${metaDaObra(obraAberta)?.sigla ?? "A lei"} foi atualizada no Planalto.`, "Ver texto novo", () => void navegar());
  } catch { /* offline */ }
}
export function definirObraAtual(id) {
  if (!metaDaObra(id)) return;
  obraAberta = id;
  try { localStorage.setItem("carta.obra", id); } catch { /* sem armazenamento */ }
  const m = metaDaObra(id);
  const campo = document.getElementById("busca-rapida-campo");
  if (campo) campo.placeholder = `Buscar ou ir para o art. … (${m.sigla})`;
}
/* De que lei é a página? O prefixo do id diz ("cp-…", "cc-…"; a Constituição usa "cf-" e "adct-"). */
export function obraDaPagina(paginaId) {
  let melhor = null;
  for (const o of catalogo.obras) for (const p of o.prefixos ?? [o.id]) {
    if ((paginaId === p || paginaId.startsWith(p + "-")) && (!melhor || p.length > melhor.p.length)) melhor = { o, p };
  }
  return melhor ? melhor.o.id : "cf";
}
export function prefs() { return preferencias; }
export function atualizarNome(nome) { eu.nome = nome; void armazem.guardar("eu", eu); montarMenuUsuario(); }

export async function salvarPrefs(parcial) {
  Object.assign(preferencias, parcial);
  aplicarPrefs();
  await armazem.guardar("prefs", preferencias);
  void armazem.mutar({ metodo: "PUT", caminho: "/api/v1/preferencias", corpo: parcial, chave: "prefs", modo: "mesclar" });
}
function aplicarPrefs() {
  document.documentElement.style.setProperty("--tamanho-texto", `${preferencias.tamanho_fonte || 19}px`);
  document.documentElement.classList.toggle("sem-notas", preferencias.notas_alteracao === "0");
  voz.configurarVoz({ voz: preferencias.voz || "", velocidade: Number(preferencias.velocidade_voz) || 1 });
}

const ROTAS = [
  { padrao: /^#\/$/, tela: telaEstante },
  { padrao: /^#\/sumario$/, tela: telaSumario },
  { padrao: /^#\/obra\/([^/?]+)$/, tela: telaObra },
  { padrao: /^#\/anotacoes$/, tela: telaAnotacoes, menu: "#/anotacoes" },
  { padrao: /^#\/busca$/, tela: telaBusca },
  { padrao: /^#\/ajustes$/, tela: telaAjustes },
  { padrao: /^#\/ler\/([^/?]+)$/, tela: telaLeitor },
];

export function irPara(hash) {
  if (window.location.hash === hash) navegar();
  else window.location.hash = hash;
}

async function navegar() {
  const bruto = window.location.hash || "#/";
  const [hash, consulta = ""] = bruto.split("?");
  const query = new URLSearchParams(consulta);
  const container = document.getElementById("conteudo");
  fecharGaveta();
  for (const a of document.querySelectorAll(".topo-links a")) a.classList.toggle("ativo", a.dataset.rota === hash);

  const rota = ROTAS.find((r) => r.padrao.test(hash)) ?? ROTAS[0];
  const partes = (hash.match(rota.padrao) || []).slice(1).map(decodeURIComponent);
  if (rota.tela !== telaLeitor) { limparLeitor(); voz.parar(); }
  try {
    /* a página manda na obra aberta: o sumário dela precisa estar à mão antes de a folha nascer */
    if (rota.tela === telaLeitor) {
      const id = obraDaPagina(partes[0]);
      await sumarioDe(id);
      definirObraAtual(id);
    }
    await rota.tela(container, partes, query);
    if (rota.tela !== telaLeitor) { container.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    marcarSumarioAtual();
  } catch (e) {
    if (e.status === 401) return;
    preencher(container, el("div", { classe: "vazio" }, el("span", { classe: "grande" }, e.status === 0 ? "⇅" : "✖"), el("p", {}, e.status === 0 ? e.message : `Erro ao carregar: ${e.message}`), el("button", { classe: "botao", type: "button", aoClicar: navegar }, "Tentar de novo")));
  }
}

/* ---------- gaveta do sumário ---------- */
let contagensSumario = new Map();
async function montarGaveta() {
  const s = await sumarioDe(obraAberta);
  const m = metaDaObra(obraAberta);
  preencher(document.getElementById("gaveta-obra"),
    el("span", { classe: "obra-sigla" }, m?.sigla ?? ""),
    el("span", { classe: "gaveta-obra-nome" }, m?.nome ?? ""),
    el("a", { classe: "gaveta-trocar", href: "#/", aoClicar: fecharGaveta }, "trocar de lei"));
  try { const r = await armazem.lerResumo(); contagensSumario = new Map(r.paginas.map((p) => [p.pagina_id, p])); } catch { /* sem contagens */ }
  preencher(document.getElementById("sumario-nav"), ...arvoreSumario(s.sumario, contagensSumario, { aoAbrir: fecharGaveta, sumario: s }));
}
function abrirGaveta() {
  void montarGaveta();
  document.getElementById("gaveta").classList.add("aberta");
  document.getElementById("gaveta-fundo").classList.add("aberta");
}
function fecharGaveta() {
  document.getElementById("gaveta").classList.remove("aberta");
  document.getElementById("gaveta-fundo").classList.remove("aberta");
}
function marcarSumarioAtual() {
  const atual = (window.location.hash.split("?")[0].match(/^#\/ler\/([^/]+)/) || [])[1];
  for (const l of document.querySelectorAll("#sumario-nav .no-linha")) {
    const href = l.querySelector("a")?.getAttribute("href") || "";
    l.classList.toggle("ativo", Boolean(atual) && href === `#/ler/${atual}`);
  }
}

/* ---------- rede: o chip do topo ---------- */
function montarChipRede() {
  const chip = document.getElementById("estado-rede");
  armazem.aoMudarEstado((s) => {
    if (!s.online) { chip.textContent = s.pendentes ? `Sem internet · ${s.pendentes} a enviar` : "Sem internet"; chip.className = "chip-rede offline"; chip.title = "As anotações ficam guardadas no tablet e sobem quando a internet voltar."; }
    else if (s.pendentes) { chip.textContent = s.enviando ? `Enviando ${s.pendentes}…` : `${s.pendentes} a enviar`; chip.className = "chip-rede pendente"; chip.title = "Toque para enviar agora."; }
    else { chip.textContent = ""; chip.className = "chip-rede escondido"; }
  });
  chip.addEventListener("click", () => void armazem.esvaziar());
}

/* ---------- instalação no tablet ---------- */
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalacao = e; });
window.addEventListener("appinstalled", () => { promptInstalacao = null; avisar("LA Carta instalado. Abra pelo ícone na tela inicial."); });
const jaInstalado = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function instalarNoTablet() {
  if (jaInstalado()) return avisar("O LA Carta já está instalado neste aparelho.");
  const computador = modo() === "computador";
  if (promptInstalacao) {
    const p = promptInstalacao;
    promptInstalacao = null;
    p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome !== "accepted") avisar("Instalação cancelada. Dá para fazer depois, no mesmo menu.");
    return;
  }
  const samsung = /SamsungBrowser/i.test(navigator.userAgent);
  const ios = /iPhone|iPad/i.test(navigator.userAgent);
  abrirModal("Instalar o aplicativo",
    el("div", { classe: "instrucoes" },
      el("p", {}, "O navegador não ofereceu a instalação automática. Faça pelo menu do próprio navegador:"),
      computador ? el("ol", {}, el("li", {}, "No Chrome ou no Edge, clique no ícone ", el("b", {}, "Instalar"), " no fim da barra de endereço (um monitor com uma seta)."), el("li", {}, "Ou abra o menu ", el("b", {}, "⋮"), " › ", el("b", {}, "Transmitir, salvar e compartilhar"), " › ", el("b", {}, "Instalar página como app"), "."), el("li", {}, "O LA Carta passa a abrir numa janela própria, como um programa."))
      : samsung ? el("ol", {}, el("li", {}, "Toque no menu ", el("b", {}, "☰"), " (canto inferior direito) do Samsung Internet."), el("li", {}, "Toque em ", el("b", {}, "Adicionar página a"), " › ", el("b", {}, "Tela inicial"), "."), el("li", {}, "Confirme. O ícone do LA Carta aparece entre os aplicativos."))
        : ios ? el("ol", {}, el("li", {}, "Toque em ", el("b", {}, "Compartilhar"), " (o quadrado com a seta)."), el("li", {}, "Toque em ", el("b", {}, "Adicionar à Tela de Início"), "."))
        : el("ol", {}, el("li", {}, "Toque no menu ", el("b", {}, "⋮"), " do Chrome."), el("li", {}, "Toque em ", el("b", {}, "Instalar app"), " (ou ", el("b", {}, "Adicionar à tela inicial"), ")."), el("li", {}, "Confirme. O ícone do LA Carta aparece entre os aplicativos.")),
      el("p", { style: "color: var(--tinta-3); font-size: .86rem" }, "Instalado, ele abre em tela cheia, sem a barra do navegador — e funciona sem internet depois de baixar o caderno."),
    ),
    [el("button", { classe: "botao botao-primario", type: "button", aoClicar: fecharModal }, "Entendi")]);
}

/* Baixa as leis pedidas para o tablet, com a barra de progresso. */
export async function baixarObras(ids) {
  const barra = el("span", { style: "width: 0%" });
  const rotulo = el("p", { classe: "baixa-rotulo" }, "Preparando…");
  const modal = abrirModal(ids.length === 1 ? `Baixar ${metaDaObra(ids[0])?.sigla ?? "a lei"}` : `Baixar ${ids.length} leis`,
    el("div", {},
      el("p", {}, "O texto inteiro e as suas anotações ficam guardados no tablet. Depois disso, ler, escrever e ouvir funcionam sem internet; o que você anotar sobe quando a conexão voltar."),
      el("div", { classe: "progresso baixa" }, barra),
      rotulo,
    ), null, { semFoco: true });
  modal.querySelector(".botao-icone")?.classList.add("escondido");
  try {
    const r = await armazem.baixarObras(ids, (feitas, total, meta, fase) => {
      barra.style.setProperty("width", `${Math.round(((feitas + (fase === "texto" ? 0.4 : 0)) / total) * 100)}%`);
      rotulo.textContent = `${Math.min(feitas + (fase === "texto" ? 1 : 0), total)}/${total} · ${meta?.sigla ?? ""} — ${meta?.nome ?? ""}`;
    });
    barra.style.setProperty("width", "100%");
    rotulo.textContent = `Pronto: ${r.obras} lei(s), ${r.paginas.toLocaleString("pt-BR")} páginas guardadas no tablet.`;
    for (const id of ids) sumarios.delete(id);
    setTimeout(() => { fecharModal(); montarMenuUsuario(); avisar("Baixado. Pode ler sem internet."); void navegar(); }, 900);
  } catch (e) {
    fecharModal();
    avisar(e.status === 0 ? "Sem internet: o download precisa de conexão." : `Não consegui baixar: ${e.message}`, "erro");
  }
}

/* Escolher o que levar: a lei aberta, as que já estão em estudo, uma matéria inteira ou tudo. */
async function baixarParaOffline() {
  const baixadas = new Set(await armazem.obrasBaixadas());
  let emEstudo = new Set();
  try { emEstudo = new Set(((await armazem.lerResumo()).obras ?? []).map((o) => o.obra_id)); } catch { /* sem resumo */ }
  const marcadas = new Set([obraAberta, "cf", ...emEstudo, ...baixadas]);
  const corpo = el("div", { classe: "escolha-obras" });
  const contador = el("span", {});
  const desenhar = () => {
    const mb = catalogo.obras.filter((o) => marcadas.has(o.id)).reduce((s, o) => s + o.palavras, 0) * 9 / 1_000_000;
    contador.textContent = `${marcadas.size} lei(s) · cerca de ${mb < 1 ? "1" : mb.toFixed(0)} MB`;
    preencher(corpo, ...catalogo.categorias.map((c) => {
      const lista = catalogo.obras.filter((o) => o.categoria === c);
      if (!lista.length) return null;
      const todas = lista.every((o) => marcadas.has(o.id));
      return el("section", {},
        el("button", { type: "button", classe: "escolha-categoria", aoClicar: () => { for (const o of lista) { if (todas) marcadas.delete(o.id); else marcadas.add(o.id); } desenhar(); } }, c, el("small", {}, todas ? "desmarcar" : "marcar todas")),
        el("div", { classe: "escolha-lista" }, ...lista.map((o) => el("button", { type: "button", classe: `escolha-obra ${marcadas.has(o.id) ? "marcada" : ""}`, title: o.nome, aoClicar: () => { if (marcadas.has(o.id)) marcadas.delete(o.id); else marcadas.add(o.id); desenhar(); } },
          o.sigla, baixadas.has(o.id) ? el("small", {}, "offline") : null))));
    }));
  };
  desenhar();
  abrirModal("Baixar para usar sem internet",
    el("div", {}, el("p", {}, "Escolha as leis que vão com você. As que já estão no tablet são atualizadas (texto e anotações)."), corpo),
    [
      contador,
      el("button", { classe: "botao", type: "button", aoClicar: () => { for (const o of catalogo.obras) marcadas.add(o.id); desenhar(); } }, "Marcar tudo"),
      el("button", { classe: "botao botao-primario", type: "button", aoClicar: () => { const ids = catalogo.obras.filter((o) => marcadas.has(o.id)).map((o) => o.id); if (!ids.length) return avisar("Marque pelo menos uma lei.", "erro"); void baixarObras(ids); } }, icone("baixar", 18), "Baixar"),
    ], { larga: true, semFoco: true });
}

/* ---------- service worker (a casca do aplicativo) e atualização ----------
   O navegador só confere o sw.js sozinho de vez em quando (e um app instalado
   pode ficar dias aberto). Por isso o app OBSERVA: confere ao abrir, ao voltar
   ao primeiro plano, ao recuperar a rede e a cada 20 minutos — e compara a
   versão que o servidor anuncia com a que está rodando. Havendo novidade, o
   worker novo fica ESPERANDO (não troca sozinho no meio de uma anotação) e o
   aviso fica visível até o estudante tocar em "Atualizar". */
const VERIFICAR_A_CADA_MS = 20 * 60 * 1000;

function anunciarAtualizacao() {
  for (const fn of ouvintesAtualizacao) { try { fn(atualizacao); } catch { /* ouvinte quebrado não derruba os outros */ } }
  renderChipAtualizacao();
  if (eu) montarMenuUsuario();
  if (temAtualizacao() && !atualizacao.avisada) {
    atualizacao.avisada = true;
    avisarComAcao(`Versão nova do LA Carta${atualizacao.versaoNova ? ` (${atualizacao.versaoNova})` : ""} pronta para instalar.`, "Atualizar", aplicarAtualizacao);
  }
}
export function temAtualizacao() { return Boolean(atualizacao.worker || (atualizacao.versaoNova && atualizacao.versaoNova !== versaoApp())); }

/* A versão que ESTE app está rodando: a do worker no controle (a casca em
   cache), não a que o servidor anuncia — depois de um deploy elas divergem, e
   é essa diferença que define "tem atualização". */
let versaoRodando = null;
export function versaoApp() { return versaoRodando || eu?.versao || ""; }
async function descobrirVersaoRodando() {
  const c = navigator.serviceWorker?.controller;
  if (!c) return;
  versaoRodando = await new Promise((resolver) => {
    const canal = new MessageChannel();
    const t = setTimeout(() => resolver(null), 1500);
    canal.port1.onmessage = (e) => { clearTimeout(t); resolver(typeof e.data === "string" ? e.data : null); };
    c.postMessage("versao?", [canal.port2]);
  });
}

function observarWorker(w) {
  if (!w) return;
  const marcar = () => {
    if (w.state === "installed" && navigator.serviceWorker.controller) { atualizacao.worker = w; anunciarAtualizacao(); }
    if (w.state === "redundant" && atualizacao.worker === w) { atualizacao.worker = null; anunciarAtualizacao(); }
  };
  w.addEventListener("statechange", marcar);
  marcar();
}

export async function verificarAtualizacao(motivo = "manual") {
  if (!armazem.estado.online && motivo !== "manual") return;
  atualizacao.ultimaVerificacao = new Date().toISOString();
  try { if (registroSw) await registroSw.update(); } catch { /* sem rede ou sw.js indisponível */ }
  try {
    const s = await api.get("/api/v1/saude");
    if (!versaoRodando) await descobrirVersaoRodando();
    atualizacao.versaoNova = s.versao !== versaoApp() ? s.versao : null;
  } catch { /* offline: fica como está */ }
  if (registroSw?.waiting) observarWorker(registroSw.waiting);
  anunciarAtualizacao();
  if (eu) void recarregarCatalogo();
  return temAtualizacao();
}

export async function aplicarAtualizacao() {
  try { await salvarPendentes(); } catch { /* nada pendente */ }
  const w = atualizacao.worker || registroSw?.waiting;
  if (w) { w.postMessage("pular-espera"); return; }          // o controllerchange recarrega
  /* Servidor anuncia versão nova mas o worker não veio: força a busca e recarrega. */
  try { await registroSw?.update(); } catch { /* segue */ }
  setTimeout(() => window.location.reload(), 300);
}

function renderChipAtualizacao() {
  const chip = document.getElementById("chip-atualizacao");
  if (!chip) return;
  const ha = temAtualizacao();
  chip.classList.toggle("escondido", !ha);
  chip.textContent = ha ? `Atualização pronta${atualizacao.versaoNova ? ` · ${atualizacao.versaoNova}` : ""}` : "";
  chip.title = ha ? "Toque para atualizar o aplicativo (leva um segundo; suas anotações ficam guardadas)." : "";
}

async function registrarSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    registroSw = await navigator.serviceWorker.register("/sw.js");
    await descobrirVersaoRodando();
    if (registroSw.waiting) observarWorker(registroSw.waiting);   // já havia uma esperando de outra sessão
    registroSw.addEventListener("updatefound", () => observarWorker(registroSw.installing));
    let recarregando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (recarregando) return; recarregando = true; window.location.reload(); });
  } catch (e) { console.warn("service worker não registrado:", e.message); }
  document.getElementById("chip-atualizacao")?.addEventListener("click", () => void aplicarAtualizacao());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void verificarAtualizacao("visivel"); });
  window.addEventListener("online", () => void verificarAtualizacao("rede"));
  setInterval(() => void verificarAtualizacao("periodica"), VERIFICAR_A_CADA_MS);
  setTimeout(() => void verificarAtualizacao("abertura"), 4000);
}

/* ---------- menu do usuário ---------- */
function montarMenuUsuario() {
  const botao = document.getElementById("botao-usuario");
  const drop = document.getElementById("dropdown-usuario");
  document.getElementById("usuario-inicial").textContent = (eu.nome || "?").trim().charAt(0).toUpperCase();
  const fechar = () => { drop.classList.add("escondido"); botao.setAttribute("aria-expanded", "false"); };
  const baixado = armazem.estado.baixadoEm;
  preencher(drop,
    el("div", { classe: "cabec" }, el("b", {}, eu.nome), el("span", {}, eu.email)),
    el("a", { href: "#/", aoClicar: fechar }, icone("livro", 18), "Biblioteca"),
    el("a", { href: "#/sumario", aoClicar: fechar }, icone("seta", 18), `Sumário · ${metaDaObra(obraAberta)?.sigla ?? ""}`),
    el("a", { href: "#/anotacoes", aoClicar: fechar }, icone("nota", 18), "Minhas anotações"),
    el("a", { href: "#/busca", aoClicar: fechar }, icone("buscar", 18), "Buscar"),
    el("a", { href: "#/ajustes", aoClicar: fechar }, icone("engrenagem", 18), "Ajustes"),
    el("div", { classe: "divisoria" }),
    el("button", { classe: "item", type: "button", aoClicar: () => { fechar(); void instalarNoTablet(); } }, icone("instalar", 18), el("span", {}, "Instalar o aplicativo", el("small", {}, jaInstalado() ? "já instalado neste aparelho" : modo() === "computador" ? "abre numa janela própria" : "abre em tela cheia, como app"))),
    el("button", { classe: "item", type: "button", aoClicar: () => { fechar(); void baixarParaOffline(); } }, icone("baixar", 18), el("span", {}, "Baixar para usar sem internet", el("small", {}, baixado ? `cópia local de ${fmtRelativo(baixado)} · escolher leis` : "escolha as leis + suas anotações"))),
    temAtualizacao()
      ? el("button", { classe: "item destaque", type: "button", aoClicar: () => { fechar(); void aplicarAtualizacao(); } }, icone("atualizar", 18), el("span", {}, `Atualizar o aplicativo${atualizacao.versaoNova ? ` para a ${atualizacao.versaoNova}` : ""}`, el("small", {}, "pronta para instalar · leva um segundo")))
      : el("button", { classe: "item", type: "button", aoClicar: async () => { fechar(); const ha = await verificarAtualizacao("manual"); if (!ha) avisar(`Você está na versão mais recente (${versaoApp()}).`); } }, icone("atualizar", 18), el("span", {}, "Verificar atualização", el("small", {}, atualizacao.ultimaVerificacao ? `última conferência ${fmtRelativo(atualizacao.ultimaVerificacao)}` : `versão ${versaoApp()}`))),
    el("div", { classe: "divisoria" }),
    el("button", { classe: "item perigo", type: "button", aoClicar: async () => { fechar(); try { await api.post("/api/v1/sair"); } catch { /* sessão já podia estar morta */ } mostrarLogin(); } }, icone("x", 18), "Sair"),
    el("div", { classe: "rodape" }, `LA Carta v${versaoApp()} · ${catalogo.obras.length} leis`),
  );
  botao.onclick = (e) => {
    e.stopPropagation();
    const aberto = drop.classList.toggle("escondido") === false;
    botao.setAttribute("aria-expanded", String(aberto));
  };
  document.addEventListener("click", (e) => { if (!drop.contains(e.target)) fechar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { fechar(); fecharGaveta(); } });
}

/* ---------- busca rápida do topo ---------- */
async function buscaRapida(termo) {
  const t = termo.trim();
  if (!t) return;
  /* tem número e parece referência de artigo ("121", "art. 5º", "121 cp", "cc 1.639", "adct 2") */
  if (t.length <= 40 && /[0-9]/.test(t) && !/[0-9]{5,}/.test(t)) {
    try {
      const r = await api.get(`/api/v1/texto/artigo?q=${encodeURIComponent(t)}&obra=${encodeURIComponent(obraAberta)}`);
      irPara(`#/ler/${r.pagina_id}?art=${encodeURIComponent(r.artigo_id)}`);
      return;
    } catch (e) {
      if (e.status === 0) {
        const local = armazem.acharArtigoNoSumario(t, sumario());
        if (local) { irPara(`#/ler/${local.pagina_id}?art=${encodeURIComponent(local.artigo_id)}`); return; }
      }
    }
  }
  irPara(`#/busca?q=${encodeURIComponent(t)}`);
}

/* ---------- login / boot ---------- */
function mostrarLogin() {
  limparLeitor();
  document.getElementById("aplicacao").classList.add("escondido");
  document.getElementById("tela-login").classList.remove("escondido");
  document.getElementById("login-email").focus();
}

async function mostrarAplicacao() {
  const [usuario, cat, p] = await Promise.all([armazem.lerEu(), armazem.lerObras(), armazem.lerPrefs()]);
  eu = usuario;
  catalogo = cat;
  preferencias = p;
  let ultima = "cf";
  try { ultima = localStorage.getItem("carta.obra") || "cf"; } catch { /* sem armazenamento */ }
  if (!metaDaObra(ultima)) ultima = "cf";
  try { await sumarioDe(ultima); } catch { ultima = "cf"; await sumarioDe("cf"); }
  definirObraAtual(ultima);
  aplicarPrefs();
  document.getElementById("tela-login").classList.add("escondido");
  document.getElementById("aplicacao").classList.remove("escondido");
  montarMenuUsuario();
  if (!armazem.estado.online) avisar("Sem internet: abrindo com a cópia guardada no aparelho.");
  await navegar();
  void conferirLeis(catalogo);
}

async function iniciar() {
  aplicarModo();
  /* trocou o modo em Ajustes (ou a caneta apareceu): refaz a tela aberta */
  aoMudarModo(() => { if (document.getElementById("aplicacao") && !document.getElementById("aplicacao").classList.contains("escondido")) void navegar(); });
  /* computador: "/" vai para a busca, como nos sites de documentação */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const ativo = document.activeElement;
    if (ativo && (/^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName) || ativo.isContentEditable)) return;
    const campo = document.getElementById("busca-rapida-campo");
    e.preventDefault();
    if (campo && campo.offsetParent) campo.focus(); else irPara("#/busca");
  });
  definirQuedaDeSessao(() => { avisar("Sessão expirada — entre de novo.", "erro"); mostrarLogin(); });
  await armazem.iniciarArmazem();
  montarChipRede();
  void registrarSw();

  try {
    const s = await fetch("/api/v1/saude").then((r) => r.json());
    document.getElementById("login-versao").textContent = `LA Carta v${s.versao}`;
  } catch { /* sem versão */ }

  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = document.getElementById("login-erro");
    erro.textContent = "";
    try {
      await api.post("/api/v1/entrar", { email: document.getElementById("login-email").value, senha: document.getElementById("login-senha").value });
      document.getElementById("login-senha").value = "";
      await mostrarAplicacao();
    } catch (ex) { erro.textContent = ex.status === 0 ? "Sem internet: para entrar é preciso conexão (a sessão depois dura 60 dias)." : ex.message; }
  });

  document.getElementById("botao-sumario").addEventListener("click", abrirGaveta);
  document.getElementById("fechar-gaveta").addEventListener("click", fecharGaveta);
  document.getElementById("gaveta-fundo").addEventListener("click", fecharGaveta);
  document.getElementById("busca-rapida").addEventListener("submit", (e) => {
    e.preventDefault();
    const campo = document.getElementById("busca-rapida-campo");
    void buscaRapida(campo.value);
    campo.blur();
  });

  window.addEventListener("hashchange", navegar);

  try { await mostrarAplicacao(); }
  catch (e) {
    mostrarLogin();
    if (e.status === 0) document.getElementById("login-erro").textContent = "Sem internet e sem cópia local ainda. Conecte, entre e use “Baixar para usar sem internet”.";
  }
}

iniciar();
