/* ==========================================================================
   aparelho.js — em que aparelho o caderno está aberto, e o que isso muda.

     tablet       caneta (S Pen): o estojo de sempre, a tinta, nada muda
     celular      sem caneta, tela pequena: um toque no texto abre as ações
                  (marcar, nota, ouvir); desenhar é um modo à parte
     computador   mouse e teclado: selecionar com o mouse, botão de ações ao
                  lado de cada dispositivo e atalhos de teclado

   A detecção usa o PONTEIRO PRINCIPAL (pointer: coarse = dedo, fine = mouse)
   e o MENOR LADO DA TELA (não da janela — janela estreita no computador
   continua sendo computador). Uma caneta de verdade tocando a tela promove
   o aparelho a "tablet" para sempre (fica gravado). O estudante pode forçar
   o modo em Ajustes; a escolha vale só neste aparelho.
   ========================================================================== */
const CHAVE_MODO = "carta.modo";
const CHAVE_CANETA = "carta.caneta-vista";

export const MODOS = {
  auto: "Automático",
  tablet: "Tablet com caneta",
  celular: "Celular",
  computador: "Computador",
};

const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* aba anônima */ } };
const mq = (q) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;

let atual = null;
const ouvintes = new Set();

export function escolhido() { return ler(CHAVE_MODO) || "auto"; }

export function detectar() {
  const menor = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  const dedoPrincipal = mq("(pointer: coarse)");
  const mouse = mq("(pointer: fine)") && mq("(hover: hover)");
  const toque = dedoPrincipal || (navigator.maxTouchPoints ?? 0) > 0;
  if (ler(CHAVE_CANETA) === "1" && menor >= 600) return "tablet";
  if (toque && menor < 600) return "celular";
  if (mouse && !dedoPrincipal) return "computador";
  if (dedoPrincipal) return "tablet";
  return "computador";
}

export function modo() {
  if (!atual) atual = escolhido() === "auto" ? detectar() : escolhido();
  return atual;
}

/* Põe a classe no <html> (o CSS decide o que aparece) e avisa quem ouve. */
export function aplicarModo() {
  const antes = atual;
  atual = null;
  const m = modo();
  for (const k of ["tablet", "celular", "computador"]) document.documentElement.classList.toggle(`modo-${k}`, k === m);
  if (antes && antes !== m) for (const fn of ouvintes) { try { fn(m); } catch { /* ouvinte quebrado não derruba os outros */ } }
  return m;
}

export function escolherModo(valor) {
  gravar(CHAVE_MODO, MODOS[valor] ? valor : "auto");
  return aplicarModo();
}

export function aoMudarModo(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

/* Ferramenta com que a página abre: cada aparelho lembra a sua. No tablet,
   vale também a que veio do servidor (continuidade entre tablets). */
export function ferramentaInicial(doServidor) {
  const salva = ler(`carta.ferramenta.${modo()}`);
  if (modo() === "celular") return "mao";                       // desenhar no celular é sempre escolha explícita
  if (salva) return salva;
  return modo() === "tablet" ? (doServidor || "caneta") : "mao";
}
export function lembrarFerramenta(f) { gravar(`carta.ferramenta.${modo()}`, f); }

/* A caneta se apresenta sozinha: o primeiro toque de S Pen vale por um ajuste. */
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "pen" || ler(CHAVE_CANETA) === "1") return;
  gravar(CHAVE_CANETA, "1");
  if (escolhido() === "auto") aplicarModo();
}, { capture: true, passive: true });
