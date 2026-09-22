/* ==========================================================================
   api.js — cliente da API. Toda mutação leva o cabeçalho anti-CSRF; 401
   derruba para a tela de login. Falha de REDE vira ErroApi com status 0:
   é assim que o armazém distingue "sem internet" de "o servidor recusou".
   ========================================================================== */

export class ErroApi extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

let aoPerderSessao = () => {};
export function definirQuedaDeSessao(fn) { aoPerderSessao = fn; }

const TEMPO_LIMITE_MS = 12_000;

async function requisicao(metodo, caminho, corpo, opcoes = {}) {
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), opcoes.tempoLimite ?? TEMPO_LIMITE_MS);
  const init = {
    method: metodo,
    headers: { "X-Requisicao": "carta" },
    credentials: "same-origin",
    signal: controle.signal,
  };
  if (opcoes.keepalive) init.keepalive = true;
  if (corpo !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(corpo);
  }
  let resposta;
  try {
    resposta = await fetch(caminho, init);
  } catch (e) {
    clearTimeout(tempo);
    /* TypeError (sem rede) ou AbortError (demorou demais): para o caderno é a
       mesma coisa — não há servidor agora. */
    throw new ErroApi(0, e.name === "AbortError" ? "O servidor não respondeu a tempo." : "Sem internet.");
  }
  clearTimeout(tempo);
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 && caminho !== "/api/v1/entrar") {
    aoPerderSessao();
    throw new ErroApi(401, "Sessão expirada.");
  }
  if (!resposta.ok) throw new ErroApi(resposta.status, dados.erro || "Erro inesperado.", dados.detalhes);
  return dados;
}

export const api = {
  requisicao,
  get: (caminho) => requisicao("GET", caminho),
  post: (caminho, corpo, opcoes) => requisicao("POST", caminho, corpo ?? {}, opcoes),
  put: (caminho, corpo) => requisicao("PUT", caminho, corpo ?? {}),
  del: (caminho) => requisicao("DELETE", caminho),
};

/* Monta query string ignorando vazios. */
export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
