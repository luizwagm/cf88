/* ==========================================================================
   ui.js — blocos de interface: elementos, modal, toast, cores do caderno,
   rótulos falados. Nunca innerHTML com texto de fora.
   ========================================================================== */

/* ---------- Elementos ---------- */
export function el(tag, atributos = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "classe") n.className = v;
    /* style via CSSOM (setProperty): a CSP estrita bloqueia o atributo style
       e o cssText, mas atribuição individual é permitida. */
    else if (k === "style") {
      for (const decl of String(v).split(";")) {
        const dois = decl.indexOf(":");
        if (dois === -1) continue;
        n.style.setProperty(decl.slice(0, dois).trim(), decl.slice(dois + 1).trim());
      }
    }
    else if (k === "aoClicar") n.addEventListener("click", v);
    else if (k === "aoEnviar") n.addEventListener("submit", v);
    else if (k === "aoMudar") n.addEventListener("change", v);
    else if (k === "aoDigitar") n.addEventListener("input", v);
    else if (k === "aoTecla") n.addEventListener("keydown", v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

/* Substitui o conteúdo ignorando null/undefined/false. */
export function preencher(container, ...filhos) {
  container.replaceChildren(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false).map((f) => (f instanceof Node ? f : document.createTextNode(String(f)))));
}

export function icone(nome, tamanho = 20) {
  const caminhos = {
    mao: "M8 13V5.5a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V12m0-5a1.5 1.5 0 013 0v7.5c0 3.5-2.5 6-6 6H9.8c-1.6 0-3-.8-3.8-2.1L3.2 12.4a1.4 1.4 0 012.4-1.4L8 14",
    caneta: "M4 20l3.5-.8L19 7.7a2 2 0 000-2.8l-.9-.9a2 2 0 00-2.8 0L3.8 15.5 3 19zM14 5.5l4.5 4.5",
    marcador: "M4 20h16M6.5 16.5l7-7 3 3-7 7H6.5zM12.5 8.5l3-3a1.5 1.5 0 012 0l1 1a1.5 1.5 0 010 2l-3 3",
    borracha: "M5 15.5l7.8-7.8a2 2 0 012.8 0l3.7 3.7a2 2 0 010 2.8L14.5 19H9zM9 19H20M8 12.5l5.5 5.5",
    nota: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h4",
    ouvir: "M4 10v4h3l4 3.5v-11L7 10zM14.5 9.5a3.5 3.5 0 010 5M17 7a7 7 0 010 10",
    parar: "M7 7h10v10H7z",
    pausar: "M8 6h3v12H8zM13 6h3v12h-3z",
    tocar: "M8 5.5v13l10-6.5z",
    anterior: "M15 5l-7 7 7 7",
    proxima: "M9 5l7 7-7 7",
    desfazer: "M8 7H4v4M4 11a8 8 0 0114 5",
    lixo: "M5 7h14M9 7V4h6v3M8 7l.8 13h6.4L16 7",
    x: "M6 6l12 12M18 6L6 18",
    buscar: "M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM20 20l-4.5-4.5",
    livro: "M4 5.5c2.5-1.3 5-1.3 8 0 3-1.3 5.5-1.3 8 0v13c-2.5-1.3-5-1.3-8 0-3-1.3-5.5-1.3-8 0zM12 5.5v13",
    seta: "M9 6l6 6-6 6",
    check: "M5 12l4.5 4.5L19 7",
    mais: "M12 5v14M5 12h14",
    engrenagem: "M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", tamanho);
  svg.setAttribute("height", tamanho);
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", caminhos[nome] || "");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.9");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}

/* ---------- Cores do caderno ----------
   Duas famílias, como o estojo de um estudante: as tradicionais (tinta que
   se lê de longe) e os tons pastel (marca-texto que não briga com o texto). */
export const CORES = {
  tradicionais: [
    { nome: "Tinta", hex: "#1d2433" },
    { nome: "Azul", hex: "#1f4fb3" },
    { nome: "Vermelho", hex: "#c62828" },
    { nome: "Verde", hex: "#2e7d32" },
    { nome: "Laranja", hex: "#ef6c00" },
    { nome: "Roxo", hex: "#6a1b9a" },
  ],
  pasteis: [
    { nome: "Amarelo", hex: "#fff59a" },
    { nome: "Rosa", hex: "#f8bbd0" },
    { nome: "Menta", hex: "#b9f2d6" },
    { nome: "Lavanda", hex: "#d7c8f5" },
    { nome: "Pêssego", hex: "#ffd8b8" },
    { nome: "Azul-bebê", hex: "#bde3ff" },
  ],
};
export function nomeDaCor(hex) {
  const h = String(hex).toLowerCase();
  return [...CORES.tradicionais, ...CORES.pasteis].find((c) => c.hex === h)?.nome ?? hex;
}
/* Cor pastel vira “tinta” legível para texto sobre ela; tinta forte fica clara. */
export function ehClara(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
}

/* ---------- Formatação ---------- */
export function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtRelativo(iso) {
  if (!iso) return "";
  const dif = (Date.now() - new Date(iso).getTime()) / 60000;
  if (dif < 1) return "agora";
  if (dif < 60) return `há ${Math.round(dif)} min`;
  if (dif < 60 * 24) return `há ${Math.round(dif / 60)} h`;
  if (dif < 60 * 24 * 30) return `há ${Math.round(dif / 1440)} dias`;
  return fmtData(iso);
}
export function plural(n, um, muitos) { return `${n} ${n === 1 ? um : muitos}`; }

/* ---------- Rótulos falados ----------
   "Art. 5º" → "Artigo 5º"; inciso "XIV" → "inciso 14"; "a)" → "alínea a". */
const ROMANOS = { I: 1, V: 5, X: 10, L: 50, C: 100 };
export function romanoParaNumero(r) {
  let total = 0, anterior = 0;
  for (const ch of String(r).split("").reverse()) {
    const v = ROMANOS[ch] || 0;
    total = v < anterior ? total - v : total + v;
    anterior = Math.max(anterior, v);
  }
  return total;
}
export function rotuloFalado(artigo, dispositivo) {
  if (!dispositivo || dispositivo.tipo === "caput") {
    return artigo.rotulo.replace(/^Arts?\./, (m) => (m === "Arts." ? "Artigos" : "Artigo")).replace(/-([A-Z])$/, " $1");
  }
  if (dispositivo.tipo === "inciso") return `inciso ${romanoParaNumero(dispositivo.rotulo)}`;
  if (dispositivo.tipo === "paragrafo") return dispositivo.rotulo.replace("§", "parágrafo");
  if (dispositivo.tipo === "alinea") return `alínea ${dispositivo.rotulo.replace(")", "")}`;
  if (dispositivo.tipo === "item") return `item ${dispositivo.rotulo.replace(".", "")}`;
  return dispositivo.rotulo;
}

/* ---------- Toast ---------- */
export function avisar(mensagem, tipo = "ok") {
  const t = el("div", { classe: `toast ${tipo}` }, mensagem);
  document.getElementById("camada-toast").append(t);
  requestAnimationFrame(() => t.classList.add("visivel"));
  setTimeout(() => { t.classList.remove("visivel"); setTimeout(() => t.remove(), 300); }, 3800);
}

/* ---------- Modal ---------- */
export function abrirModal(titulo, corpo, rodape, opcoes = {}) {
  const camada = document.getElementById("camada-modal");
  camada.replaceChildren();
  const modal = el("div", { classe: `modal ${opcoes.larga ? "larga" : ""}`, role: "dialog", "aria-label": titulo },
    el("div", { classe: "modal-cabecalho" },
      el("h2", {}, titulo),
      el("button", { classe: "botao-icone", "aria-label": "Fechar", type: "button", aoClicar: fecharModal }, icone("x", 20)),
    ),
    el("div", { classe: "modal-corpo" }, corpo),
    rodape ? el("div", { classe: "modal-rodape" }, rodape) : null,
  );
  camada.append(modal);
  camada.classList.add("aberta");
  camada.onclick = (e) => { if (e.target === camada) fecharModal(); };
  const primeiro = modal.querySelector("textarea, input, select");
  if (primeiro && !opcoes.semFoco) primeiro.focus();
  return modal;
}
export function fecharModal() {
  const camada = document.getElementById("camada-modal");
  camada.classList.remove("aberta");
  camada.replaceChildren();
}
export function confirmar(mensagem, aoConfirmar, rotulo = "Confirmar") {
  abrirModal("Confirmar",
    el("p", {}, mensagem),
    [
      el("button", { classe: "botao", type: "button", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao botao-perigo", type: "button", aoClicar: async () => { fecharModal(); await aoConfirmar(); } }, rotulo),
    ],
  );
}

/* Paleta de cores em duas famílias, com a atual marcada. */
export function paletaDeCores(atual, aoEscolher, opcoes = {}) {
  const grupo = (titulo, lista) => el("div", { classe: "paleta-grupo" },
    el("span", { classe: "paleta-titulo" }, titulo),
    el("div", { classe: "paleta-cores" }, ...lista.map((c) => el("button", {
      type: "button", classe: `cor ${c.hex === String(atual).toLowerCase() ? "ativa" : ""}`,
      title: c.nome, "aria-label": c.nome, style: `--cor: ${c.hex}`,
      aoClicar: () => aoEscolher(c.hex),
    }))),
  );
  const ordem = opcoes.pasteisPrimeiro ? [["Tons pastel", CORES.pasteis], ["Tradicionais", CORES.tradicionais]] : [["Tradicionais", CORES.tradicionais], ["Tons pastel", CORES.pasteis]];
  return el("div", { classe: "paleta" }, ...ordem.map(([t, l]) => grupo(t, l)));
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
