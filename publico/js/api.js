/* ==========================================================================
   api.js — cliente da API. Toda mutação leva o cabeçalho anti-CSRF; 401
   derruba para a tela de login em vez de deixar a tela quebrar aos poucos.
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

async function requisicao(metodo, caminho, corpo, opcoes = {}) {
  const init = {
    method: metodo,
    headers: { "X-Requisicao": "carta" },
    credentials: "same-origin",
  };
  if (opcoes.keepalive) init.keepalive = true;
  if (corpo !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(corpo);
  }
  const resposta = await fetch(caminho, init);
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 && caminho !== "/api/v1/entrar") {
    aoPerderSessao();
    throw new ErroApi(401, "Sessão expirada.");
  }
  if (!resposta.ok) throw new ErroApi(resposta.status, dados.erro || "Erro inesperado.", dados.detalhes);
  return dados;
}

export const api = {
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
