/* ==========================================================================
   roteador.ts — registro de rotas com autorização DECLARADA na assinatura.

   Toda rota diz se exige sessão (`autenticada: true` é o padrão). Não existe
   caminho para registrar um endpoint e "esquecer" a autenticação: quem quer
   rota pública escreve `autenticada: false` de próprio punho — e só o login
   e o /saude fazem isso.
   ========================================================================== */
import { erroValidacao } from "../nucleo/erros.ts";
import { dataValida } from "../nucleo/datas.ts";

export interface Sessao {
  usuarioId: string;
  sessaoId: string;
  email: string;
  nome: string;
}

export interface Contexto {
  metodo: string;
  caminho: string;
  params: Record<string, string>;
  query: URLSearchParams;
  corpo: unknown;
  ip: string;
  sessao: Sessao | null;   // preenchida quando a rota é autenticada
}

export interface Resposta {
  status?: number;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

export type Tratador = (ctx: Contexto) => Promise<Resposta>;

export interface OpcoesRota {
  autenticada?: boolean;
}

interface Rota {
  metodo: string;
  padrao: string;
  segmentos: string[];
  autenticada: boolean;
  tratador: Tratador;
}

export class Roteador {
  private rotas: Rota[] = [];

  registrar(metodo: string, padrao: string, tratador: Tratador, opcoes?: OpcoesRota): void {
    if (!padrao.startsWith("/")) throw new Error(`Rota sem "/" inicial: ${padrao}`);
    this.rotas.push({
      metodo: metodo.toUpperCase(),
      padrao,
      segmentos: padrao.split("/").filter(Boolean),
      autenticada: opcoes?.autenticada ?? true,
      tratador,
    });
  }

  get(p: string, t: Tratador, o?: OpcoesRota) { this.registrar("GET", p, t, o); }
  post(p: string, t: Tratador, o?: OpcoesRota) { this.registrar("POST", p, t, o); }
  put(p: string, t: Tratador, o?: OpcoesRota) { this.registrar("PUT", p, t, o); }
  delete(p: string, t: Tratador, o?: OpcoesRota) { this.registrar("DELETE", p, t, o); }

  achar(metodo: string, caminho: string): { rota: Rota; params: Record<string, string> } | null {
    const partes = caminho.split("/").filter(Boolean);
    for (const rota of this.rotas) {
      if (rota.metodo !== metodo.toUpperCase()) continue;
      if (rota.segmentos.length !== partes.length) continue;
      const params: Record<string, string> = {};
      let bate = true;
      for (let i = 0; i < partes.length; i++) {
        const seg = rota.segmentos[i]!;
        const parte = partes[i]!;
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parte);
        else if (seg !== parte) { bate = false; break; }
      }
      if (bate) return { rota, params };
    }
    return null;
  }

  listar(): string[] {
    return this.rotas.map((r) => `${r.metodo} ${r.padrao}${r.autenticada ? "" : " (pública)"}`);
  }
}

/* ---------- Validação de corpo, usada por toda a API ----------
   Nunca confiar em dado do frontend: cada campo passa por aqui antes de
   tocar o banco. */
export function corpoObjeto(ctx: Contexto): Record<string, unknown> {
  if (typeof ctx.corpo !== "object" || ctx.corpo === null || Array.isArray(ctx.corpo)) {
    throw erroValidacao("O corpo da requisição deve ser um objeto JSON.");
  }
  return ctx.corpo as Record<string, unknown>;
}

export function texto(o: Record<string, unknown>, campo: string, opcoes?: { obrigatorio?: boolean; max?: number; padrao?: string }): string {
  const v = o[campo];
  const max = opcoes?.max ?? 4000;
  if (v === undefined || v === null || v === "") {
    if (opcoes?.obrigatorio) throw erroValidacao(`Campo obrigatório: ${campo}.`, { campo });
    return opcoes?.padrao ?? "";
  }
  if (typeof v !== "string") throw erroValidacao(`Campo ${campo} deve ser texto.`, { campo });
  const limpo = v.trim();
  if (opcoes?.obrigatorio && !limpo) throw erroValidacao(`Campo obrigatório: ${campo}.`, { campo });
  if (limpo.length > max) throw erroValidacao(`Campo ${campo} excede ${max} caracteres.`, { campo });
  return limpo;
}

export function opcaoDe(o: Record<string, unknown>, campo: string, validas: readonly string[], padrao: string): string {
  const v = o[campo];
  if (v === undefined || v === null || v === "") return padrao;
  if (typeof v !== "string" || !validas.includes(v)) {
    throw erroValidacao(`Campo ${campo} deve ser um de: ${validas.join(", ")}.`, { campo });
  }
  return v;
}

export function inteiro(o: Record<string, unknown>, campo: string, opcoes?: { obrigatorio?: boolean; padrao?: number; min?: number; max?: number }): number {
  const v = o[campo];
  if (v === undefined || v === null || v === "") {
    if (opcoes?.obrigatorio) throw erroValidacao(`Campo obrigatório: ${campo}.`, { campo });
    return opcoes?.padrao ?? 0;
  }
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw erroValidacao(`Campo ${campo} deve ser numérico.`, { campo });
  const arred = Math.round(n);
  if (opcoes?.min !== undefined && arred < opcoes.min) throw erroValidacao(`Campo ${campo} abaixo do mínimo (${opcoes.min}).`, { campo });
  if (opcoes?.max !== undefined && arred > opcoes.max) throw erroValidacao(`Campo ${campo} acima do máximo (${opcoes.max}).`, { campo });
  return arred;
}

/* Número opcional: "" e null viram NULL no banco — nunca 0 disfarçado de
   ausência (uma nota em branco não é nota zero). */
export function numeroOuNulo(o: Record<string, unknown>, campo: string, opcoes?: { min?: number; max?: number }): number | null {
  const v = o[campo];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n)) throw erroValidacao(`Campo ${campo} deve ser numérico.`, { campo });
  if (opcoes?.min !== undefined && n < opcoes.min) throw erroValidacao(`Campo ${campo} abaixo do mínimo (${opcoes.min}).`, { campo });
  if (opcoes?.max !== undefined && n > opcoes.max) throw erroValidacao(`Campo ${campo} acima do máximo (${opcoes.max}).`, { campo });
  return n;
}

export function numero(o: Record<string, unknown>, campo: string, opcoes?: { obrigatorio?: boolean; padrao?: number; min?: number; max?: number }): number {
  const n = numeroOuNulo(o, campo, opcoes);
  if (n === null) {
    if (opcoes?.obrigatorio) throw erroValidacao(`Campo obrigatório: ${campo}.`, { campo });
    return opcoes?.padrao ?? 0;
  }
  return n;
}

export function data(o: Record<string, unknown>, campo: string, opcoes?: { obrigatorio?: boolean }): string | null {
  const v = o[campo];
  if (v === undefined || v === null || v === "") {
    if (opcoes?.obrigatorio) throw erroValidacao(`Campo obrigatório: ${campo}.`, { campo });
    return null;
  }
  if (typeof v !== "string" || !dataValida(v)) throw erroValidacao(`Campo ${campo} deve ser uma data AAAA-MM-DD válida.`, { campo });
  return v;
}

export function booleano(o: Record<string, unknown>, campo: string, padrao = false): number {
  const v = o[campo];
  if (v === undefined || v === null) return padrao ? 1 : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === 1 || v === "1" || v === "true") return 1;
  if (v === 0 || v === "0" || v === "false") return 0;
  throw erroValidacao(`Campo ${campo} deve ser booleano.`, { campo });
}

/* Paginação de lista: página (≥1) e itens por página (1..200). */
export function paginacao(query: URLSearchParams, padrao = 20): { pagina: number; porPagina: number; deslocamento: number } {
  const pagina = Math.max(1, Math.floor(Number(query.get("pagina") ?? 1)) || 1);
  const porPagina = Math.min(200, Math.max(1, Math.floor(Number(query.get("por_pagina") ?? padrao)) || padrao));
  return { pagina, porPagina, deslocamento: (pagina - 1) * porPagina };
}

/* Lista de textos (alternativas de questão, etiquetas). Guardada como JSON. */
export function listaDeTextos(o: Record<string, unknown>, campo: string, opcoes?: { min?: number; max?: number; maxItem?: number }): string[] {
  const v = o[campo];
  if (v === undefined || v === null) {
    if (opcoes?.min) throw erroValidacao(`Campo obrigatório: ${campo}.`, { campo });
    return [];
  }
  if (!Array.isArray(v)) throw erroValidacao(`Campo ${campo} deve ser uma lista.`, { campo });
  const itens = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  if (opcoes?.min !== undefined && itens.length < opcoes.min) throw erroValidacao(`Campo ${campo} precisa de pelo menos ${opcoes.min} itens.`, { campo });
  if (opcoes?.max !== undefined && itens.length > opcoes.max) throw erroValidacao(`Campo ${campo} aceita no máximo ${opcoes.max} itens.`, { campo });
  for (const it of itens) if (it.length > (opcoes?.maxItem ?? 2000)) throw erroValidacao(`Item de ${campo} longo demais.`, { campo });
  return itens;
}
