/* ==========================================================================
   app.js — boot, login, barra do topo, gaveta do sumário e roteamento por
   hash. O estado compartilhado (usuário, sumário, preferências) mora aqui.
   ========================================================================== */
import { api, definirQuedaDeSessao } from "./api.js";
import { el, preencher, avisar, icone } from "./ui.js";
import * as voz from "./voz.js";
import { telaEstante, telaSumario, telaAnotacoes, telaBusca, telaAjustes, arvoreSumario } from "./telas.js";
import { telaLeitor, limparLeitor } from "./leitor.js";

let eu = null;
let sumarioDados = null;
let preferencias = {};

export function usuarioAtual() { return eu; }
export function sumario() { return sumarioDados; }
export function prefs() { return preferencias; }
export function atualizarNome(nome) { eu.nome = nome; montarMenuUsuario(); }

export async function salvarPrefs(parcial) {
  Object.assign(preferencias, parcial);
  aplicarPrefs();
  try { await api.put("/api/v1/preferencias", parcial); } catch (e) { avisar(`Preferência não salva: ${e.message}`, "erro"); }
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
    preencher(container, el("div", { classe: "vazio" }, el("span", { classe: "grande" }, "✖"), el("p", {}, `Erro ao carregar: ${e.message}`), el("button", { classe: "botao", type: "button", aoClicar: navegar }, "Tentar de novo")));
  }
}

/* ---------- gaveta do sumário ---------- */
let contagensSumario = new Map();
async function montarGaveta() {
  try { const r = await api.get("/api/v1/resumo"); contagensSumario = new Map(r.paginas.map((p) => [p.pagina_id, p])); } catch { /* sem contagens */ }
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

/* ---------- menu do usuário ---------- */
function montarMenuUsuario() {
  const botao = document.getElementById("botao-usuario");
  const drop = document.getElementById("dropdown-usuario");
  document.getElementById("usuario-inicial").textContent = (eu.nome || "?").trim().charAt(0).toUpperCase();
  const fechar = () => { drop.classList.add("escondido"); botao.setAttribute("aria-expanded", "false"); };
  preencher(drop,
    el("div", { classe: "cabec" }, el("b", {}, eu.nome), el("span", {}, eu.email)),
    el("a", { href: "#/", aoClicar: fechar }, icone("livro", 18), "Estante"),
    el("a", { href: "#/sumario", aoClicar: fechar }, icone("seta", 18), "Sumário"),
    el("a", { href: "#/anotacoes", aoClicar: fechar }, icone("nota", 18), "Minhas anotações"),
    el("a", { href: "#/busca", aoClicar: fechar }, icone("buscar", 18), "Buscar"),
    el("a", { href: "#/ajustes", aoClicar: fechar }, icone("engrenagem", 18), "Ajustes"),
    el("button", { classe: "item perigo", type: "button", aoClicar: async () => { fechar(); try { await api.post("/api/v1/sair"); } catch { /* sessão já podia estar morta */ } mostrarLogin(); } }, icone("x", 18), "Sair"),
    el("div", { classe: "rodape" }, `LA Carta v${eu.versao} · ${sumarioDados?.atualizado_ate ?? ""}`),
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
    } catch { /* cai na busca */ }
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
  const [usuario, s, p] = await Promise.all([api.get("/api/v1/eu"), api.get("/api/v1/texto/sumario"), api.get("/api/v1/preferencias")]);
  eu = usuario;
  sumarioDados = s;
  preferencias = p;
  aplicarPrefs();
  document.getElementById("tela-login").classList.add("escondido");
  document.getElementById("aplicacao").classList.remove("escondido");
  montarMenuUsuario();
  await navegar();
}

async function iniciar() {
  definirQuedaDeSessao(() => { avisar("Sessão expirada — entre de novo.", "erro"); mostrarLogin(); });

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
    } catch (ex) { erro.textContent = ex.message; }
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

  try { await mostrarAplicacao(); } catch { mostrarLogin(); }
}

iniciar();
