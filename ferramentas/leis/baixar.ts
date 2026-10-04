/* ==========================================================================
   baixar.ts — baixa as leis do catálogo no Planalto, estrutura e grava.

     npm run leis                      tudo o que falta (usa o cache do HTML)
     npm run leis -- --atualizar       baixa de novo TUDO (texto atual)
     npm run leis -- --so cc,cp        só estas
     npm run leis -- --so cp --atualizar

   Saída:
     conteudo/obras/<id>.json    uma obra por lei (formato do cf88.json)
     conteudo/indice.json        o índice que o servidor lê (inclui a CF)
     .cache/leis/<id>.htm        o HTML bruto (fora do git)

   A conferência imprime, por lei, o último artigo encontrado contra o
   esperado e os avisos do extrator. Lei que não fecha a conta NÃO entra no
   índice: Vade Mecum com lei pela metade é pior que sem ela.
   ========================================================================== */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGO, CATEGORIAS, candidatos, type Entrada } from "./catalogo.ts";
import { blocos, decodificar, partirPorMarcador } from "./html.ts";
import { analisar, type Obra } from "./analisar.ts";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = resolve(RAIZ, ".cache", "leis");
const OBRAS = resolve(RAIZ, "conteudo", "obras");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const args = process.argv.slice(2);
const atualizar = args.includes("--atualizar");
const so = (() => { const i = args.indexOf("--so"); return i >= 0 && args[i + 1] ? args[i + 1]!.split(",").map((s) => s.trim()) : null; })();
const detalhe = args.includes("--detalhe");

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buscar(url: string): Promise<Uint8Array | null> {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" }, signal: AbortSignal.timeout(60_000), redirect: "follow" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (tentativa === 3) { console.log(`      ! ${url}: ${(e as Error).message}`); return null; }
      await dormir(1500 * tentativa);
    }
  }
  return null;
}

async function obterHtml(e: Entrada): Promise<{ html: string; url: string } | null> {
  const arq = resolve(CACHE, `${e.id}.htm`);
  const meta = resolve(CACHE, `${e.id}.url`);
  if (!atualizar && existsSync(arq) && existsSync(meta)) {
    return { html: decodificar(readFileSync(arq)), url: readFileSync(meta, "utf8").trim() };
  }
  for (const url of candidatos(e)) {
    const bytes = await buscar(url);
    await dormir(350);
    if (!bytes) continue;
    const html = decodificar(bytes);
    if ((html.match(/Art\s*\.?\s*\d/g) ?? []).length < 3) continue;
    writeFileSync(arq, bytes);
    writeFileSync(meta, url);
    return { html, url };
  }
  return null;
}

interface Linha { id: string; sigla: string; ok: boolean; artigos: number; ultimo: number; esperado: number; paginas: number; avisos: number; kb: number; motivo: string }

async function principal(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OBRAS, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const lista = CATALOGO.filter((e) => !so || so.includes(e.id));
  const ids = new Set<string>();
  for (const e of CATALOGO) { if (ids.has(e.id)) throw new Error(`id repetido no catálogo: ${e.id}`); ids.add(e.id); }
  if (ids.has("cf") || ids.has("adct")) throw new Error("os prefixos cf e adct são da Constituição");

  console.log(`\n  LA Carta — leis do Planalto (${lista.length} de ${CATALOGO.length})${atualizar ? " · baixando de novo" : ""}\n`);
  const linhas: Linha[] = [];

  for (const e of lista) {
    const fonte = await obterHtml(e);
    if (!fonte) { linhas.push({ id: e.id, sigla: e.sigla, ok: false, artigos: 0, ultimo: 0, esperado: e.ultimo ?? 0, paginas: 0, avisos: 0, kb: 0, motivo: "não achei no Planalto" }); console.log(`  ✖ ${e.sigla.padEnd(22)} não achei no Planalto`); continue; }
    try {
      const { obra, relatorio } = analisar({ id: e.id, sigla: e.sigla, nome: e.nome, identificacao: e.identificacao, categoria: e.categoria }, partirPorMarcador(blocos(fonte.html)), { url: fonte.url, baixadoEm: hoje });
      const esperado = e.ultimo ?? 0;
      const fecha = !esperado || relatorio.ultimoArtigo === esperado;
      const json = JSON.stringify(obra);
      if (fecha) writeFileSync(resolve(OBRAS, `${e.id}.json`), json);
      linhas.push({ id: e.id, sigla: e.sigla, ok: fecha, artigos: relatorio.artigos, ultimo: relatorio.ultimoArtigo, esperado, paginas: relatorio.paginas, avisos: relatorio.avisos.length, kb: Math.round(json.length / 1024), motivo: fecha ? "" : `último artigo ${relatorio.ultimoArtigo}, esperado ${esperado}` });
      console.log(`  ${fecha ? "✔" : "✖"} ${e.sigla.padEnd(22)} ${String(relatorio.artigos).padStart(5)} art. · últ. ${String(relatorio.ultimoArtigo).padStart(4)}${esperado ? "/" + esperado : ""} · ${String(relatorio.paginas).padStart(3)} pág. · ${String(relatorio.avisos.length).padStart(3)} aviso(s) · ${fonte.url.replace(/^.*ccivil_03\//, "")}`);
      if (detalhe || !fecha) for (const a of relatorio.avisos.slice(0, detalhe ? 40 : 6)) console.log(`        · ${a}`);
    } catch (erro) {
      linhas.push({ id: e.id, sigla: e.sigla, ok: false, artigos: 0, ultimo: 0, esperado: e.ultimo ?? 0, paginas: 0, avisos: 0, kb: 0, motivo: (erro as Error).message });
      console.log(`  ✖ ${e.sigla.padEnd(22)} ${(erro as Error).message}`);
    }
  }

  /* ---------- índice: a CF mais toda obra que existe em conteudo/obras ---------- */
  const cf = JSON.parse(readFileSync(resolve(RAIZ, "conteudo", "cf88.json"), "utf8"));
  const indice: unknown[] = [{
    id: "cf", sigla: "CF/88", nome: "Constituição da República Federativa do Brasil", identificacao: "Promulgada em 5 de outubro de 1988",
    categoria: "Constitucional", arquivo: "cf88.json", prefixos: ["cf", "adct"],
    paginas: cf.paginas.length, artigos: cf.paginas.reduce((s: number, p: { artigos: unknown[] }) => s + p.artigos.length, 0),
    palavras: cf.paginas.reduce((s: number, p: { palavras: number }) => s + p.palavras, 0),
    fonte: cf.fonte, url: "", baixado_em: "", atualizado_ate: cf.atualizado_ate, ementa: "",
  }];
  const gravadas = new Set(readdirSync(OBRAS).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
  for (const e of CATALOGO) {
    if (!gravadas.has(e.id)) continue;
    const o = JSON.parse(readFileSync(resolve(OBRAS, `${e.id}.json`), "utf8")) as Obra;
    indice.push({
      id: o.id, sigla: o.sigla, nome: o.nome, identificacao: o.identificacao, categoria: o.categoria, arquivo: `obras/${e.id}.json`, prefixos: [o.id],
      paginas: o.paginas.length, artigos: o.paginas.reduce((s, p) => s + p.artigos.length, 0), palavras: o.paginas.reduce((s, p) => s + p.palavras, 0),
      fonte: o.fonte, url: o.url, baixado_em: o.baixado_em, atualizado_ate: o.atualizado_ate, ementa: o.ementa,
    });
  }
  writeFileSync(resolve(RAIZ, "conteudo", "indice.json"), JSON.stringify({ gerado_em: hoje, categorias: CATEGORIAS, obras: indice }, null, 1));

  const boas = linhas.filter((l) => l.ok), ruins = linhas.filter((l) => !l.ok);
  console.log(`\n  ${boas.length} lei(s) gravada(s), ${ruins.length} recusada(s). Índice com ${indice.length} obra(s).`);
  for (const r of ruins) console.log(`    ✖ ${r.sigla}: ${r.motivo}`);
  console.log("");
  if (ruins.length && !so) process.exitCode = 2;
}

principal().catch((e) => { console.error("\n  ✖", (e as Error).message, "\n"); process.exit(1); });
