/* ==========================================================================
   vademecum.test.ts — o extrator do Planalto e as obras no servidor.

   Duas frentes:
     · o EXTRATOR, contra HTML pequeno escrito aqui (o mesmo tipo de sujeira
       do Planalto: sobrescrito, riscado, rubrica, lei que cita outra lei);
     · o CONTEÚDO gerado (conteudo/obras + indice.json): toda obra fecha a
       conta, ids globais sem colisão, salto e busca entre leis.
   ========================================================================== */
process.env["CARTA_AMBIENTE"] = "teste";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { blocos, partirPorMarcador, decodificar, entidades } from "../ferramentas/leis/html.ts";
import { analisar, separarNotas, capitalizar, romano } from "../ferramentas/leis/analisar.ts";
import { CATALOGO, candidatos } from "../ferramentas/leis/catalogo.ts";
import { carregarTexto, obras, obra, pagina, dispositivo, acharArtigo, buscar, sumarioLeve, obraDaPagina, categorias } from "../src/dados/texto.ts";

const META = { id: "zz", sigla: "ZZ", nome: "Lei de Teste", identificacao: "Lei nº 0", categoria: "Penal" };
const extrair = (html: string) => analisar(META, partirPorMarcador(blocos(html)), { url: "http://x", baixadoEm: "2026-10-04" });

describe("leitura do HTML do Planalto", () => {
  it("sobrescrito vira º, riscado some, entidades e cp1252", () => {
    const b = blocos(`<p>Art. 1<sup><u>o</u></sup> Texto &aacute;gil &#150; fim. <strike>reda&ccedil;&atilde;o antiga</strike></p><p><s>Art. 2º velho</s></p>`);
    assert.equal(b.length, 1);
    assert.equal(b[0]!.texto, "Art. 1º Texto ágil – fim.");
    assert.equal(entidades("&sect; 1&ordm; &quot;x&quot;"), '§ 1º "x"');
    assert.equal(decodificar(new Uint8Array([0x41, 0x72, 0x74, 0xe7])), "Artç");
  });
  it("UTF-16 (a página da Lei Maria da Penha) é reconhecido", () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from("Art. 1º", (c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]).flat()]);
    assert.equal(decodificar(utf16).replace(/^﻿/, ""), "Art. 1º");
  });
  it("centralizado e negrito são percebidos; </body> no meio não encerra a leitura", () => {
    const b = blocos(`<p align="center">TÍTULO I<br>DAS PESSOAS</p></body></html><p><b>Rubrica</b></p><p>Art. 1º x</p>`);
    assert.deepEqual(b.map((x) => [x.centralizado, x.negrito, x.linhas.length]), [[true, false, 2], [false, true, 1], [false, false, 1]]);
  });
  it("notas de alteração saem do texto e ficam à parte", () => {
    const r = separarNotas("I - práticas religiosas; (Incluído pela Lei nº 13.467, de 2017) (Vigência)");
    assert.equal(r.texto, "I - práticas religiosas;");
    assert.deepEqual(r.notas, ["Incluído pela Lei nº 13.467, de 2017", "Vigência"]);
    assert.equal(separarNotas("(Revogado pela Lei nº 9.279, de 1996)").texto, "(Revogado pela Lei nº 9.279, de 1996)");
    assert.equal(capitalizar("DOS CRIMES CONTRA A VIDA"), "Dos Crimes contra a Vida");
    assert.equal(romano("XLIV"), 44);
  });
});

describe("estrutura extraída", () => {
  const html = `
    <p>O PRESIDENTE DA REPÚBLICA Faço saber que o Congresso Nacional decreta:</p>
    <p align="center">PARTE GERAL<br>TÍTULO I<br>DA APLICAÇÃO DA LEI</p>
    <p><b>Anterioridade</b></p>
    <p>Art. 1º - Não há crime sem lei anterior. (Redação dada pela Lei nº 7.209, de 11.7.1984)</p>
    <p>Lei no tempo<br>Art. 2º - A lei posterior aplica-se:</p>
    <p>I - aos fatos anteriores;</p><p>II - aos demais:</p><p>a) primeiro;</p><p>b) segundo.</p>
    <p>Pena - reclusão, de um a dois anos.</p>
    <p>§ 1º Regra um.</p><p>I - inciso do parágrafo;</p>
    <p>Parágrafo único. Não existe.</p>
    <p>Art. 3º - A lei excepcional aplica-se.</p>
    <p>Art. 3º-A. Artigo com letra.</p>
    <p align="center">CAPÍTULO I<br>DO TEMPO</p>
    <p>Art. 4º O art. 121 do Código Penal passa a vigorar com a seguinte redação:</p>
    <p>"Art. 121. Matar alguém:</p><p>Pena - reclusão.</p><p>§ 1º Citado."</p>
    <p>Art. 5º Esta Lei entra em vigor na data de sua publicação.</p>
    <p>Arts. 6º a 8º (Revogados pela Lei nº 1, de 2000)</p>
    <p>Art. 9º Fim.</p>
    <p>Brasília, 7 de dezembro de 1940; 119º da Independência.</p>
    <p>Art. 99. Anexo que não é da lei.</p>`;
  const { obra: o, relatorio } = extrair(html);
  const artigos = o.paginas.flatMap((p) => p.artigos);
  const porRotulo = (r: string) => artigos.find((a) => a.rotulo === r)!;

  it("artigos em sequência, com sufixo colado e faixa revogada; para na assinatura", () => {
    assert.deepEqual(artigos.map((a) => a.rotulo), ["Art. 1º", "Art. 2º", "Art. 3º", "Art. 3º-A", "Art. 4º", "Art. 5º", "Arts. 6º a 8º", "Art. 9º"]);
    assert.equal(relatorio.ultimoArtigo, 9);
    assert.equal(porRotulo("Art. 3º").dispositivos[0]!.texto, "A lei excepcional aplica-se.");     // o "A" não virou sufixo
  });
  it("ids por caminho: caput, inciso, alínea, pena, parágrafo", () => {
    const a2 = porRotulo("Art. 2º");
    assert.deepEqual(a2.dispositivos.map((d) => d.id), [
      "zz-art-2-caput", "zz-art-2-i1", "zz-art-2-i2", "zz-art-2-i2-a", "zz-art-2-i2-b", "zz-art-2-i2-b-pena",
      "zz-art-2-p1", "zz-art-2-p1-i1", "zz-art-2-pu",
    ]);
    assert.deepEqual(a2.dispositivos.map((d) => d.tipo), ["caput", "inciso", "inciso", "alinea", "alinea", "pena", "paragrafo", "inciso", "paragrafo"]);
    assert.equal(porRotulo("Art. 3º-A").id, "zz-art-3-a");
  });
  it("rubrica vai para o artigo; nota de redação sai do texto", () => {
    assert.equal(porRotulo("Art. 1º").rubrica, "Anterioridade");
    assert.equal(porRotulo("Art. 2º").rubrica, "Lei no tempo");
    assert.equal(porRotulo("Art. 1º").dispositivos[0]!.texto, "Não há crime sem lei anterior.");
    assert.deepEqual(porRotulo("Art. 1º").dispositivos[0]!.notas, ["Redação dada pela Lei nº 7.209, de 11.7.1984"]);
  });
  it("texto citado de outra lei fica dentro do artigo que altera", () => {
    const a4 = porRotulo("Art. 4º");
    assert.deepEqual(a4.dispositivos.map((d) => d.tipo), ["caput", "citacao", "citacao", "citacao"]);
    assert.ok(!artigos.some((a) => a.numero === 121));
  });
  it("cabeçalhos em árvore, páginas encadeadas, nomes em caixa normal", () => {
    assert.equal(o.sumario[0]!.rotulo, "Parte Geral");
    const titulo = o.sumario[0]!.filhos[0]!;
    assert.equal(`${titulo.rotulo} — ${titulo.nome}`, "Título I — Da Aplicação da Lei");
    assert.deepEqual(o.paginas.map((p) => p.id), ["zz-pgeral-ti", "zz-pgeral-ti-ci"]);
    assert.equal(o.paginas[0]!.proxima, "zz-pgeral-ti-ci");
    assert.equal(o.paginas[1]!.trilha.map((t) => t.rotulo).join(" › "), "Parte Geral › Título I › Capítulo I");
  });
  it("lei sem cabeçalho é fatiada por faixa de número de artigo", () => {
    const flat = extrair(Array.from({ length: 20 }, (_, i) => `<p>Art. ${i + 1}${i < 9 ? "º" : "."} Texto ${i + 1}.</p>`).join(""));
    assert.deepEqual(flat.obra.paginas.map((p) => [p.id, p.artigos.length]), [["zz-a1", 15], ["zz-a16", 5]]);
  });
  it("catálogo sem ids repetidos e com endereços candidatos", () => {
    assert.equal(new Set(CATALOGO.map((e) => e.id)).size, CATALOGO.length);
    assert.ok(!CATALOGO.some((e) => e.id === "cf" || e.id === "adct"));
    assert.match(candidatos(CATALOGO.find((e) => e.id === "cc")!)[0]!, /leis\/2002\/L10406compilado\.htm$/);
    assert.match(candidatos(CATALOGO.find((e) => e.id === "cp")!)[0]!, /decreto-lei\/Del2848compilado\.htm$/);
  });
});

describe("o Vade Mecum carregado", () => {
  before(() => { carregarTexto(); });

  it("a Constituição continua lá, com os mesmos ids, ao lado das leis", () => {
    assert.ok(obras().length >= 60, `só ${obras().length} obras`);
    assert.equal(obras()[0]!.id, "cf");
    assert.ok(pagina("cf-tii-ci"));
    assert.equal(obraDaPagina("adct-1-10")?.id, "cf");
    assert.ok(categorias().includes("Penal"));
  });
  it("toda obra do catálogo fecha a conta do último artigo", () => {
    for (const e of CATALOGO) {
      const o = obra(e.id);
      assert.ok(o, `obra ${e.id} não foi gerada — rode: npm run leis`);
      if (!e.ultimo) continue;
      const max = Math.max(...o.conteudo.paginas.flatMap((p) => p.artigos.map((a) => a.numero)));
      assert.ok(max >= e.ultimo, `${e.sigla}: último artigo ${max}, esperado ${e.ultimo}`);
    }
  });
  it("ids de página e de dispositivo são únicos no Vade Mecum inteiro", () => {
    const paginas = new Set<string>(), disps = new Set<string>();
    for (const m of obras()) for (const p of obra(m.id)!.conteudo.paginas) {
      assert.ok(!paginas.has(p.id), `página repetida ${p.id}`);
      paginas.add(p.id);
      assert.ok(m.prefixos.some((x) => p.id === x || p.id.startsWith(x + "-")), `página ${p.id} fora do prefixo de ${m.id}`);
      for (const a of p.artigos) for (const d of a.dispositivos) {
        assert.ok(!disps.has(d.id), `dispositivo repetido ${d.id}`);
        disps.add(d.id);
      }
    }
    assert.ok(disps.size > 40_000);
  });
  it("páginas de cada obra encadeadas e cobertas pelo sumário", () => {
    for (const m of obras()) {
      const s = sumarioLeve(m.id);
      const folhas = new Set<string>();
      const andar = (n: { pagina?: string; filhos: typeof s.sumario }) => { if (n.pagina) folhas.add(n.pagina); n.filhos.forEach(andar); };
      s.sumario.forEach(andar);
      assert.equal(folhas.size, s.paginas.length, `${m.sigla}: sumário cobre ${folhas.size} de ${s.paginas.length} páginas`);
      s.paginas.forEach((p, i) => {
        assert.equal(p.anterior, i ? s.paginas[i - 1]!.id : null);
        assert.equal(p.proxima, i + 1 < s.paginas.length ? s.paginas[i + 1]!.id : null);
      });
    }
  });
  it("artigos conhecidos estão onde devem", () => {
    const hom = acharArtigo("art. 121 cp")!;
    assert.equal(hom.obra.id, "cp");
    assert.match(hom.artigo.dispositivos[0]!.texto, /^Matar algu[eé]m/);
    assert.ok(hom.artigo.dispositivos.some((d) => d.tipo === "pena" && /reclusão, de seis a vinte anos/.test(d.texto)));
    assert.equal(dispositivo("cp-art-121-caput")?.pagina.obra, "cp");
    assert.match(acharArtigo("cc 186")!.artigo.dispositivos[0]!.texto, /ato ilícito/);
    assert.equal(acharArtigo("1.639", "cc")!.artigo.rotulo, "Art. 1.639");
    assert.equal(acharArtigo("art 5")!.obra.id, "cf");                 // sem sigla, vale a obra padrão
    assert.equal(acharArtigo("art 5", "clt")!.obra.id, "clt");
    assert.equal(acharArtigo("adct 2")!.pagina.livro, "adct");
    assert.equal(acharArtigo("121-A cp")!.artigo.rotulo, "Art. 121-A");
    assert.match(acharArtigo("art. 3º", "cdc")!.artigo.dispositivos[0]!.texto, /Fornecedor é toda pessoa/);
  });
  it("busca no Vade Mecum inteiro e restrita a uma lei", () => {
    const tudo = buscar("legítima defesa");
    assert.ok(tudo.por_obra.length >= 2);
    assert.ok(tudo.por_obra.some((p) => p.obra_id === "cp"));
    const so = buscar("legítima defesa", { obra: "cp" });
    assert.ok(so.total >= 1 && so.itens.every((i) => i.obra_id === "cp"));
    assert.equal(buscar("art 121 cp").artigo?.obra_sigla, "CP");
  });
});
