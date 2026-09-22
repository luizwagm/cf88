/* ==========================================================================
   cripto.ts — senha com scrypt (node:crypto, sem dependência), token de
   sessão aleatório e hash de token.

   O hash guardado tem formato "scrypt$N$r$p$salBase64$chaveBase64" — os
   parâmetros viajam junto, então dá para endurecer no futuro sem quebrar as
   senhas antigas: o verificar lê os parâmetros do próprio hash.
   ========================================================================== */
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const N = 16384, R = 8, P = 1, TAMANHO = 64;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const chave = scryptSync(senha, sal, TAMANHO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${chave.toString("base64")}`;
}

export function verificarSenha(senha: string, hash: string): boolean {
  const partes = hash.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, salB64, chaveB64] = partes;
  try {
    const salvo = Buffer.from(chaveB64!, "base64");
    const calculado = scryptSync(senha, Buffer.from(salB64!, "base64"), salvo.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    return salvo.length === calculado.length && timingSafeEqual(salvo, calculado);
  } catch {
    return false;
  }
}

export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}
