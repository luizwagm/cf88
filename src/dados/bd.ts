/* ==========================================================================
   bd.ts — acesso a banco com DOIS motores atrás da mesma API assíncrona:

     · sqlite  (node:sqlite, embutido no Node 24) — padrão. Zero setup, um
       arquivo em ./dados/carta.db. Motor de desenvolvimento e de uso pessoal.
     · postgres (pg via DATABASE_URL) — produção. O motor é decisão de
       ambiente, não de código.

   A API é Q.get / Q.all / Q.run, sempre assíncrona — MESMO no SQLite. Com a
   API única já assíncrona desde o primeiro dia, não existe conversão futura.

   SQL em SUBCONJUNTO PORTÁVEL: placeholders `?` (traduzidos para $n no
   Postgres), tipos TEXT/INTEGER/REAL, booleanos 0/1, datas ISO em texto,
   ids TEXT gerados na aplicação. Nada de AUTOINCREMENT, SERIAL, now(), ILIKE.
   ========================================================================== */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../nucleo/config.ts";
import { tokenAleatorio } from "../nucleo/cripto.ts";

export interface Resultado { mudancas: number }

export interface Q {
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<Resultado>;
  transacao<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
  motor: "sqlite" | "postgres";
}

export function novoId(): string {
  return tokenAleatorio(20);
}

export function traduzirPlaceholders(sql: string): string {
  let saida = "";
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      const fim = acharFimAspas(sql, i, c);
      saida += sql.slice(i, fim);
      i = fim;
    } else if (c === "-" && sql[i + 1] === "-") {
      const fim = sql.indexOf("\n", i);
      const corte = fim === -1 ? sql.length : fim;
      saida += sql.slice(i, corte);
      i = corte;
    } else if (c === "?") {
      n += 1;
      saida += `$${n}`;
      i += 1;
    } else {
      saida += c;
      i += 1;
    }
  }
  return saida;
}

function acharFimAspas(sql: string, inicio: number, aspa: string): number {
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

async function abrirSqlite(caminho: string): Promise<Q> {
  const { DatabaseSync } = await import("node:sqlite");
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  const q: Q = {
    motor: "sqlite",
    async get<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, ...params: unknown[]) {
      const r = db.prepare(sql).run(...(params as never[]));
      return { mudancas: Number(r.changes) };
    },
    async transacao<T>(fn: (q: Q) => Promise<T>) {
      db.exec("BEGIN");
      try {
        const r = await fn(q);
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async fechar() { db.close(); },
  };
  return q;
}

/* Import dinâmico: o pacote pg só precisa existir quando CARTA_BANCO=postgres. */
async function abrirPostgres(url: string): Promise<Q> {
  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    throw new Error("CARTA_BANCO=postgres, mas o pacote 'pg' não está instalado. Rode: npm install pg");
  }
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 8000 });

  function fazerQ(executor: { query(sql: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> }): Q {
    return {
      motor: "postgres",
      async get<T>(sql: string, ...params: unknown[]) {
        const r = await executor.query(traduzirPlaceholders(sql), params);
        return r.rows[0] as T | undefined;
      },
      async all<T>(sql: string, ...params: unknown[]) {
        const r = await executor.query(traduzirPlaceholders(sql), params);
        return r.rows as T[];
      },
      async run(sql: string, ...params: unknown[]) {
        const r = await executor.query(traduzirPlaceholders(sql), params);
        return { mudancas: r.rowCount ?? 0 };
      },
      async transacao<T>(fn: (q: Q) => Promise<T>) {
        const cliente = await pool.connect();
        try {
          await cliente.query("BEGIN");
          const r = await fn(fazerQ(cliente));
          await cliente.query("COMMIT");
          return r;
        } catch (e) {
          await cliente.query("ROLLBACK");
          throw e;
        } finally {
          cliente.release();
        }
      },
      async fechar() { await pool.end(); },
    };
  }
  return fazerQ(pool);
}

let instancia: Q | null = null;

export async function abrirBanco(destino?: { tipo: "sqlite" | "postgres"; caminhoOuUrl: string }): Promise<Q> {
  if (instancia) return instancia;
  const tipo = destino?.tipo ?? config.banco.tipo;
  instancia = tipo === "postgres"
    ? await abrirPostgres(destino?.caminhoOuUrl ?? config.banco.url)
    : await abrirSqlite(destino?.caminhoOuUrl ?? config.banco.sqlite);
  return instancia;
}

export function banco(): Q {
  if (!instancia) throw new Error("Banco não aberto — chame abrirBanco() no boot.");
  return instancia;
}

export async function fecharBanco(): Promise<void> {
  if (instancia) {
    await instancia.fechar();
    instancia = null;
  }
}
