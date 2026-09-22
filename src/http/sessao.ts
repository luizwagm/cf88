/* ==========================================================================
   sessao.ts — sessões com cookie HttpOnly + SameSite=Strict.

   O token que viaja no cookie NUNCA toca o banco: o banco guarda o sha256.
   Um vazamento de banco não entrega sessões vivas — hash não autentica.
   ========================================================================== */
import { banco, novoId } from "../dados/bd.ts";
import { tokenAleatorio, sha256 } from "../nucleo/cripto.ts";
import { agoraISO } from "../nucleo/datas.ts";
import { config } from "../nucleo/config.ts";
import type { Sessao } from "./roteador.ts";

const NOME_COOKIE = "carta_sessao";
const DURACAO_DIAS = 60; // caderno pessoal no tablet: sessão longa, cookie Secure em produção

export async function criarSessao(usuarioId: string): Promise<{ token: string; cookie: string }> {
  const token = tokenAleatorio(32);
  const expira = new Date(Date.now() + DURACAO_DIAS * 86_400_000);
  await banco().run(
    "INSERT INTO sessoes (id, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)",
    sha256(token), usuarioId, agoraISO(), expira.toISOString(),
  );
  return { token, cookie: montarCookie(token, expira) };
}

function montarCookie(token: string, expira: Date): string {
  const partes = [`${NOME_COOKIE}=${token}`, "HttpOnly", "SameSite=Strict", "Path=/", `Expires=${expira.toUTCString()}`];
  if (config.producao) partes.push("Secure");
  return partes.join("; ");
}

export function cookieDeLogout(): string {
  const partes = [`${NOME_COOKIE}=`, "HttpOnly", "SameSite=Strict", "Path=/", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
  if (config.producao) partes.push("Secure");
  return partes.join("; ");
}

export function lerCookie(cabecalho: string | undefined): string | null {
  if (!cabecalho) return null;
  for (const par of cabecalho.split(";")) {
    const [nome, ...resto] = par.trim().split("=");
    if (nome === NOME_COOKIE) return resto.join("=") || null;
  }
  return null;
}

export async function validarSessao(token: string | null): Promise<Sessao | null> {
  if (!token) return null;
  const linha = await banco().get<{ id: string; usuario_id: string; expira_em: string; email: string; nome: string; ativo: number }>(
    `SELECT s.id, s.usuario_id, s.expira_em, u.email, u.nome, u.ativo
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = ?`,
    sha256(token),
  );
  if (!linha) return null;
  if (linha.expira_em <= agoraISO() || Number(linha.ativo) !== 1) {
    await banco().run("DELETE FROM sessoes WHERE id = ?", linha.id);
    return null;
  }
  return { usuarioId: linha.usuario_id, sessaoId: linha.id, email: linha.email, nome: linha.nome };
}

export async function encerrarSessao(sessaoId: string): Promise<void> {
  await banco().run("DELETE FROM sessoes WHERE id = ?", sessaoId);
}

export async function encerrarTodasDoUsuario(usuarioId: string): Promise<void> {
  await banco().run("DELETE FROM sessoes WHERE usuario_id = ?", usuarioId);
}

export async function auditar(usuarioId: string | null, acao: string, entidade: string, entidadeId: string, detalhe: string, ip: string): Promise<void> {
  await banco().run(
    "INSERT INTO auditoria (id, usuario_id, acao, entidade, entidade_id, detalhe, ip, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    novoId(), usuarioId, acao, entidade, entidadeId, detalhe, ip, agoraISO(),
  );
}
