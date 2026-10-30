/* ==========================================================================
   baixar.ts — baixa as leis do catálogo no Planalto, estrutura e grava.

     npm run leis                      tudo o que falta (usa o cache do HTML)
     npm run leis -- --atualizar       confere TUDO no Planalto (só baixa o que mudou)
     npm run leis -- --so cc,cp        só estas
     npm run leis -- --so cp --atualizar

   Saída (padrão do repositório; o serviço diário usa outras pastas):
     conteudo/obras/<id>.json    uma obra por lei (formato do cf88.json)
     conteudo/indice.json        o índice que o servidor lê (inclui a CF)
     .cache/leis/<id>.htm        o HTML bruto (fora do git)

   DOWNLOAD CONDICIONAL: o Planalto responde ETag e Last-Modified. Com o
   HTML em cache, o pedido vai com If-None-Match/If-Modified-Since e o 304
   ("não mudou") custa alguns bytes — conferir as 83 leis todo dia é barato.

   Lei que não fecha a conta (último artigo ≠ esperado) NÃO é gravada: se
   já havia uma versão boa na saída, ela fica. Vade Mecum com lei pela
   metade é pior que com a lei de ontem.
   ========================================================================== */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CATALOGO, CATEGORIAS, candidatos, type Entrada } from "./catalogo.ts";
import { blocos, decodificar, partirPorMarcador } from "./html.ts";
import { analisar, type Obra } from "./analisar.ts";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* Resposta mínima de que o extrator precisa (permite trocar o fetch nos testes). */
export interface Resposta { status: number; bytes?: Uint8Array | undefined; etag?: string | undefined; ultimaModificacao?: string | undefined }
export interface Condicional { etag?: string | undefined; ultimaModificacao?: string | undefined }
export type Buscador = (url: string, condicional?: Condicional) => Promise<Resposta>;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export const buscadorPlanalto: Buscador = async (url, condicional) => {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const cab: Record<string, string> = { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" };
      if (condicional?.etag) cab["If-None-Match"] = condicional.etag;
      if (condicional?.ultimaModificacao) cab["If-Modified-Since"] = condicional.ultimaModificacao;
      const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(60_000), redirect: "follow" });
      if (r.status === 304 || r.status === 404) return { status: r.status };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()), etag: r.headers.get("etag") ?? undefined, ultimaModificacao: r.headers.get("last-modified") ?? undefined };
    } catch (e) {
      if (tentativa === 3) return { status: 0 };
      await dormir(1500 * tentativa);
    }
  }
  return { status: 0 };
};

interface MetaCache { url: string; etag?: string | undefined; ultimaModificacao?: string | undefined; sha: string; verificado_em: string }
export interface OpcoesGerar {
  saida?: string;                 // pasta com obras/ e indice.json
  cache?: string;                 // pasta do HTML bruto
  cf?: string;                    // conteudo/cf88.json
  atualizar?: boolean;            // conferir no Planalto (senão usa o cache que houver)
  so?: string[] | null;
  catalogo?: Entrada[];
  buscar?: Buscador;
  pausa?: number;                 // ms entre pedidos ao Planalto
  detalhe?: boolean;
  silencioso?: boolean | undefined;
  agora?: Date;
}
export interface Linha { id: string; sigla: string; ok: boolean; mudou: boolean; respondeu: boolean; artigos: number; ultimo: number; esperado: number; paginas: number; avisos: number; motivo: string; url: string }

async function obterHtml(e: Entrada, op: Required<Pick<OpcoesGerar, "cache" | "atualizar" | "pausa">> & { buscar: Buscador; agora: Date; log: (s: string) => void }): Promise<{ html: string; url: string; mudou: boolean; respondeu: boolean } | null> {
  const arq = resolve(op.cache, `${e.id}.htm`);
  const arqMeta = resolve(op.cache, `${e.id}.json`);
  const arqUrlAntigo = resolve(op.cache, `${e.id}.url`);                 // formato da 1.5.0
  let meta: MetaCache | null = null;
  if (existsSync(arqMeta)) { try { meta = JSON.parse(readFileSync(arqMeta, "utf8")) as MetaCache; } catch { meta = null; } }
  if (!meta && existsSync(arq) && existsSync(arqUrlAntigo)) meta = { url: readFileSync(arqUrlAntigo, "utf8").trim(), sha: sha(readFileSync(arq)), verificado_em: "" };
  const temCache = Boolean(meta && existsSync(arq));
  const gravar = (bytes: Uint8Array, url: string, r: Resposta) => {
    writeFileSync(`${arq}.tmp`, bytes); renameSync(`${arq}.tmp`, arq);
    const novo: MetaCache = { url, etag: r.etag, ultimaModificacao: r.ultimaModificacao, sha: sha(bytes), verificado_em: op.agora.toISOString() };
    writeFileSync(arqMeta, JSON.stringify(novo, null, 1));
    return novo;
  };

  if (temCache && !op.atualizar) return { html: decodificar(readFileSync(arq)), url: meta!.url, mudou: false, respondeu: false };

  if (temCache) {
    const r = await op.buscar(meta!.url, { etag: meta!.etag, ultimaModificacao: meta!.ultimaModificacao });
    await dormir(op.pausa);
    if (r.status === 304 || r.status === 0) {
      if (r.status === 0) op.log(`        ! ${e.sigla}: Planalto não respondeu — segue o texto já baixado`);
      writeFileSync(arqMeta, JSON.stringify({ ...meta!, verificado_em: r.status === 304 ? op.agora.toISOString() : meta!.verificado_em }, null, 1));
      return { html: decodificar(readFileSync(arq)), url: meta!.url, mudou: false, respondeu: r.status === 304 };
    }
    if (r.status >= 200 && r.status < 300 && r.bytes) {
      const html = decodificar(r.bytes);
      if ((html.match(/Art\s*\.?\s*\d/g) ?? []).length >= 3) {
        const anterior = meta!.sha;
        const novo = gravar(r.bytes, meta!.url, r);
        return { html, url: meta!.url, mudou: novo.sha !== anterior, respondeu: true };
      }
    }
    /* 404 ou página estranha: o endereço pode ter mudado — procura de novo */
  }
  for (const url of candidatos(e)) {
    const r = await op.buscar(url);
    await dormir(op.pausa);
    if (!r.bytes) continue;
    const html = decodificar(r.bytes);
    if ((html.match(/Art\s*\.?\s*\d/g) ?? []).length < 3) continue;
    const anterior = meta?.sha;
    const novo = gravar(r.bytes, url, r);
    return { html, url, mudou: novo.sha !== anterior, respondeu: true };
  }
  if (temCache) return { html: decodificar(readFileSync(arq)), url: meta!.url, mudou: false, respondeu: false };
  return null;
}

/* Gera (ou atualiza) as obras na pasta de saída e reescreve o índice. */
export async function gerar(opcoes: OpcoesGerar = {}): Promise<{ linhas: Linha[]; obras: number; indice: string }> {
  const saida = opcoes.saida ?? resolve(RAIZ, "conteudo");
  const cache = opcoes.cache ?? resolve(RAIZ, ".cache", "leis");
  const cfCaminho = opcoes.cf ?? resolve(RAIZ, "conteudo", "cf88.json");
  const catalogo = opcoes.catalogo ?? CATALOGO;
  const agora = opcoes.agora ?? new Date();
  const log = opcoes.silencioso ? (_: string) => {} : (s: string) => console.log(s);
  const pastaObras = resolve(saida, "obras");
  mkdirSync(cache, { recursive: true });
  mkdirSync(pastaObras, { recursive: true });

  const ids = new Set<string>();
  for (const e of catalogo) { if (ids.has(e.id)) throw new Error(`id repetido no catálogo: ${e.id}`); ids.add(e.id); }
  if (ids.has("cf") || ids.has("adct")) throw new Error("os prefixos cf e adct são da Constituição");
  const lista = catalogo.filter((e) => !opcoes.so || opcoes.so.includes(e.id));
  const linhas: Linha[] = [];
  const hoje = agora.toISOString().slice(0, 10);

  for (const e of lista) {
    const base = { id: e.id, sigla: e.sigla, esperado: e.ultimo ?? 0 };
    const fonte = await obterHtml(e, { cache, atualizar: opcoes.atualizar ?? false, pausa: opcoes.pausa ?? 350, buscar: opcoes.buscar ?? buscadorPlanalto, agora, log });
    if (!fonte) {
      linhas.push({ ...base, ok: false, mudou: false, respondeu: false, artigos: 0, ultimo: 0, paginas: 0, avisos: 0, motivo: "não achei no Planalto", url: "" });
      log(`  ✖ ${e.sigla.padEnd(22)} não achei no Planalto`);
      continue;
    }
    const arqObra = resolve(pastaObras, `${e.id}.json`);
    /* HTML igual ao de ontem e a obra já está na saída: nada a refazer */
    if (!fonte.mudou && existsSync(arqObra) && opcoes.atualizar) {
      const o = JSON.parse(readFileSync(arqObra, "utf8")) as Obra;
      const ultimo = Math.max(0, ...o.paginas.flatMap((p) => p.artigos.map((a) => a.numero)));
      linhas.push({ ...base, ok: true, mudou: false, respondeu: fonte.respondeu, artigos: o.paginas.reduce((s, p) => s + p.artigos.length, 0), ultimo, paginas: o.paginas.length, avisos: 0, motivo: "", url: fonte.url });
      continue;
    }
    try {
      const { obra, relatorio } = analisar({ id: e.id, sigla: e.sigla, nome: e.nome, identificacao: e.identificacao, categoria: e.categoria }, partirPorMarcador(blocos(fonte.html)), { url: fonte.url, baixadoEm: hoje });
      const esperado = e.ultimo ?? 0;
      const fecha = !esperado || relatorio.ultimoArtigo === esperado;
      const json = JSON.stringify(obra);
      let mudou = false;
      if (fecha) {
        /* "mudou" é o TEXTO, não a data de download que vai dentro do arquivo */
        const semData = (j: string) => j.replace(/"baixado_em":"[^"]*"/, "");
        const antes = existsSync(arqObra) ? readFileSync(arqObra, "utf8") : "";
        mudou = semData(antes) !== semData(json);
        if (mudou || !antes) { writeFileSync(`${arqObra}.tmp`, json); renameSync(`${arqObra}.tmp`, arqObra); }
      }
      linhas.push({ ...base, ok: fecha, mudou, respondeu: fonte.respondeu, artigos: relatorio.artigos, ultimo: relatorio.ultimoArtigo, paginas: relatorio.paginas, avisos: relatorio.avisos.length, motivo: fecha ? "" : `último artigo ${relatorio.ultimoArtigo}, esperado ${esperado}${existsSync(arqObra) ? " — mantida a versão anterior" : ""}`, url: fonte.url });
      log(`  ${fecha ? (mudou ? "✎" : "✔") : "✖"} ${e.sigla.padEnd(22)} ${String(relatorio.artigos).padStart(5)} art. · últ. ${String(relatorio.ultimoArtigo).padStart(4)}${esperado ? "/" + esperado : ""} · ${String(relatorio.paginas).padStart(3)} pág. · ${String(relatorio.avisos.length).padStart(3)} aviso(s) · ${fonte.url.replace(/^.*ccivil_03\//, "")}`);
      if (opcoes.detalhe || !fecha) for (const a of relatorio.avisos.slice(0, opcoes.detalhe ? 40 : 6)) log(`        · ${a}`);
    } catch (erro) {
      linhas.push({ ...base, ok: false, mudou: false, respondeu: fonte.respondeu, artigos: 0, ultimo: 0, paginas: 0, avisos: 0, motivo: (erro as Error).message, url: fonte.url });
      log(`  ✖ ${e.sigla.padEnd(22)} ${(erro as Error).message}`);
    }
  }

  /* ---------- índice: a CF mais toda obra que existe na saída ---------- */
  const cf = JSON.parse(readFileSync(cfCaminho, "utf8"));
  const indice: unknown[] = [{
    id: "cf", sigla: "CF/88", nome: "Constituição da República Federativa do Brasil", identificacao: "Promulgada em 5 de outubro de 1988",
    categoria: "Constitucional", arquivo: "cf88.json", prefixos: ["cf", "adct"],
    paginas: cf.paginas.length, artigos: cf.paginas.reduce((s: number, p: { artigos: unknown[] }) => s + p.artigos.length, 0),
    palavras: cf.paginas.reduce((s: number, p: { palavras: number }) => s + p.palavras, 0),
    fonte: cf.fonte, url: "", baixado_em: "", atualizado_ate: cf.atualizado_ate, ementa: "",
  }];
  const gravadas = new Set(readdirSync(pastaObras).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
  for (const e of catalogo) {
    if (!gravadas.has(e.id)) continue;
    const o = JSON.parse(readFileSync(resolve(pastaObras, `${e.id}.json`), "utf8")) as Obra;
    indice.push({
      id: o.id, sigla: o.sigla, nome: o.nome, identificacao: o.identificacao, categoria: o.categoria, arquivo: `obras/${e.id}.json`, prefixos: [o.id],
      paginas: o.paginas.length, artigos: o.paginas.reduce((s, p) => s + p.artigos.length, 0), palavras: o.paginas.reduce((s, p) => s + p.palavras, 0),
      fonte: o.fonte, url: o.url, baixado_em: o.baixado_em, atualizado_ate: o.atualizado_ate, ementa: o.ementa,
    });
  }
  const arqIndice = resolve(saida, "indice.json");
  let anterior: { alertas?: string[] } = {};
  if (existsSync(arqIndice)) { try { anterior = JSON.parse(readFileSync(arqIndice, "utf8")); } catch { /* recomeça */ } }
  const instante = agora.toISOString();
  const conteudoIndice = { gerado_em: instante, verificado_em: instante, alertas: anterior.alertas ?? [], categorias: CATEGORIAS, obras: indice };
  writeFileSync(`${arqIndice}.tmp`, JSON.stringify(conteudoIndice, null, 1));
  renameSync(`${arqIndice}.tmp`, arqIndice);
  return { linhas, obras: indice.length, indice: arqIndice };
}

/* ---------- linha de comando ---------- */
if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const so = (() => { const i = args.indexOf("--so"); return i >= 0 && args[i + 1] ? args[i + 1]!.split(",").map((s) => s.trim()) : null; })();
  const atualizar = args.includes("--atualizar");
  console.log(`\n  LA Carta — leis do Planalto (${so ? so.length : CATALOGO.length} de ${CATALOGO.length})${atualizar ? " · conferindo no Planalto" : ""}\n`);
  gerar({ atualizar, so, detalhe: args.includes("--detalhe") })
    .then(({ linhas, obras }) => {
      const boas = linhas.filter((l) => l.ok), ruins = linhas.filter((l) => !l.ok), mudaram = linhas.filter((l) => l.mudou);
      console.log(`\n  ${boas.length} lei(s) em ordem (${mudaram.length} com texto novo), ${ruins.length} recusada(s). Índice com ${obras} obra(s).`);
      for (const r of ruins) console.log(`    ✖ ${r.sigla}: ${r.motivo}`);
      console.log("");
      if (ruins.length && !so) process.exitCode = 2;
    })
    .catch((e) => { console.error("\n  ✖", (e as Error).message, "\n"); process.exit(1); });
}
