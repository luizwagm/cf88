/* ==========================================================================
   texto.ts — o Vade Mecum em memória.

   conteudo/indice.json lista as OBRAS (a Constituição e cada lei); cada uma
   tem o seu arquivo no mesmo formato — sumário em árvore + páginas com
   artigos e dispositivos. Tudo é lido uma vez no boot e servido da memória:
   ~13 MB de texto e um índice de busca sem acento.

   O texto é IMUTÁVEL em tempo de execução. Lei mudou: `npm run leis --
   --atualizar`, commit, deploy. Os ids (página, artigo, dispositivo) são
   globais e estáveis — as anotações do estudante apontam para eles.
   ========================================================================== */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { config } from "../nucleo/config.ts";

export interface Dispositivo { id: string; tipo: "caput" | "paragrafo" | "inciso" | "alinea" | "item" | "pena" | "rubrica" | "citacao"; rotulo: string; texto: string; notas?: string[] }
export interface Artigo { id: string; rotulo: string; numero: number; sufixo?: string; rubrica?: string; dispositivos: Dispositivo[] }
export interface Pagina {
  id: string; livro: string; obra?: string; ordem: number;
  trilha: Array<{ rotulo: string; nome: string }>;
  rotulo: string; nome: string; artigos: Artigo[]; palavras: number;
  anterior: string | null; proxima: string | null;
}
export interface NoSumario { id: string; tipo: string; rotulo: string; nome: string; pagina?: string; filhos: NoSumario[] }
export interface Conteudo {
  fonte: string; atualizado_ate: string;
  livros?: Array<{ id: string; nome: string; curto: string }>;
  sumario: NoSumario[];
  paginas: Pagina[];
}
export interface MetaObra {
  id: string; sigla: string; nome: string; identificacao: string; categoria: string; arquivo: string; prefixos: string[];
  paginas: number; artigos: number; palavras: number; fonte: string; url: string; baixado_em: string; atualizado_ate: string; ementa: string;
  ordem: number;
}
interface ObraCarregada { meta: MetaObra; conteudo: Conteudo }

let carregado = false;
let categoriasDoIndice: string[] = [];
const obrasPorId = new Map<string, ObraCarregada>();
const listaDeObras: MetaObra[] = [];
const paginasPorId = new Map<string, Pagina>();
const obraDaPaginaId = new Map<string, MetaObra>();
const artigosPorChave = new Map<string, { pagina: Pagina; artigo: Artigo }>();
const dispositivosPorId = new Map<string, { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo }>();
const apelidos = new Map<string, { obra: string; livro: string }>();
interface Entrada { obra: MetaObra; pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo; normalizado: string }
const indice: Entrada[] = [];

export function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const chaveSigla = (t: string) => normalizar(t).replace(/[^a-z0-9]/g, "");
const chaveSufixo = (s: string | undefined) => (s ? "-" + s.replace(/^-/, "").toLowerCase() : "");

const META_CF: Omit<MetaObra, "paginas" | "artigos" | "palavras" | "fonte" | "atualizado_ate" | "ordem"> = {
  id: "cf", sigla: "CF/88", nome: "Constituição da República Federativa do Brasil", identificacao: "Promulgada em 5 de outubro de 1988",
  categoria: "Constitucional", arquivo: "cf88.json", prefixos: ["cf", "adct"], url: "", baixado_em: "", ementa: "",
};

function registrar(meta: MetaObra, c: Conteudo): void {
  obrasPorId.set(meta.id, { meta, conteudo: c });
  listaDeObras.push(meta);
  for (const p of c.paginas) {
    p.obra = meta.id;
    paginasPorId.set(p.id, p);
    obraDaPaginaId.set(p.id, meta);
    for (const a of p.artigos) {
      const chave = `${p.livro}:${a.numero}${chaveSufixo(a.sufixo)}`;
      if (!artigosPorChave.has(chave)) artigosPorChave.set(chave, { pagina: p, artigo: a });
      for (const d of a.dispositivos) {
        dispositivosPorId.set(d.id, { pagina: p, artigo: a, dispositivo: d });
        indice.push({ obra: meta, pagina: p, artigo: a, dispositivo: d, normalizado: normalizar(d.texto) });
      }
    }
  }
  for (const nome of [meta.id, meta.sigla, ...(meta.id === "cf" ? ["cf", "cf88", "constituicao", "crfb"] : [])]) {
    const k = chaveSigla(nome);
    if (k && !apelidos.has(k)) apelidos.set(k, { obra: meta.id, livro: meta.id === "cf" ? "cf" : meta.id });
  }
  if (meta.id === "cf") apelidos.set("adct", { obra: "cf", livro: "adct" });
}

export function carregarTexto(caminhoCf = config.conteudo): Conteudo {
  if (carregado) return obrasPorId.get("cf")!.conteudo;
  const pasta = dirname(caminhoCf);
  const cf = JSON.parse(readFileSync(caminhoCf, "utf8")) as Conteudo;
  const arqIndice = resolve(pasta, "indice.json");
  const metas: Array<Omit<MetaObra, "ordem">> = [];
  if (existsSync(arqIndice)) {
    const ind = JSON.parse(readFileSync(arqIndice, "utf8")) as { categorias: string[]; obras: Array<Omit<MetaObra, "ordem">> };
    categoriasDoIndice = ind.categorias;
    metas.push(...ind.obras);
  }
  if (!metas.some((m) => m.id === "cf")) {
    metas.unshift({ ...META_CF, paginas: cf.paginas.length, artigos: cf.paginas.reduce((s, p) => s + p.artigos.length, 0), palavras: cf.paginas.reduce((s, p) => s + p.palavras, 0), fonte: cf.fonte, atualizado_ate: cf.atualizado_ate });
  }
  if (!categoriasDoIndice.length) categoriasDoIndice = ["Constitucional"];
  metas.forEach((m, i) => {
    const arq = resolve(pasta, m.arquivo);
    if (m.id !== "cf" && !existsSync(arq)) return;                       // índice à frente do disco: ignora a obra, não derruba o boot
    const c = m.id === "cf" ? cf : (JSON.parse(readFileSync(arq, "utf8")) as Conteudo);
    registrar({ ...m, ordem: i }, c);
  });
  carregado = true;
  return cf;
}

function exigir(): void {
  if (!carregado) throw new Error("Conteúdo não carregado — chame carregarTexto() no boot.");
}

/* A Constituição (compatível com o que o sistema sempre devolveu). */
export function texto(): Conteudo {
  exigir();
  return obrasPorId.get("cf")!.conteudo;
}
export function obras(): MetaObra[] { exigir(); return listaDeObras; }
export function categorias(): string[] { exigir(); return categoriasDoIndice; }
export function obra(id: string): ObraCarregada | undefined { exigir(); return obrasPorId.get(id); }
export function obraDaPagina(paginaId: string): MetaObra | undefined { exigir(); return obraDaPaginaId.get(paginaId); }
export function totalDePaginas(): number { exigir(); return paginasPorId.size; }

export function pagina(id: string): Pagina | undefined {
  exigir();
  return paginasPorId.get(id);
}

export function dispositivo(id: string): { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo } | undefined {
  exigir();
  return dispositivosPorId.get(id);
}

/* Ordem global de uma página: a obra na ordem do índice, depois a página na obra. */
export function ordemGlobal(paginaId: string): number {
  const p = paginasPorId.get(paginaId);
  const o = obraDaPaginaId.get(paginaId);
  return p && o ? o.ordem * 100_000 + p.ordem : 0;
}

/* Sumário leve de uma obra: sem o texto dos dispositivos. */
export function sumarioLeve(obraId = "cf") {
  exigir();
  const o = obrasPorId.get(obraId);
  if (!o) return undefined as never;
  const c = o.conteudo;
  return {
    obra: o.meta,
    fonte: c.fonte ?? o.meta.fonte,
    atualizado_ate: c.atualizado_ate ?? o.meta.atualizado_ate,
    livros: c.livros ?? [{ id: o.meta.id, nome: o.meta.nome, curto: o.meta.sigla }],
    sumario: c.sumario,
    paginas: c.paginas.map((p) => ({
      id: p.id, livro: p.livro, obra: o.meta.id, ordem: p.ordem, rotulo: p.rotulo, nome: p.nome, trilha: p.trilha,
      palavras: p.palavras, artigos: p.artigos.map((a) => ({ id: a.id, rotulo: a.rotulo })),
      anterior: p.anterior, proxima: p.proxima,
    })),
  };
}
export function existeObra(id: string): boolean { exigir(); return obrasPorId.has(id); }

/* "art 5", "art. 37", "adct 2", "121 cp", "cc 1.639", "art. 149-b":
   salto direto para o artigo. Sem sigla, vale a obra em que o leitor está. */
export function acharArtigo(consulta: string, obraPadrao = "cf"): { pagina: Pagina; artigo: Artigo; obra: MetaObra } | undefined {
  exigir();
  let q = normalizar(consulta).replace(/[º°ª]/g, "").replace(/\s+/g, " ").trim();
  let alvo = apelidos.get(chaveSigla(obraPadrao)) ?? { obra: obraPadrao, livro: obraPadrao === "cf" ? "cf" : obraPadrao };
  /* sigla no começo ("cp 121") ou no fim ("121 do cp") */
  const inicio = /^([a-z][a-z0-9/. ]*?)\s+(?=(?:arts?\.?\s*)?\d)/.exec(q);
  if (inicio && !/^arts?\.?$/.test(inicio[1]!) && apelidos.has(chaveSigla(inicio[1]!))) { alvo = apelidos.get(chaveSigla(inicio[1]!))!; q = q.slice(inicio[0].length); }
  else {
    const fim = /\s+(?:d[oa]s?\s+)?([a-z][a-z0-9/. ]*)$/.exec(q);
    if (fim && apelidos.has(chaveSigla(fim[1]!)) && !/^[a-e]$/.test(fim[1]!.trim())) { alvo = apelidos.get(chaveSigla(fim[1]!))!; q = q.slice(0, fim.index); }
  }
  const m = /^(?:arts?\.?\s*)?(\d{1,4}(?:\.\d{3})?)\s*(?:-\s*|\s+)?([a-z]{1,2}(?:-[a-z])?)?$/.exec(q.trim());
  if (!m) return undefined;
  const numero = Number(m[1]!.replace(".", ""));
  const sufixo = m[2] ? `-${m[2]}` : "";
  const achado = artigosPorChave.get(`${alvo.livro}:${numero}${sufixo}`) ?? (sufixo ? undefined : artigosPorChave.get(`${alvo.livro}:${numero}`));
  if (!achado) return undefined;
  return { ...achado, obra: obraDaPaginaId.get(achado.pagina.id)! };
}

export interface ResultadoBusca {
  obra_id: string; obra_sigla: string;
  pagina_id: string; pagina_rotulo: string; pagina_nome: string; trilha: string;
  artigo_id: string; artigo_rotulo: string; dispositivo_id: string; dispositivo_rotulo: string; trecho: string;
}

/* Busca por todas as palavras (AND) sem acento; devolve o trecho com contexto.
   `obra` restringe a uma lei; sem ela, procura no Vade Mecum inteiro. */
export function buscar(consulta: string, opcoes: { obra?: string; limite?: number; obraPadrao?: string } | number = {}): { total: number; itens: ResultadoBusca[]; artigo: { pagina_id: string; artigo_id: string; rotulo: string; obra_sigla: string } | null; por_obra: Array<{ obra_id: string; obra_sigla: string; total: number }> } {
  exigir();
  const op = typeof opcoes === "number" ? { limite: opcoes } : opcoes;
  const limite = op.limite ?? 60;
  const q = normalizar(consulta);
  const termos = q.split(" ").filter((t) => t.length >= 2);
  const salto = acharArtigo(consulta, op.obra ?? op.obraPadrao ?? "cf");
  const artigo = salto ? { pagina_id: salto.pagina.id, artigo_id: salto.artigo.id, rotulo: salto.artigo.rotulo, obra_sigla: salto.obra.sigla } : null;
  if (!termos.length) return { total: 0, itens: [], artigo, por_obra: [] };
  const itens: ResultadoBusca[] = [];
  const contagem = new Map<string, { obra_id: string; obra_sigla: string; total: number }>();
  let total = 0;
  for (const e of indice) {
    if (op.obra && e.obra.id !== op.obra) continue;
    if (!termos.every((t) => e.normalizado.includes(t))) continue;
    total += 1;
    const c = contagem.get(e.obra.id) ?? { obra_id: e.obra.id, obra_sigla: e.obra.sigla, total: 0 };
    c.total += 1;
    contagem.set(e.obra.id, c);
    if (itens.length >= limite) continue;
    const pos = e.normalizado.indexOf(termos[0]!);
    const inicio = Math.max(0, pos - 70);
    const fim = Math.min(e.dispositivo.texto.length, pos + termos[0]!.length + 110);
    const trecho = (inicio > 0 ? "…" : "") + e.dispositivo.texto.slice(inicio, fim) + (fim < e.dispositivo.texto.length ? "…" : "");
    itens.push({
      obra_id: e.obra.id, obra_sigla: e.obra.sigla,
      pagina_id: e.pagina.id, pagina_rotulo: e.pagina.rotulo, pagina_nome: e.pagina.nome,
      trilha: e.pagina.trilha.map((t) => t.rotulo).join(" › "),
      artigo_id: e.artigo.id, artigo_rotulo: e.artigo.rotulo,
      dispositivo_id: e.dispositivo.id, dispositivo_rotulo: e.dispositivo.rotulo, trecho,
    });
  }
  return { total, itens, artigo, por_obra: [...contagem.values()].sort((a, b) => b.total - a.total) };
}
