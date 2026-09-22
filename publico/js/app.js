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
import { telaEstante, telaSumario, telaAnotacoes, telaBusca, telaAjustes, arvoreSumario } from "./telas.js";
import { telaLeitor, limparLeitor } from "./leitor.js";

let eu = null;
let sumarioDados = null;
let preferencias = {};
let promptInstalacao = null;      // o evento beforeinstallprompt, guardado até o toque no menu
let registroSw = null;

export function usuarioAtual() { return eu; }
export function sumario() { return sumarioDados; }
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
  voz.configurarVoz({ voz: preferencias.voz || "", velocidade: Number(preferencias.velocidade_voz) || 1 });
}

const ROTAS = [
  { padrao: /^#\/$/, tela: telaEstante },
  { padrao: /^#\/sumario$/, tela: telaSumario },
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
  try { const r = await armazem.lerResumo(sumarioDados); contagensSumario = new Map(r.paginas.map((p) => [p.pagina_id, p])); } catch { /* sem contagens */ }
  preencher(document.getElementById("sumario-nav"), ...arvoreSumario(sumarioDados.sumario, contagensSumario, { aoAbrir: fecharGaveta }));
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
  abrirModal("Instalar no tablet",
    el("div", { classe: "instrucoes" },
      el("p", {}, "O navegador não ofereceu a instalação automática. Faça pelo menu do próprio navegador:"),
      samsung ? el("ol", {}, el("li", {}, "Toque no menu ", el("b", {}, "☰"), " (canto inferior direito) do Samsung Internet."), el("li", {}, "Toque em ", el("b", {}, "Adicionar página a"), " › ", el("b", {}, "Tela inicial"), "."), el("li", {}, "Confirme. O ícone do LA Carta aparece entre os aplicativos."))
        : ios ? el("ol", {}, el("li", {}, "Toque em ", el("b", {}, "Compartilhar"), " (o quadrado com a seta)."), el("li", {}, "Toque em ", el("b", {}, "Adicionar à Tela de Início"), "."))
        : el("ol", {}, el("li", {}, "Toque no menu ", el("b", {}, "⋮"), " do Chrome."), el("li", {}, "Toque em ", el("b", {}, "Instalar app"), " (ou ", el("b", {}, "Adicionar à tela inicial"), ")."), el("li", {}, "Confirme. O ícone do LA Carta aparece entre os aplicativos.")),
      el("p", { style: "color: var(--tinta-3); font-size: .86rem" }, "Instalado, ele abre em tela cheia, sem a barra do navegador — e funciona sem internet depois de baixar o caderno."),
    ),
    [el("button", { classe: "botao botao-primario", type: "button", aoClicar: fecharModal }, "Entendi")]);
}

async function baixarParaOffline() {
  const barra = el("span", { style: "width: 0%" });
  const rotulo = el("p", { classe: "baixa-rotulo" }, "Preparando…");
  const modal = abrirModal("Baixar o caderno",
    el("div", {},
      el("p", {}, "Baixa o texto inteiro da Constituição e todas as suas anotações para o tablet. Depois disso, ler, escrever e ouvir funcionam sem internet; o que você anotar sobe quando a conexão voltar."),
      el("div", { classe: "progresso baixa" }, barra),
      rotulo,
    ), null, { semFoco: true });
  modal.querySelector(".botao-icone")?.classList.add("escondido");
  try {
    const r = await armazem.baixarTudo((feitas, total, p) => {
      barra.style.setProperty("width", `${Math.round((feitas / total) * 100)}%`);
      rotulo.textContent = `${feitas}/${total} · ${p.rotulo}${p.nome ? " — " + p.nome : ""}`;
    });
    barra.style.setProperty("width", "100%");
    rotulo.textContent = `Pronto: ${r.paginas} páginas e todas as anotações guardadas no tablet.`;
    setTimeout(() => { fecharModal(); montarMenuUsuario(); avisar("Caderno baixado. Pode ler sem internet."); }, 900);
  } catch (e) {
    fecharModal();
    avisar(e.status === 0 ? "Sem internet: o download precisa de conexão." : `Não consegui baixar: ${e.message}`, "erro");
  }
}

/* ---------- service worker (a casca do aplicativo) ---------- */
async function registrarSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    registroSw = await navigator.serviceWorker.register("/sw.js");
    registroSw.addEventListener("updatefound", () => {
      const novo = registroSw.installing;
      if (!novo) return;
      novo.addEventListener("statechange", () => {
        if (novo.state === "installed" && navigator.serviceWorker.controller) {
          avisarComAcao("Versão nova do LA Carta pronta.", "Atualizar", () => novo.postMessage("pular-espera"));
        }
      });
    });
    let recarregando = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (recarregando) return; recarregando = true; window.location.reload(); });
  } catch (e) { console.warn("service worker não registrado:", e.message); }
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
    el("a", { href: "#/", aoClicar: fechar }, icone("livro", 18), "Estante"),
    el("a", { href: "#/sumario", aoClicar: fechar }, icone("seta", 18), "Sumário"),
    el("a", { href: "#/anotacoes", aoClicar: fechar }, icone("nota", 18), "Minhas anotações"),
    el("a", { href: "#/busca", aoClicar: fechar }, icone("buscar", 18), "Buscar"),
    el("a", { href: "#/ajustes", aoClicar: fechar }, icone("engrenagem", 18), "Ajustes"),
    el("div", { classe: "divisoria" }),
    el("button", { classe: "item", type: "button", aoClicar: () => { fechar(); void instalarNoTablet(); } }, icone("instalar", 18), el("span", {}, "Instalar no tablet", el("small", {}, jaInstalado() ? "já instalado neste aparelho" : "abre como aplicativo, em tela cheia"))),
    el("button", { classe: "item", type: "button", aoClicar: () => { fechar(); void baixarParaOffline(); } }, icone("baixar", 18), el("span", {}, "Baixar para usar sem internet", el("small", {}, baixado ? `cópia local de ${fmtRelativo(baixado)}` : "texto inteiro + suas anotações"))),
    el("div", { classe: "divisoria" }),
    el("button", { classe: "item perigo", type: "button", aoClicar: async () => { fechar(); try { await api.post("/api/v1/sair"); } catch { /* sessão já podia estar morta */ } mostrarLogin(); } }, icone("x", 18), "Sair"),
    el("div", { classe: "rodape" }, `LA Carta v${eu.versao ?? ""} · ${sumarioDados?.atualizado_ate ?? ""}`),
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
  if (/^(adct\s*)?(arts?\.?\s*)?\d{1,3}(\s*-?\s*[a-e])?(\s*(do\s+)?adct)?$/i.test(t)) {
    try {
      const r = await api.get(`/api/v1/texto/artigo?q=${encodeURIComponent(t)}`);
      irPara(`#/ler/${r.pagina_id}?art=${encodeURIComponent(r.artigo_id)}`);
      return;
    } catch (e) {
      if (e.status === 0) {
        const local = armazem.acharArtigoNoSumario(t, sumarioDados);
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
  const [usuario, s, p] = await Promise.all([armazem.lerEu(), armazem.lerSumario(), armazem.lerPrefs()]);
  eu = usuario;
  sumarioDados = s;
  preferencias = p;
  aplicarPrefs();
  document.getElementById("tela-login").classList.add("escondido");
  document.getElementById("aplicacao").classList.remove("escondido");
  montarMenuUsuario();
  if (!armazem.estado.online) avisar("Sem internet: abrindo com a cópia guardada no tablet.");
  await navegar();
}

async function iniciar() {
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
