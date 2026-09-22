/* ==========================================================================
   config.ts — configuração do processo, lida uma vez no boot.

   O .env é lido aqui mesmo, sem dependência: linha CHAVE=valor. Variáveis já
   presentes no ambiente (systemd, CI) têm prioridade sobre o arquivo — é
   assim que produção injeta segredo sem tocar o disco do projeto.
   ========================================================================== */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function carregarEnv(): void {
  const caminho = resolve(RAIZ, ".env");
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || !m[1]) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}
carregarEnv();

const ambiente = process.env["CARTA_AMBIENTE"] ?? "desenvolvimento";

export const config = {
  ambiente,
  producao: ambiente === "producao",
  porta: Number(process.env["PORTA"] ?? 5209),
  host: process.env["HOST"] ?? "127.0.0.1",
  banco: {
    tipo: (process.env["CARTA_BANCO"] ?? "sqlite") as "sqlite" | "postgres",
    sqlite: resolve(RAIZ, process.env["CARTA_SQLITE"] ?? "./dados/carta.db"),
    url: process.env["DATABASE_URL"] ?? "",
  },
  conteudo: resolve(RAIZ, process.env["CARTA_CONTEUDO"] ?? "./conteudo/cf88.json"),
  segredoSessao: process.env["CARTA_SEGREDO_SESSAO"] ?? "",
  proxiesConfiaveis: Number(process.env["PROXIES_CONFIAVEIS"] ?? 0),
};

/* Falha de configuração derruba o boot com mensagem nomeada — nunca sobe
   "funcionando" com segredo vazio em produção. */
export function conferirConfig(): void {
  const erros: string[] = [];
  if (!Number.isInteger(config.porta) || config.porta < 0 || config.porta > 65535)
    erros.push(`PORTA inválida: ${process.env["PORTA"]}`);
  if (config.banco.tipo !== "sqlite" && config.banco.tipo !== "postgres")
    erros.push(`CARTA_BANCO deve ser "sqlite" ou "postgres", veio "${config.banco.tipo}"`);
  if (config.banco.tipo === "postgres" && !config.banco.url)
    erros.push("CARTA_BANCO=postgres exige DATABASE_URL");
  if (!existsSync(config.conteudo))
    erros.push(`conteúdo não encontrado em ${config.conteudo} — rode: npm run extrair -- <caminho do PDF>`);
  if (config.producao && (config.segredoSessao.length < 32 || config.segredoSessao === "troque-este-segredo"))
    erros.push("CARTA_SEGREDO_SESSAO fraco ou ausente em produção (mínimo 32 caracteres)");
  if (erros.length) {
    console.error("\n  ✖ Configuração inválida:\n");
    for (const e of erros) console.error(`      · ${e}`);
    console.error("");
    process.exit(78);
  }
}
