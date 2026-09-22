/* ==========================================================================
   texto.ts — a Constituição em memória. Carrega conteudo/cf88.json uma vez,
   indexa páginas, artigos e dispositivos e responde busca.

   O texto é IMUTÁVEL em tempo de execução: mudou a Constituição, roda-se o
   extrator de novo e sobe uma versão nova. Por isso é lido do disco uma vez
   e servido da memória — 870 KB cabem sem esforço.
   ========================================================================== */
import { readFileSync } from "node:fs";
import { config } from "../nucleo/config.ts";

export interface Dispositivo { id: string; tipo: "caput" | "paragrafo" | "inciso" | "alinea" | "item"; rotulo: string; texto: string; notas?: string[] }
export interface Artigo { id: string; rotulo: string; numero: number; sufixo?: string; dispositivos: Dispositivo[] }
export interface Pagina {
  id: string; livro: string; ordem: number;
  trilha: Array<{ rotulo: string; nome: string }>;
  rotulo: string; nome: string; artigos: Artigo[]; palavras: number;
  anterior: string | null; proxima: string | null;
}
export interface NoSumario { id: string; tipo: string; rotulo: string; nome: string; pagina?: string; filhos: NoSumario[] }
export interface Conteudo {
  fonte: string; atualizado_ate: string;
  livros: Array<{ id: string; nome: string; curto: string }>;
  sumario: NoSumario[];
  paginas: Pagina[];
}

let conteudo: Conteudo | null = null;
const paginasPorId = new Map<string, Pagina>();
const artigosPorChave = new Map<string, { pagina: Pagina; artigo: Artigo }>();
const dispositivosPorId = new Map<string, { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo }>();
interface Entrada { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo; normalizado: string }
let indice: Entrada[] = [];

export function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function carregarTexto(caminho = config.conteudo): Conteudo {
  if (conteudo) return conteudo;
  const c = JSON.parse(readFileSync(caminho, "utf8")) as Conteudo;
  for (const p of c.paginas) {
    paginasPorId.set(p.id, p);
    for (const a of p.artigos) {
      artigosPorChave.set(`${p.livro}:${a.numero}${(a.sufixo ?? "").toLowerCase()}`, { pagina: p, artigo: a });
      for (const d of a.dispositivos) {
        dispositivosPorId.set(d.id, { pagina: p, artigo: a, dispositivo: d });
        indice.push({ pagina: p, artigo: a, dispositivo: d, normalizado: normalizar(d.texto) });
      }
    }
  }
  conteudo = c;
  return c;
}

export function texto(): Conteudo {
  if (!conteudo) throw new Error("Conteúdo não carregado — chame carregarTexto() no boot.");
  return conteudo;
}

export function pagina(id: string): Pagina | undefined {
  texto();
  return paginasPorId.get(id);
}

export function dispositivo(id: string): { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo } | undefined {
  texto();
  return dispositivosPorId.get(id);
}

/* Sumário leve para o índice e a estante: sem o texto dos dispositivos. */
export function sumarioLeve() {
  const c = texto();
  return {
    fonte: c.fonte,
    atualizado_ate: c.atualizado_ate,
    livros: c.livros,
    sumario: c.sumario,
    paginas: c.paginas.map((p) => ({
      id: p.id, livro: p.livro, ordem: p.ordem, rotulo: p.rotulo, nome: p.nome, trilha: p.trilha,
      palavras: p.palavras, artigos: p.artigos.map((a) => a.rotulo),
      anterior: p.anterior, proxima: p.proxima,
    })),
  };
}

/* "art 5", "art. 37", "adct 2", "art 5 iv": salto direto para o artigo. */
export function acharArtigo(consulta: string): { pagina: Pagina; artigo: Artigo } | undefined {
  const q = normalizar(consulta);
  const m = /^(?:(adct)\s*)?(?:art\.?s?\.?\s*)?(\d{1,3})\s*(?:-\s*)?([a-e])?\b(?:\s*(?:do\s+)?(adct))?/.exec(q);
  if (!m) return undefined;
  const livro = m[1] || m[4] ? "adct" : "cf";
  const numero = Number(m[2]);
  const sufixo = m[3] ? `-${m[3]}` : "";
  return artigosPorChave.get(`${livro}:${numero}${sufixo}`) ?? (sufixo ? undefined : artigosPorChave.get(`${livro}:${numero}`));
}

export interface ResultadoBusca {
  pagina_id: string; pagina_rotulo: string; pagina_nome: string; trilha: string;
  artigo_id: string; artigo_rotulo: string; dispositivo_id: string; dispositivo_rotulo: string; trecho: string;
}

/* Busca por todas as palavras (AND) sem acento; devolve o trecho com contexto. */
export function buscar(consulta: string, limite = 60): { total: number; itens: ResultadoBusca[]; artigo: { pagina_id: string; artigo_id: string } | null } {
  texto();
  const q = normalizar(consulta);
  const termos = q.split(" ").filter((t) => t.length >= 2);
  const salto = acharArtigo(consulta);
  const artigo = salto ? { pagina_id: salto.pagina.id, artigo_id: salto.artigo.id } : null;
  if (!termos.length) return { total: 0, itens: [], artigo };
  const itens: ResultadoBusca[] = [];
  let total = 0;
  for (const e of indice) {
    if (!termos.every((t) => e.normalizado.includes(t))) continue;
    total += 1;
    if (itens.length >= limite) continue;
    const pos = e.normalizado.indexOf(termos[0]!);
    const inicio = Math.max(0, pos - 70);
    const fim = Math.min(e.dispositivo.texto.length, pos + termos[0]!.length + 110);
    const trecho = (inicio > 0 ? "…" : "") + e.dispositivo.texto.slice(inicio, fim) + (fim < e.dispositivo.texto.length ? "…" : "");
    itens.push({
      pagina_id: e.pagina.id, pagina_rotulo: e.pagina.rotulo, pagina_nome: e.pagina.nome,
      trilha: e.pagina.trilha.map((t) => t.rotulo).join(" › "),
      artigo_id: e.artigo.id, artigo_rotulo: e.artigo.rotulo,
      dispositivo_id: e.dispositivo.id, dispositivo_rotulo: e.dispositivo.rotulo, trecho,
    });
  }
  return { total, itens, artigo };
}
