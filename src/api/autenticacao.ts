/* ==========================================================================
   autenticacao.ts — entrar, sair, quem sou, trocar senha.

   O login responde a MESMA mensagem para "e-mail não existe" e "senha
   errada" — enumerar contas é o primeiro passo de qualquer ataque. E o
   limitador roda ANTES de tocar o banco: tentativa barrada não custa scrypt.
   ========================================================================== */
import { banco } from "../dados/bd.ts";
import { hashSenha, verificarSenha } from "../nucleo/cripto.ts";
import { ErroHttp, erroMuitasTentativas, erroValidacao } from "../nucleo/erros.ts";
import { VERSAO } from "../nucleo/versao.ts";
import type { Roteador } from "../http/roteador.ts";
import { corpoObjeto, texto } from "../http/roteador.ts";
import { criarSessao, cookieDeLogout, encerrarSessao, encerrarTodasDoUsuario, auditar } from "../http/sessao.ts";
import { podeTentar, registrarFalha, registrarSucesso } from "../http/limitador.ts";

export function registrarAutenticacao(r: Roteador): void {
  r.post("/api/v1/entrar", async (ctx) => {
    const o = corpoObjeto(ctx);
    const email = texto(o, "email", { obrigatorio: true, max: 254 }).toLowerCase();
    const senha = texto(o, "senha", { obrigatorio: true, max: 200 });

    if (!podeTentar(ctx.ip, email)) {
      await auditar(null, "login_bloqueado", "usuarios", "", email, ctx.ip);
      throw erroMuitasTentativas();
    }

    const usuario = await banco().get<{ id: string; senha_hash: string; ativo: number }>("SELECT id, senha_hash, ativo FROM usuarios WHERE email = ?", email);
    const senhaConfere = usuario ? verificarSenha(senha, usuario.senha_hash) : falharDevagar(senha);

    if (!usuario || !senhaConfere || Number(usuario.ativo) !== 1) {
      registrarFalha(ctx.ip, email);
      await auditar(usuario?.id ?? null, "login_falha", "usuarios", usuario?.id ?? "", email, ctx.ip);
      throw new ErroHttp(401, "E-mail ou senha incorretos.");
    }

    registrarSucesso(ctx.ip, email);
    const { cookie } = await criarSessao(usuario.id);
    await auditar(usuario.id, "login", "usuarios", usuario.id, "", ctx.ip);
    return { corpo: { ok: true }, cabecalhos: { "Set-Cookie": cookie } };
  }, { autenticada: false });

  r.post("/api/v1/sair", async (ctx) => {
    await encerrarSessao(ctx.sessao!.sessaoId);
    await auditar(ctx.sessao!.usuarioId, "logout", "usuarios", ctx.sessao!.usuarioId, "", ctx.ip);
    return { corpo: { ok: true }, cabecalhos: { "Set-Cookie": cookieDeLogout() } };
  });

  r.get("/api/v1/eu", async (ctx) => ({
    corpo: { email: ctx.sessao!.email, nome: ctx.sessao!.nome, versao: VERSAO },
  }));

  r.put("/api/v1/eu", async (ctx) => {
    const o = corpoObjeto(ctx);
    const nome = texto(o, "nome", { obrigatorio: true, max: 120 });
    await banco().run("UPDATE usuarios SET nome = ? WHERE id = ?", nome, ctx.sessao!.usuarioId);
    return { corpo: { ok: true, nome } };
  });

  r.post("/api/v1/trocar-senha", async (ctx) => {
    const o = corpoObjeto(ctx);
    const atual = texto(o, "senha_atual", { obrigatorio: true, max: 200 });
    const nova = texto(o, "senha_nova", { obrigatorio: true, max: 200 });
    if (nova.length < 10) throw erroValidacao("A senha nova precisa de pelo menos 10 caracteres.");

    const usuario = await banco().get<{ senha_hash: string }>("SELECT senha_hash FROM usuarios WHERE id = ?", ctx.sessao!.usuarioId);
    if (!usuario || !verificarSenha(atual, usuario.senha_hash)) throw new ErroHttp(401, "Senha atual incorreta.");

    await banco().run("UPDATE usuarios SET senha_hash = ? WHERE id = ?", hashSenha(nova), ctx.sessao!.usuarioId);
    await encerrarTodasDoUsuario(ctx.sessao!.usuarioId);
    const { cookie } = await criarSessao(ctx.sessao!.usuarioId);
    await auditar(ctx.sessao!.usuarioId, "trocar_senha", "usuarios", ctx.sessao!.usuarioId, "", ctx.ip);
    return { corpo: { ok: true }, cabecalhos: { "Set-Cookie": cookie } };
  });
}

/* Sem usuário, ainda se paga UM scrypt de mentira: a diferença de tempo
   entre "conta existe" e "conta não existe" some da resposta. */
function falharDevagar(senha: string): boolean {
  verificarSenha(senha, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  return false;
}
