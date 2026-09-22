/* ==========================================================================
   voz.js — leitura em voz alta com a Web Speech API do próprio aparelho.

   Uma fila de itens { texto, elemento? }. Cada item é quebrado em frases
   curtas antes de ir ao sintetizador: o Chrome corta utterances longas por
   volta de 15 s, e a frase também é o que se destaca na tela enquanto é
   lida — o olho acompanha o ouvido.
   ========================================================================== */

const ouvintes = new Set();
let fila = [];
let indice = 0;
let estado = "parado";           // parado | falando | pausado
let utteranceAtual = null;
let elementoAtual = null;
let prefs = { voz: "", velocidade: 1 };
let vozes = [];

function carregarVozes() {
  if (!("speechSynthesis" in window)) return;
  vozes = window.speechSynthesis.getVoices();
}
if ("speechSynthesis" in window) {
  carregarVozes();
  window.speechSynthesis.addEventListener("voiceschanged", carregarVozes);
}

export const vozDisponivel = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

export function listarVozes() {
  carregarVozes();
  const pt = vozes.filter((v) => /^pt/i.test(v.lang));
  return (pt.length ? pt : vozes).map((v) => ({ nome: v.name, lang: v.lang, local: v.localService }));
}

function escolherVoz() {
  carregarVozes();
  if (prefs.voz) {
    const v = vozes.find((x) => x.name === prefs.voz);
    if (v) return v;
  }
  const br = vozes.filter((v) => /pt[-_]BR/i.test(v.lang));
  const prioridade = (v) => (/google|microsoft|samsung|natural|neural/i.test(v.name) ? 0 : 1) + (v.localService ? 0 : 0.5);
  const lista = (br.length ? br : vozes.filter((v) => /^pt/i.test(v.lang))).sort((a, b) => prioridade(a) - prioridade(b));
  return lista[0] ?? null;
}

export function configurarVoz(novas) {
  prefs = { ...prefs, ...novas };
}

export function aoMudarVoz(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function notificar() {
  for (const fn of ouvintes) fn({ estado, indice, total: fila.length, elemento: elementoAtual });
}

/* Quebra em frases de até ~220 caracteres, respeitando pontuação. */
export function quebrarEmFrases(texto) {
  const limpo = String(texto).replace(/\s+/g, " ").trim();
  if (!limpo) return [];
  const brutas = limpo.split(/(?<=[.;:!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ§(“"'0-9])/);
  const saida = [];
  for (const f of brutas) {
    if (f.length <= 220) { saida.push(f); continue; }
    const pedacos = f.split(/(?<=,)\s+/);
    let atual = "";
    for (const p of pedacos) {
      if ((atual + " " + p).length > 220 && atual) { saida.push(atual); atual = p; }
      else atual = atual ? `${atual} ${p}` : p;
    }
    if (atual) saida.push(atual);
  }
  return saida;
}

/* Texto que soa bem: "Art. 5º" já é lido certo; "§" vira "parágrafo",
   "inc." e "art." abreviados são expandidos. */
export function prepararParaFala(texto) {
  return String(texto)
    .replace(/§\s*(\d+)º?/g, "parágrafo $1")
    .replace(/§§/g, "parágrafos")
    .replace(/\barts?\.\s*/gi, "artigo ")
    .replace(/\bn[ºo]\s*/g, "número ")
    .replace(/\bEC\s+n/g, "Emenda Constitucional n")
    .replace(/\(Revogad[oa]s?\)/g, "revogado")
    .replace(/\bcaput\b/g, "capute")
    .replace(/[“”"]/g, "");
}

export function falar(itens) {
  if (!vozDisponivel()) return false;
  parar();
  fila = itens.filter((i) => i && String(i.texto).trim());
  indice = 0;
  if (!fila.length) return false;
  estado = "falando";
  proximo();
  notificar();
  return true;
}

function proximo() {
  if (estado !== "falando") return;
  if (indice >= fila.length) { encerrar(); return; }
  const item = fila[indice];
  marcar(item.elemento ?? null);
  const frases = quebrarEmFrases(prepararParaFala(item.texto));
  let f = 0;
  const falarFrase = () => {
    if (estado !== "falando" && estado !== "pausado") return;
    if (f >= frases.length) { indice += 1; notificar(); proximo(); return; }
    const u = new SpeechSynthesisUtterance(frases[f]);
    f += 1;
    u.lang = "pt-BR";
    const v = escolherVoz();
    if (v) u.voice = v;
    u.rate = Number(prefs.velocidade) || 1;
    u.onend = () => { if (utteranceAtual === u) falarFrase(); };
    u.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") return;
      if (utteranceAtual === u) falarFrase();
    };
    utteranceAtual = u;
    window.speechSynthesis.speak(u);
  };
  falarFrase();
}

function marcar(elemento) {
  if (elementoAtual) elementoAtual.classList.remove("lendo");
  elementoAtual = elemento;
  if (elementoAtual) {
    elementoAtual.classList.add("lendo");
    elementoAtual.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function pausar() {
  if (estado !== "falando") return;
  estado = "pausado";
  window.speechSynthesis.pause();
  notificar();
}
export function continuar() {
  if (estado !== "pausado") return;
  estado = "falando";
  window.speechSynthesis.resume();
  notificar();
}
export function alternar() {
  if (estado === "falando") pausar();
  else if (estado === "pausado") continuar();
}
export function parar() {
  if (!vozDisponivel()) return;
  utteranceAtual = null;
  estado = "parado";
  window.speechSynthesis.cancel();
  marcar(null);
  fila = [];
  indice = 0;
  notificar();
}
function encerrar() {
  utteranceAtual = null;
  estado = "parado";
  marcar(null);
  notificar();
}
export function estadoDaVoz() { return { estado, indice, total: fila.length }; }

/* Alguns Androids “dormem” a síntese depois de muitas frases: cutucar a
   cada 10 s mantém a leitura de um capítulo inteiro viva. */
setInterval(() => {
  if (estado === "falando" && vozDisponivel() && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }
}, 10_000);
