/* ==========================================================================
   log.ts — log estruturado em uma linha por evento (JSON), fácil de grepar
   no journalctl. Nunca loga senha, hash, token ou chave de API — quem chama
   é responsável por não passar; aqui há uma última linha de defesa por nome
   de chave.
   ========================================================================== */
const CHAVES_PROIBIDAS = /senha|password|token|segredo|secret|hash|cookie|chave|api_key/i;

function limpar(dados: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!dados) return {};
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dados)) {
    saida[k] = CHAVES_PROIBIDAS.test(k) ? "[removido]" : v;
  }
  return saida;
}

function linha(nivel: string, mensagem: string, dados?: Record<string, unknown>): void {
  if (process.env["CARTA_AMBIENTE"] === "teste" && nivel !== "erro") return;
  const registro = { t: new Date().toISOString(), nivel, mensagem, ...limpar(dados) };
  const texto = JSON.stringify(registro);
  if (nivel === "erro") console.error(texto);
  else console.log(texto);
}

export const log = {
  info: (m: string, d?: Record<string, unknown>) => linha("info", m, d),
  aviso: (m: string, d?: Record<string, unknown>) => linha("aviso", m, d),
  erro: (m: string, d?: Record<string, unknown>) => linha("erro", m, d),
};
