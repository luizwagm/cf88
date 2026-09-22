/* ==========================================================================
   datas.ts — datas viajam como TEXTO ISO ("2026-09-13") pelo sistema
   inteiro. Objetos Date só existem dentro das funções, na hora de calcular:
   texto ISO ordena certo em SQL, serializa sem fuso e é igual nos dois
   bancos (SQLite e Postgres).
   ========================================================================== */

export function hojeISO(agora: Date = new Date()): string {
  return agora.toISOString().slice(0, 10);
}

/* "Hoje" no fuso do aluno. Às 22h em Caruaru já é amanhã em UTC — e a
   sessão de estudo, o streak e o "vencido" precisam do dia LOCAL. */
export const FUSO_PADRAO = "America/Recife";
const formatadores = new Map<string, Intl.DateTimeFormat>();
export function hojeLocal(fuso: string = FUSO_PADRAO, agora: Date = new Date()): string {
  let f = formatadores.get(fuso);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_PADRAO, year: "numeric", month: "2-digit", day: "2-digit" });
    }
    formatadores.set(fuso, f);
  }
  return f.format(agora); // en-CA imprime AAAA-MM-DD
}

export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function diasEntre(inicioISO: string, fimISO: string): number {
  const a = new Date(inicioISO + "T00:00:00Z").getTime();
  const b = new Date(fimISO + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* Segunda-feira da semana da data (semana ISO começa na segunda). */
export function inicioDaSemana(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dia = d.getUTCDay(); // 0 = domingo
  const recuo = dia === 0 ? 6 : dia - 1;
  return somarDias(iso, -recuo);
}

export function agoraISO(): string {
  return new Date().toISOString();
}
