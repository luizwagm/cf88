/* ==========================================================================
   atualizacao.test.ts — a atualização automática das leis, de ponta a ponta,
   com o "Planalto" falso (sem rede):

     1ª rodada   lei nova entra; histórico registra "nova"
     2ª rodada   Planalto diz 304: nada muda, só a data de verificação
     3ª rodada   texto alterado: obra nova no ar, mesmos ids, versão nova
     4ª rodada   página quebrada: a lei de ontem FICA
     5ª rodada   Planalto cita emenda constitucional nova: vira aviso
     servidor    percebe o índice novo e recarrega sem reiniciar; sem a
                 cópia viva, volta ao texto do repositório
   ========================================================================== */
process.env["CARTA_AMBIENTE"] = "teste";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { atualizarLeis, maiorEmenda, URL_CF } from "../ferramentas/leis/atualizar.ts";
import type { Resposta, Condicional } from "../ferramentas/leis/baixar.ts";
import type { Entrada } from "../ferramentas/leis/catalogo.ts";
import { carregarTexto, recarregarSeMudou, obras, dispositivo, infoConteudo, obra } from "../src/dados/texto.ts";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "carta-atualizacao-"));
const CONTEUDO = join(TMP, "conteudo");
const CF = join(CONTEUDO, "cf88.json");
const LEIS = join(TMP, "dados", "leis");
const CACHE = join(TMP, "dados", "leis-cache");
const URL_ZZ = "https://exemplo.test/zz.htm";

const ENTRADA: Entrada = { id: "zz", sigla: "ZZ", nome: "Lei de Teste", identificacao: "Lei nº 1, de 1 de janeiro de 2020", categoria: "Penal", tipo: "lei", numero: 1, ano: 2020, ultimo: 5, urls: [URL_ZZ] };
const html = (v: string, artigos = 5) =>
  `<p>Dispõe sobre o teste de atualização.</p>` +
  Array.from({ length: artigos }, (_, i) => `<p>Art. ${i + 1}º Texto do artigo ${i + 1}, ${v}. (Redação dada pela Lei nº 9.${i}00, de 2026)</p>`).join("") +
  `<p>Brasília, 1 de janeiro de 2020; 199º da Independência.</p>`;
const bytes = (s: string) => new TextEncoder().encode(s);

/* O "Planalto": cada rodada troca a função que responde. */
let planalto: (url: string, cond?: Condicional) => Resposta = () => ({ status: 404 });
const pedidos: Array<{ url: string; etag?: string | undefined }> = [];
const buscar = async (url: string, cond?: Condicional) => { pedidos.push({ url, etag: cond?.etag }); return planalto(url, cond); };
const rodar = (dia: number, extra: Record<string, unknown> = {}) =>
  atualizarLeis({ cf: CF, leis: LEIS, cache: CACHE, catalogo: [ENTRADA], buscar, pausa: 0, agora: new Date(Date.UTC(2026, 9, dia, 8)), silencioso: true, ...extra });

before(() => {
  mkdirSync(join(CONTEUDO, "obras"), { recursive: true });
  copyFileSync(resolve(RAIZ, "conteudo", "cf88.json"), CF);
  /* o "repositório": só a Constituição, gerado em 01/10 */
  writeFileSync(join(CONTEUDO, "indice.json"), JSON.stringify({ gerado_em: "2026-10-01T00:00:00.000Z", categorias: ["Constitucional", "Penal"], obras: [] }));
});
after(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("atualização automática das leis", () => {
  it("1ª rodada: a lei entra, com histórico 'nova', e o servidor passa a enxergá-la", async () => {
    planalto = (url) => (url === URL_ZZ ? { status: 200, bytes: bytes(html("v1")), etag: '"a"' } : { status: 404 });
    const r = await rodar(10);
    assert.equal(r.trocou, true);
    assert.equal(r.origemBase, "repositorio");
    assert.deepEqual(r.mudaram.map((l) => l.id), ["zz"]);
    assert.equal(r.respondidas, 1);
    const hist = JSON.parse(readFileSync(join(LEIS, "historico.json"), "utf8"));
    assert.equal(hist.length, 1);
    assert.equal(hist[0].tipo, "nova");
    carregarTexto({ cf: CF, leis: LEIS });
    assert.ok(obras().some((o) => o.id === "zz"));
    assert.match(dispositivo("zz-art-1-caput")!.dispositivo.texto, /v1/);
    assert.equal(infoConteudo().origem, "atualizacao");
    assert.ok(!readdirSync(dirname(LEIS)).some((f) => f.includes(".novo-") || f.includes(".antigo-") || f.endsWith(".trava")), "sobrou pasta de rascunho ou trava");
  });

  it("2ª rodada: Planalto responde 304 — o pedido foi condicional e nada muda além da verificação", async () => {
    const versao = obra("zz")!.meta.versao;
    const geradoAntes = JSON.parse(readFileSync(join(LEIS, "indice.json"), "utf8")).gerado_em;
    planalto = (url, cond) => (url === URL_ZZ && cond?.etag === '"a"' ? { status: 304 } : { status: 404 });
    pedidos.length = 0;
    const r = await rodar(11);
    assert.equal(pedidos.find((p) => p.url === URL_ZZ)?.etag, '"a"');
    assert.equal(r.mudaram.length, 0);
    const ind = JSON.parse(readFileSync(join(LEIS, "indice.json"), "utf8"));
    assert.equal(ind.gerado_em, geradoAntes, "gerado_em só anda quando o texto muda");
    assert.equal(ind.verificado_em, "2026-10-11T08:00:00.000Z");
    assert.equal(JSON.parse(readFileSync(join(LEIS, "historico.json"), "utf8")).length, 1);
    recarregarSeMudou();
    assert.equal(obra("zz")!.meta.versao, versao);
  });

  it("3ª rodada: texto alterado entra no ar sem reiniciar, com os MESMOS ids e versão nova", async () => {
    const versao = obra("zz")!.meta.versao;
    planalto = (url) => (url === URL_ZZ ? { status: 200, bytes: bytes(html("v2")), etag: '"b"' } : { status: 404 });
    const r = await rodar(12);
    assert.deepEqual(r.mudaram.map((l) => l.id), ["zz"]);
    assert.equal(recarregarSeMudou().recarregou, true);
    assert.match(dispositivo("zz-art-1-caput")!.dispositivo.texto, /v2/);
    assert.notEqual(obra("zz")!.meta.versao, versao);
    const hist = JSON.parse(readFileSync(join(LEIS, "historico.json"), "utf8"));
    assert.equal(hist.at(-1).tipo, "alterada");
    assert.ok(infoConteudo().atualizacoes.some((a) => a.obra_id === "zz" && a.tipo === "alterada"));
  });

  it("4ª rodada: página quebrada (artigos faltando) não substitui a lei boa", async () => {
    planalto = (url) => (url === URL_ZZ ? { status: 200, bytes: bytes(html("quebrada", 4)), etag: '"c"' } : { status: 404 });
    const r = await rodar(13);
    assert.deepEqual(r.falhas.map((l) => l.id), ["zz"]);
    assert.match(r.falhas[0]!.motivo, /mantida a versão anterior/);
    recarregarSeMudou();
    assert.match(dispositivo("zz-art-1-caput")!.dispositivo.texto, /v2/);
  });

  it("5ª rodada: emenda constitucional nova vira aviso; Planalto fora não apaga o aviso", async () => {
    assert.equal(maiorEmenda("… (Redação dada pela Emenda Constitucional nº 141, de 2026) … Emenda Constitucional nº 9 …"), 141);
    planalto = (url, cond) => (url === URL_CF ? { status: 200, bytes: bytes("<p>Emenda Constitucional nº 141, de 2026</p>") } : cond ? { status: 304 } : { status: 404 });
    const r = await rodar(14);
    assert.ok(r.alertas.some((a) => /EC nº 141/.test(a)));
    planalto = () => ({ status: 0 });
    const r2 = await rodar(15);
    assert.equal(r2.respondidas, 0);
    assert.ok(r2.alertas.some((a) => /EC nº 141/.test(a)), "aviso some quando o Planalto não responde");
    const ind = JSON.parse(readFileSync(join(LEIS, "indice.json"), "utf8"));
    assert.equal(ind.verificado_em, "2026-10-14T08:00:00.000Z", "verificado_em não pode andar sem resposta do Planalto");
  });

  it("trava impede duas atualizações ao mesmo tempo", async () => {
    writeFileSync(`${LEIS}.trava`, "outro processo\n");
    await assert.rejects(rodar(16), /em andamento/);
    rmSync(`${LEIS}.trava`);
  });

  it("sem a cópia viva, o servidor volta ao texto do repositório", () => {
    rmSync(LEIS, { recursive: true, force: true });
    assert.equal(recarregarSeMudou().recarregou, true);
    assert.ok(!obras().some((o) => o.id === "zz"));
    assert.equal(infoConteudo().origem, "repositorio");
    assert.ok(!existsSync(LEIS));
  });
});
