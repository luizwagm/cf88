/* ==========================================================================
   texto.ts — o Vade Mecum em memória.

   DUAS FONTES para as leis, vence a mais nova (campo `gerado_em` do índice):

     · conteudo/          — o que veio no repositório (commit + deploy);
     · dados/leis/        — o que o serviço diário baixou do Planalto
                            (ferramentas/leis/atualizar.ts), fora do git.

   A Constituição vem sempre de conteudo/cf88.json (PDF do Senado).

   RECARGA A QUENTE: `recarregarSeMudou()` confere o índice da fonte; se ele
   mudou, monta um ESTADO novo inteiro e troca a referência de uma vez. Quem
   está no meio de uma busca termina com o estado velho; o próximo pedido já
   lê o novo. Nada de reiniciar o serviço para a lei nova aparecer.

   Os ids (página, artigo, dispositivo) são globais e estáveis — as
   anotações do estudante apontam para eles.
   ========================================================================== */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
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
  versao: string;          // hash do arquivo da obra: muda quando o texto muda
}
export interface Atualizacao { em: string; obra_id: string; sigla: string; tipo: "nova" | "alterada"; antes: string; depois: string; textos?: number; notas?: number }
export interface InfoConteudo {
  origem: "repositorio" | "atualizacao"; gerado_em: string; verificado_em: string;
  alertas: string[]; atualizacoes: Atualizacao[];
}
interface ObraCarregada { meta: MetaObra; conteudo: Conteudo }
interface Entrada { obra: MetaObra; pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo; normalizado: string }

interface Estado {
  info: InfoConteudo;
  marca: string;                          // índice escolhido + mtime: decide se recarrega
  categorias: string[];
  obras: Map<string, ObraCarregada>;
  lista: MetaObra[];
  paginas: Map<string, Pagina>;
  obraDaPagina: Map<string, MetaObra>;
  artigos: Map<string, { pagina: Pagina; artigo: Artigo }>;
  dispositivos: Map<string, { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo }>;
  apelidos: Map<string, { obra: string; livro: string }>;
  indice: Entrada[];
}

let estado: Estado | null = null;
let opcoesCarga: { cf: string; leis: string } = { cf: config.conteudo, leis: config.leis };

export function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const chaveSigla = (t: string) => normalizar(t).replace(/[^a-z0-9]/g, "");
const chaveSufixo = (s: string | undefined) => (s ? "-" + s.replace(/^-/, "").toLowerCase() : "");
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 12);

const META_CF = {
  id: "cf", sigla: "CF/88", nome: "Constituição da República Federativa do Brasil", identificacao: "Promulgada em 5 de outubro de 1988",
  categoria: "Constitucional", arquivo: "cf88.json", prefixos: ["cf", "adct"], url: "", baixado_em: "", ementa: "",
};

/* ---------- qual fonte vale agora ---------- */
interface Fonte { dir: string; indice: string; gerado_em: string; mtime: number; origem: InfoConteudo["origem"] }
function lerFonte(dir: string, origem: Fonte["origem"]): Fonte | null {
  if (!dir) return null;
  const ind = resolve(dir, "indice.json");
  if (!existsSync(ind)) return null;
  try {
    const j = JSON.parse(readFileSync(ind, "utf8")) as { gerado_em?: string };
    return { dir, indice: ind, gerado_em: String(j.gerado_em ?? ""), mtime: statSync(ind).mtimeMs, origem };
  } catch {
    return null;                                            // índice pela metade (troca em andamento): ignora
  }
}
export function escolherFonte(conteudoDir: string, leisDir: string): Fonte | null {
  const base = lerFonte(conteudoDir, "repositorio");
  const viva = lerFonte(leisDir, "atualizacao");
  if (viva && (!base || viva.gerado_em >= base.gerado_em)) return viva;
  return base;
}

function montar(cfCaminho: string, leisDir: string): Estado {
  const conteudoDir = dirname(cfCaminho);
  const cfBytes = readFileSync(cfCaminho);
  const cf = JSON.parse(cfBytes.toString("utf8")) as Conteudo;
  const fonte = escolherFonte(conteudoDir, leisDir);

  type MetaIndice = Omit<MetaObra, "ordem" | "versao">;
  let metas: MetaIndice[] = [];
  let categorias: string[] = [];
  let info: InfoConteudo = { origem: "repositorio", gerado_em: "", verificado_em: "", alertas: [], atualizacoes: [] };
  if (fonte) {
    const ind = JSON.parse(readFileSync(fonte.indice, "utf8")) as { categorias: string[]; obras: MetaIndice[]; gerado_em?: string; verificado_em?: string; alertas?: string[] };
    categorias = ind.categorias ?? [];
    metas = ind.obras ?? [];
    let atualizacoes: Atualizacao[] = [];
    const hist = resolve(fonte.dir, "historico.json");
    if (existsSync(hist)) { try { atualizacoes = JSON.parse(readFileSync(hist, "utf8")) as Atualizacao[]; } catch { /* histórico ilegível não derruba o texto */ } }
    info = { origem: fonte.origem, gerado_em: ind.gerado_em ?? "", verificado_em: ind.verificado_em ?? ind.gerado_em ?? "", alertas: ind.alertas ?? [], atualizacoes };
  }
  if (!metas.some((m) => m.id === "cf")) {
    metas.unshift({ ...META_CF, paginas: 0, artigos: 0, palavras: 0, fonte: cf.fonte, atualizado_ate: cf.atualizado_ate });
  }
  if (!categorias.length) categorias = ["Constitucional"];

  const e: Estado = {
    info, marca: fonte ? `${fonte.indice}:${fonte.mtime}` : "sem-indice", categorias,
    obras: new Map(), lista: [], paginas: new Map(), obraDaPagina: new Map(), artigos: new Map(),
    dispositivos: new Map(), apelidos: new Map(), indice: [],
  };

  metas.forEach((m, i) => {
    let c: Conteudo, versao: string;
    if (m.id === "cf") { c = cf; versao = hash(cfBytes); }
    else {
      const arq = resolve(fonte!.dir, m.arquivo);
      if (!existsSync(arq)) return;                         // índice à frente do disco: ignora a obra, não derruba o boot
      const bytes = readFileSync(arq);
      c = JSON.parse(bytes.toString("utf8")) as Conteudo;
      versao = hash(bytes);
    }
    const meta: MetaObra = {
      ...m, ordem: i, versao,
      ...(m.id === "cf" ? { paginas: c.paginas.length, artigos: c.paginas.reduce((s, p) => s + p.artigos.length, 0), palavras: c.paginas.reduce((s, p) => s + p.palavras, 0) } : {}),
    };
    e.obras.set(meta.id, { meta, conteudo: c });
    e.lista.push(meta);
    for (const p of c.paginas) {
      p.obra = meta.id;
      e.paginas.set(p.id, p);
      e.obraDaPagina.set(p.id, meta);
      for (const a of p.artigos) {
        const chave = `${p.livro}:${a.numero}${chaveSufixo(a.sufixo)}`;
        if (!e.artigos.has(chave)) e.artigos.set(chave, { pagina: p, artigo: a });
        for (const d of a.dispositivos) {
          e.dispositivos.set(d.id, { pagina: p, artigo: a, dispositivo: d });
          e.indice.push({ obra: meta, pagina: p, artigo: a, dispositivo: d, normalizado: normalizar(d.texto) });
        }
      }
    }
    for (const nome of [meta.id, meta.sigla, ...(meta.id === "cf" ? ["cf", "cf88", "constituicao", "crfb"] : [])]) {
      const k = chaveSigla(nome);
      if (k && !e.apelidos.has(k)) e.apelidos.set(k, { obra: meta.id, livro: meta.id === "cf" ? "cf" : meta.id });
    }
    if (meta.id === "cf") e.apelidos.set("adct", { obra: "cf", livro: "adct" });
  });
  return e;
}

export function carregarTexto(opcoes?: { cf?: string; leis?: string }): Conteudo {
  if (opcoes) { opcoesCarga = { cf: opcoes.cf ?? config.conteudo, leis: opcoes.leis ?? config.leis }; estado = null; }
  if (!estado) estado = montar(opcoesCarga.cf, opcoesCarga.leis);
  return estado.obras.get("cf")!.conteudo;
}

/* Chamado de minuto em minuto pelo servidor: o índice mudou (atualização do
   Planalto, deploy com texto novo)? Monta o estado novo e troca. Falha ao
   montar mantém o antigo — texto velho no ar é melhor que texto nenhum. */
export function recarregarSeMudou(): { recarregou: boolean; obras?: number; erro?: string } {
  if (!estado) { carregarTexto(); return { recarregou: true, obras: estado!.lista.length }; }
  const fonte = escolherFonte(dirname(opcoesCarga.cf), opcoesCarga.leis);
  const marca = fonte ? `${fonte.indice}:${fonte.mtime}` : "sem-indice";
  if (marca === estado.marca) return { recarregou: false };
  try {
    estado = montar(opcoesCarga.cf, opcoesCarga.leis);
    return { recarregou: true, obras: estado.lista.length };
  } catch (e) {
    return { recarregou: false, erro: (e as Error).message };
  }
}

function exigir(): Estado {
  if (!estado) throw new Error("Conteúdo não carregado — chame carregarTexto() no boot.");
  return estado;
}

/* A Constituição (compatível com o que o sistema sempre devolveu). */
export function texto(): Conteudo { return exigir().obras.get("cf")!.conteudo; }
export function obras(): MetaObra[] { return exigir().lista; }
export function categorias(): string[] { return exigir().categorias; }
export function infoConteudo(): InfoConteudo { return exigir().info; }
export function obra(id: string): ObraCarregada | undefined { return exigir().obras.get(id); }
export function obraDaPagina(paginaId: string): MetaObra | undefined { return exigir().obraDaPagina.get(paginaId); }
export function totalDePaginas(): number { return exigir().paginas.size; }
export function pagina(id: string): Pagina | undefined { return exigir().paginas.get(id); }
export function dispositivo(id: string): { pagina: Pagina; artigo: Artigo; dispositivo: Dispositivo } | undefined { return exigir().dispositivos.get(id); }
/* "Art. 121, § 2º-B, II": o inciso sozinho ("Art. 121, II") confunde com o
   inciso do caput. A lista é plana, então o pai é o anterior de nível acima. */
const NIVEL: Record<string, number> = { paragrafo: 1, inciso: 2, pena: 2, alinea: 3, item: 4 };
export function referencia(id: string): string {
  const x = dispositivo(id);
  if (!x) return "";
  if (!x.dispositivo.rotulo) return x.artigo.rotulo;
  const lista = x.artigo.dispositivos;
  const partes = [x.dispositivo.rotulo];
  let nivel = NIVEL[x.dispositivo.tipo] ?? 2;
  for (let j = lista.indexOf(x.dispositivo) - 1; j >= 0 && nivel > 1; j--) {
    const d = lista[j]!;
    const n = NIVEL[d.tipo];
    if (n !== undefined && n < nivel && d.tipo !== "pena" && d.rotulo) { partes.unshift(d.rotulo); nivel = n; }
  }
  return `${x.artigo.rotulo}, ${partes.join(", ")}`;
}
export function existeObra(id: string): boolean { return exigir().obras.has(id); }

/* Ordem global de uma página: a obra na ordem do índice, depois a página na obra. */
export function ordemGlobal(paginaId: string): number {
  const e = exigir();
  const p = e.paginas.get(paginaId);
  const o = e.obraDaPagina.get(paginaId);
  return p && o ? o.ordem * 100_000 + p.ordem : 0;
}

/* Sumário leve de uma obra: sem o texto dos dispositivos. */
export function sumarioLeve(obraId = "cf") {
  const o = exigir().obras.get(obraId);
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

/* "art 5", "art. 37", "adct 2", "121 cp", "cc 1.639", "art. 149-b":
   salto direto para o artigo. Sem sigla, vale a obra em que o leitor está. */
export function acharArtigo(consulta: string, obraPadrao = "cf"): { pagina: Pagina; artigo: Artigo; obra: MetaObra } | undefined {
  const e = exigir();
  let q = normalizar(consulta).replace(/[º°ª]/g, "").replace(/\s+/g, " ").trim();
  let alvo = e.apelidos.get(chaveSigla(obraPadrao)) ?? { obra: obraPadrao, livro: obraPadrao === "cf" ? "cf" : obraPadrao };
  const inicio = /^([a-z][a-z0-9/. ]*?)\s+(?=(?:arts?\.?\s*)?\d)/.exec(q);
  if (inicio && !/^arts?\.?$/.test(inicio[1]!) && e.apelidos.has(chaveSigla(inicio[1]!))) { alvo = e.apelidos.get(chaveSigla(inicio[1]!))!; q = q.slice(inicio[0].length); }
  else {
    const fim = /\s+(?:d[oa]s?\s+)?([a-z][a-z0-9/. ]*)$/.exec(q);
    if (fim && e.apelidos.has(chaveSigla(fim[1]!)) && !/^[a-e]$/.test(fim[1]!.trim())) { alvo = e.apelidos.get(chaveSigla(fim[1]!))!; q = q.slice(0, fim.index); }
  }
  const m = /^(?:arts?\.?\s*)?(\d{1,4}(?:\.\d{3})?)\s*(?:-\s*|\s+)?([a-z]{1,2}(?:-[a-z])?)?$/.exec(q.trim());
  if (!m) return undefined;
  const numero = Number(m[1]!.replace(".", ""));
  const sufixo = m[2] ? `-${m[2]}` : "";
  const achado = e.artigos.get(`${alvo.livro}:${numero}${sufixo}`) ?? (sufixo ? undefined : e.artigos.get(`${alvo.livro}:${numero}`));
  if (!achado) return undefined;
  return { ...achado, obra: e.obraDaPagina.get(achado.pagina.id)! };
}

export interface ResultadoBusca {
  obra_id: string; obra_sigla: string;
  pagina_id: string; pagina_rotulo: string; pagina_nome: string; trilha: string;
  artigo_id: string; artigo_rotulo: string; dispositivo_id: string; dispositivo_rotulo: string; trecho: string;
}

/* Busca por todas as palavras (AND) sem acento; devolve o trecho com contexto.
   `obra` restringe a uma lei; sem ela, procura no Vade Mecum inteiro. */
export function buscar(consulta: string, opcoes: { obra?: string; limite?: number; obraPadrao?: string } | number = {}): { total: number; itens: ResultadoBusca[]; artigo: { pagina_id: string; artigo_id: string; rotulo: string; obra_sigla: string } | null; por_obra: Array<{ obra_id: string; obra_sigla: string; total: number }> } {
  const e = exigir();
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
  for (const x of e.indice) {
    if (op.obra && x.obra.id !== op.obra) continue;
    if (!termos.every((t) => x.normalizado.includes(t))) continue;
    total += 1;
    const c = contagem.get(x.obra.id) ?? { obra_id: x.obra.id, obra_sigla: x.obra.sigla, total: 0 };
    c.total += 1;
    contagem.set(x.obra.id, c);
    if (itens.length >= limite) continue;
    const pos = x.normalizado.indexOf(termos[0]!);
    const inicio = Math.max(0, pos - 70);
    const fim = Math.min(x.dispositivo.texto.length, pos + termos[0]!.length + 110);
    const trecho = (inicio > 0 ? "…" : "") + x.dispositivo.texto.slice(inicio, fim) + (fim < x.dispositivo.texto.length ? "…" : "");
    itens.push({
      obra_id: x.obra.id, obra_sigla: x.obra.sigla,
      pagina_id: x.pagina.id, pagina_rotulo: x.pagina.rotulo, pagina_nome: x.pagina.nome,
      trilha: x.pagina.trilha.map((t) => t.rotulo).join(" › "),
      artigo_id: x.artigo.id, artigo_rotulo: x.artigo.rotulo,
      dispositivo_id: x.dispositivo.id, dispositivo_rotulo: x.dispositivo.rotulo, trecho,
    });
  }
  return { total, itens, artigo, por_obra: [...contagem.values()].sort((a, b) => b.total - a.total) };
}
