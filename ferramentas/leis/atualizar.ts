/* ==========================================================================
   atualizar.ts — a atualização AUTOMÁTICA das leis (roda todo dia pelo
   operacao/lacarta-leis.timer, como o usuário deploy).

     node ferramentas/leis/atualizar.ts

   O caminho, sempre o mesmo:

     1. parte do texto que está NO AR (dados/leis, ou conteudo/ se mais novo);
     2. copia para uma pasta de rascunho (dados/leis.novo-<instante>);
     3. confere cada lei no Planalto com ETag/Last-Modified — 304 custa
        alguns bytes; só a lei que mudou é baixada e reprocessada;
     4. lei nova que não fecha a conta do último artigo NÃO substitui a de
        ontem (fica registrada como falha);
     5. confere se saiu emenda constitucional depois da EC 139 (o texto da
        CF vem do PDF do Senado — vira um AVISO, não troca automática);
     6. troca a pasta inteira de uma vez (rename) — o servidor percebe o
        índice novo em até 1 minuto e recarrega sem reiniciar.

   Nada aqui toca o repositório: o git do servidor continua limpo e o
   deploy.sh segue aceitando entrega.
   ========================================================================== */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { config } from "../../src/nucleo/config.ts";
import { escolherFonte, type Atualizacao } from "../../src/dados/texto.ts";
import { gerar, buscadorPlanalto, type Buscador, type Linha } from "./baixar.ts";
import { decodificar } from "./html.ts";
import { CATALOGO, type Entrada } from "./catalogo.ts";

export const URL_CF = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm";
const TRAVA_VALIDA_MS = 2 * 60 * 60 * 1000;

export interface OpcoesAtualizar {
  cf?: string; leis?: string; cache?: string;
  catalogo?: Entrada[]; buscar?: Buscador; pausa?: number; agora?: Date; silencioso?: boolean;
  conferirCf?: boolean;
}
export interface Resultado {
  trocou: boolean; mudaram: Linha[]; falhas: Linha[]; respondidas: number; total: number;
  alertas: string[]; origemBase: "repositorio" | "atualizacao" | "nenhuma"; leis: string;
}

/* Maior "Emenda Constitucional nº N" citada na CF compilada do Planalto. */
export function maiorEmenda(html: string): number {
  let maior = 0;
  for (const m of html.matchAll(/Emenda\s+Constitucional\s+n[ºo°.]*\s*(\d{1,3})/gi)) maior = Math.max(maior, Number(m[1]));
  return maior;
}

export async function atualizarLeis(op: OpcoesAtualizar = {}): Promise<Resultado> {
  const cf = op.cf ?? config.conteudo;
  const leis = op.leis ?? config.leis;
  if (!leis) throw new Error("CARTA_LEIS vazio: não há onde gravar as leis atualizadas.");
  const cache = op.cache ?? config.leisCache;
  const agora = op.agora ?? new Date();
  const log = op.silencioso ? (_: string) => {} : (s: string) => console.log(s);
  mkdirSync(dirname(leis), { recursive: true });

  /* ---- trava: duas atualizações ao mesmo tempo trocariam a pasta uma da outra ---- */
  const trava = `${leis}.trava`;
  if (existsSync(trava) && Date.now() - statSync(trava).mtimeMs < TRAVA_VALIDA_MS) throw new Error(`já há uma atualização em andamento (${trava})`);
  writeFileSync(trava, `${process.pid} ${agora.toISOString()}\n`);
  const rascunho = `${leis}.novo-${agora.getTime()}`;

  try {
    /* ---- 1 e 2: o que está no ar vira o rascunho ---- */
    const base = escolherFonte(dirname(cf), leis);
    mkdirSync(resolve(rascunho, "obras"), { recursive: true });
    const antes = new Map<string, string>();         // obra → "última alteração incorporada" antes
    let alertasAntes: string[] = [];
    if (base) {
      const obrasBase = resolve(base.dir, "obras");
      if (existsSync(obrasBase)) for (const f of readdirSync(obrasBase).filter((x) => x.endsWith(".json"))) copyFileSync(resolve(obrasBase, f), resolve(rascunho, "obras", f));
      const ind = JSON.parse(readFileSync(base.indice, "utf8")) as { obras: Array<{ id: string; atualizado_ate: string }>; alertas?: string[] };
      for (const o of ind.obras) antes.set(o.id, o.atualizado_ate ?? "");
      alertasAntes = ind.alertas ?? [];
      copyFileSync(base.indice, resolve(rascunho, "indice.json"));
    }
    let historico: Atualizacao[] = [];
    const histAtual = resolve(leis, "historico.json");
    if (existsSync(histAtual)) { try { historico = JSON.parse(readFileSync(histAtual, "utf8")) as Atualizacao[]; } catch { historico = []; } }

    /* ---- 3 e 4: conferir no Planalto ---- */
    log(`  base: ${base ? `${base.origem} (${base.dir})` : "nenhuma"} · rascunho ${rascunho}`);
    const { linhas } = await gerar({ saida: rascunho, cache, cf, atualizar: true, catalogo: op.catalogo ?? CATALOGO, buscar: op.buscar ?? buscadorPlanalto, pausa: op.pausa ?? 350, agora, silencioso: op.silencioso });
    const mudaram = linhas.filter((l) => l.ok && l.mudou);
    const falhas = linhas.filter((l) => !l.ok);
    const respondidas = linhas.filter((l) => l.respondeu).length;

    /* ---- 5: emenda constitucional nova? ---- */
    let alertas = alertasAntes.filter((a) => !a.startsWith("Constituição:"));
    if (op.conferirCf !== false) {
      const cfAtual = JSON.parse(readFileSync(cf, "utf8")) as { atualizado_ate: string };
      const noCaderno = Number(/EC\s*(\d+)/i.exec(cfAtual.atualizado_ate)?.[1] ?? 0);
      const r = await (op.buscar ?? buscadorPlanalto)(URL_CF);
      if (r.bytes) {
        const noPlanalto = maiorEmenda(decodificar(r.bytes));
        if (noPlanalto > noCaderno) alertas.push(`Constituição: o Planalto já cita a EC nº ${noPlanalto}; o caderno está na EC ${noCaderno}. Atualize o PDF do Senado e rode o extrator da CF.`);
      } else {
        alertas = [...alertas, ...alertasAntes.filter((a) => a.startsWith("Constituição:"))];
      }
    }

    /* ---- índice: datas honestas ---- */
    const arqIndice = resolve(rascunho, "indice.json");
    const ind = JSON.parse(readFileSync(arqIndice, "utf8")) as { gerado_em: string; verificado_em: string; alertas: string[] };
    const indAntes = base ? (JSON.parse(readFileSync(base.indice, "utf8")) as { gerado_em?: string; verificado_em?: string }) : {};
    /* gerado_em só anda quando o TEXTO muda (é por ele que o servidor escolhe a
       fonte); verificado_em só anda se o Planalto respondeu de verdade. */
    /* (empate com o repositório: a cópia viva vence — escolherFonte usa >=) */
    if (!mudaram.length && indAntes.gerado_em) ind.gerado_em = indAntes.gerado_em;
    const conferiu = respondidas >= Math.ceil(linhas.length / 2);
    ind.verificado_em = conferiu ? agora.toISOString() : (indAntes.verificado_em ?? ind.verificado_em);
    ind.alertas = alertas;
    writeFileSync(arqIndice, JSON.stringify(ind, null, 1));

    /* ---- histórico do que mudou: texto da lei × só notas de referência ---- */
    type ObraJson = { paginas: Array<{ artigos: Array<{ dispositivos: Array<{ id: string; texto: string; notas?: string[] }> }> }> };
    const lerObra = (dir: string, id: string): ObraJson | null => { const f = resolve(dir, "obras", `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) as ObraJson : null; };
    const porId = (o: ObraJson | null) => new Map((o?.paginas ?? []).flatMap((p) => p.artigos.flatMap((a) => a.dispositivos.map((d) => [d.id, d] as const))));
    const diferencas = (id: string): { textos: number; notas: number } => {
      const a = porId(base ? lerObra(base.dir, id) : null), b = porId(lerObra(rascunho, id));
      let textos = 0, notas = 0;
      for (const [k, d] of b) { const x = a.get(k); if (!x || x.texto !== d.texto) textos += 1; else if ((x.notas ?? []).join("|") !== (d.notas ?? []).join("|")) notas += 1; }
      for (const k of a.keys()) if (!b.has(k)) textos += 1;
      return { textos, notas };
    };
    const depois = new Map((JSON.parse(readFileSync(arqIndice, "utf8")) as { obras: Array<{ id: string; atualizado_ate: string }> }).obras.map((o) => [o.id, o.atualizado_ate ?? ""]));
    for (const l of mudaram) {
      historico.push({ em: agora.toISOString(), obra_id: l.id, sigla: l.sigla, tipo: antes.has(l.id) ? "alterada" : "nova", antes: antes.get(l.id) ?? "", depois: depois.get(l.id) ?? "", ...diferencas(l.id) });
    }
    writeFileSync(resolve(rascunho, "historico.json"), JSON.stringify(historico.slice(-300), null, 1));

    /* ---- 6: troca de uma vez ---- */
    const velha = `${leis}.antigo-${agora.getTime()}`;
    if (existsSync(leis)) renameSync(leis, velha);
    renameSync(rascunho, leis);
    if (existsSync(velha)) rmSync(velha, { recursive: true, force: true });

    return { trocou: true, mudaram, falhas, respondidas, total: linhas.length, alertas, origemBase: base?.origem ?? "nenhuma", leis };
  } finally {
    if (existsSync(rascunho)) rmSync(rascunho, { recursive: true, force: true });
    rmSync(trava, { force: true });
  }
}

/* ---------- linha de comando (o timer chama assim) ---------- */
if (import.meta.filename === process.argv[1]) {
  const inicio = Date.now();
  console.log(`\n  LA Carta — atualização das leis (${new Date().toISOString()})\n`);
  atualizarLeis({})
    .then((r) => {
      const seg = Math.round((Date.now() - inicio) / 1000);
      console.log(`\n  Planalto respondeu ${r.respondidas}/${r.total} · ${r.mudaram.length} lei(s) com texto novo · ${r.falhas.length} falha(s) · ${seg}s`);
      for (const l of r.mudaram) console.log(`    ✎ ${l.sigla}`);
      for (const l of r.falhas) console.log(`    ✖ ${l.sigla}: ${l.motivo}`);
      for (const a of r.alertas) console.log(`    ⚠ ${a}`);
      console.log(`  Gravado em ${r.leis}. O servidor recarrega sozinho em até 1 minuto.\n`);
      if (r.respondidas === 0) process.exitCode = 3;                        // Planalto fora ou bloqueando: o journal acusa
    })
    .catch((e) => { console.error("\n  ✖", (e as Error).message, "\n"); process.exit(1); });
}
