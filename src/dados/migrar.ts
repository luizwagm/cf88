/* ==========================================================================
   migrar.ts — aplica sql/NNN_*.sql em ordem, uma vez cada, com hash de
   controle. Migração aplicada que mudou de conteúdo é ERRO FATAL: o conserto
   é sempre uma migração nova, nunca editar a antiga.
   ========================================================================== */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { RAIZ, config, conferirConfig } from "../nucleo/config.ts";
import { sha256 } from "../nucleo/cripto.ts";
import { agoraISO } from "../nucleo/datas.ts";
import { abrirBanco, type Q } from "./bd.ts";

const PASTA = resolve(RAIZ, "sql");

function arquivos(): string[] {
  return readdirSync(PASTA).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
}

export async function migrar(q?: Q): Promise<{ aplicadas: string[]; puladas: string[] }> {
  const banco = q ?? (await abrirBanco());
  const aplicadas: string[] = [];
  const puladas: string[] = [];

  const jaAplicadas = new Map<string, string>();
  const existe = banco.motor === "sqlite"
    ? await banco.get<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='migracoes'")
    : await banco.get<{ existe: boolean }>("SELECT to_regclass('public.migracoes') IS NOT NULL AS existe");
  const tabelaExiste = banco.motor === "sqlite"
    ? (existe as { n: number } | undefined)?.n === 1
    : Boolean((existe as { existe: boolean } | undefined)?.existe);

  if (tabelaExiste) {
    for (const l of await banco.all<{ arquivo: string; sha256: string }>("SELECT arquivo, sha256 FROM migracoes")) {
      jaAplicadas.set(l.arquivo, l.sha256);
    }
  }

  for (const arquivo of arquivos()) {
    const conteudo = readFileSync(resolve(PASTA, arquivo), "utf8");
    const hash = sha256(conteudo);
    const anterior = jaAplicadas.get(arquivo);
    if (anterior) {
      if (anterior !== hash) {
        throw new Error(`${arquivo} foi ALTERADO depois de aplicado. Migração aplicada não se edita — crie um arquivo novo.`);
      }
      puladas.push(arquivo);
      continue;
    }
    await banco.transacao(async (t) => {
      for (const comando of quebrarComandos(conteudo)) await t.run(comando);
      await t.run("INSERT INTO migracoes (arquivo, sha256, aplicada_em) VALUES (?, ?, ?)", arquivo, hash, agoraISO());
    });
    aplicadas.push(arquivo);
  }
  return { aplicadas, puladas };
}

export function quebrarComandos(sql: string): string[] {
  const comandos: string[] = [];
  let atual = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      const fim = acharFim(sql, i, c);
      atual += sql.slice(i, fim);
      i = fim;
    } else if (c === "-" && sql[i + 1] === "-") {
      const fim = sql.indexOf("\n", i);
      i = fim === -1 ? sql.length : fim;
    } else if (c === ";") {
      if (atual.trim()) comandos.push(atual.trim());
      atual = "";
      i += 1;
    } else {
      atual += c;
      i += 1;
    }
  }
  if (atual.trim()) comandos.push(atual.trim());
  return comandos;
}

function acharFim(sql: string, inicio: number, aspa: string): number {
  let i = inicio + 1;
  while (i < sql.length) {
    if (sql[i] === aspa) {
      if (sql[i + 1] === aspa) { i += 2; continue; }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

if (import.meta.filename === process.argv[1]) {
  conferirConfig();
  console.log(`\n  LA Carta — migração (${config.ambiente}, ${config.banco.tipo})\n`);
  migrar()
    .then(({ aplicadas, puladas }) => {
      for (const a of aplicadas) console.log(`  → ${a} ok`);
      console.log(`\n  ${aplicadas.length} aplicada(s), ${puladas.length} já em dia.\n`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("\n  ✖", (e as Error).message, "\n");
      process.exit(1);
    });
}
