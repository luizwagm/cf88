/* ==========================================================================
   erros.ts — erros com status HTTP e mensagem segura para o cliente.

   Só o que nasce como ErroHttp chega ao usuário com a própria mensagem; todo
   o resto vira 500 genérico (a mensagem real fica no log). Assim um erro de
   banco nunca vaza SQL, caminho de arquivo ou estrutura interna na resposta.
   ========================================================================== */

export class ErroHttp extends Error {
  status: number;
  detalhes: Record<string, string> | undefined;
  constructor(status: number, mensagem: string, detalhes?: Record<string, string>) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

export const erroValidacao = (m: string, detalhes?: Record<string, string>) => new ErroHttp(400, m, detalhes);
export const erroNaoAutenticado = () => new ErroHttp(401, "Sessão ausente ou expirada.");
export const erroProibido = () => new ErroHttp(403, "Sem permissão para este recurso.");
export const erroNaoEncontrado = (o = "Recurso") => new ErroHttp(404, `${o} não encontrado.`);
export const erroMuitasTentativas = () => new ErroHttp(429, "Muitas tentativas. Aguarde antes de tentar novamente.");
export const erroIndisponivel = (m: string) => new ErroHttp(503, m);
