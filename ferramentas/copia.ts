/* ==========================================================================
   copia.ts — cópia de segurança do caderno.

   `VACUUM INTO` gera um arquivo consistente a partir de um banco em WAL, sem
   parar o serviço e sem depender do binário sqlite3. Guarda 30 cópias em
   backups/ (uma por dia); o LA Backup leva a pasta para o R2 às 04:00.

   Uso:  node ferramentas/copia.ts            (roda pelo lacarta-backup.timer)
   ========================================================================== */
import { readdirSync, unlinkSync, statSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config, RAIZ } from "../src/nucleo/config.ts";

const GUARDAR = 30;

async function principal(): Promise<void> {
  if (config.banco.tipo !== "sqlite") {
    console.log("  banco não é SQLite — a cópia é do PostgreSQL (pg_dump), não deste script.");
    return;
  }
  if (!existsSync(config.banco.sqlite)) {
    console.log(`  sem banco em ${config.banco.sqlite} — nada a copiar.`);
    return;
  }
  const pasta = resolve(RAIZ, "backups");
  mkdirSync(pasta, { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.banco.sqlite, { readOnly: true });
  const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const destino = resolve(pasta, `carta-${carimbo}.db`);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  db.close();
  const tamanho = statSync(destino).size;
  console.log(`  cópia: ${destino} (${Math.round(tamanho / 1024)} KB)`);

  const antigas = readdirSync(pasta).filter((f) => /^carta-.*\.db$/.test(f)).sort();
  while (antigas.length > GUARDAR) {
    const f = antigas.shift()!;
    unlinkSync(resolve(pasta, f));
    console.log(`  apagada: ${f}`);
  }
}

principal().catch((e) => {
  console.error("  ✖ cópia falhou:", (e as Error).message);
  process.exit(1);
});
