/* ==========================================================================
   texto.test.ts — o conteúdo extraído do PDF é o que o sistema espera:
   páginas encadeadas, artigos completos, salto por número e busca.
   ========================================================================== */
process.env["CARTA_AMBIENTE"] = "teste";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { carregarTexto, texto, pagina, dispositivo, buscar, acharArtigo, sumarioLeve, normalizar } from "../src/dados/texto.ts";

before(() => { carregarTexto(); });

describe("conteúdo da Constituição", () => {
  it("tem os dois livros, o preâmbulo e o Art. 250", () => {
    const c = texto();
    assert.equal(c.livros.length, 2);
    assert.equal(c.paginas[0]!.id, "cf-preambulo");
    assert.match(c.paginas[0]!.artigos[0]!.dispositivos[0]!.texto, /^Nós, representantes do povo brasileiro/);
    assert.ok(acharArtigo("art. 250"));
    assert.ok(acharArtigo("adct 138"));
  });
  it("páginas encadeadas de ponta a ponta (anterior/próxima)", () => {
    const c = texto();
    for (let i = 0; i < c.paginas.length; i++) {
      const p = c.paginas[i]!;
      assert.equal(p.ordem, i + 1);
      assert.equal(p.anterior, i > 0 ? c.paginas[i - 1]!.id : null);
      assert.equal(p.proxima, i + 1 < c.paginas.length ? c.paginas[i + 1]!.id : null);
      assert.ok(p.artigos.length > 0, `página ${p.id} sem artigos`);
    }
  });
  it("Art. 5º está no Capítulo I do Título II com os 79 incisos", () => {
    const a = acharArtigo("5")!;
    assert.equal(a.pagina.id, "cf-tii-ci");
    assert.equal(a.artigo.rotulo, "Art. 5º");
    const incisos = a.artigo.dispositivos.filter((d) => d.tipo === "inciso");
    assert.equal(incisos.length, 79);
    assert.equal(incisos[0]!.rotulo, "I");
    assert.equal(incisos[78]!.rotulo, "LXXIX");
    assert.ok(a.artigo.dispositivos.some((d) => d.rotulo === "§ 3º" && d.notas?.length));
  });
  it("todo dispositivo tem id único e texto", () => {
    const ids = new Set<string>();
    for (const p of texto().paginas) for (const a of p.artigos) for (const d of a.dispositivos) {
      assert.ok(!ids.has(d.id), `id repetido ${d.id}`);
      ids.add(d.id);
      assert.ok(d.texto.length > 0 || d.tipo === "caput", `dispositivo vazio ${d.id}`);
      assert.equal(dispositivo(d.id)?.pagina.id, p.id);
    }
    assert.ok(ids.size > 3000);
  });
  it("hifenização de fim de linha foi desfeita; hífen real ficou", () => {
    const a1 = acharArtigo("1")!.artigo;
    const pu = a1.dispositivos.find((d) => d.rotulo === "Parágrafo único")!;
    assert.match(pu.texto, /representantes eleitos/);
    const a4 = acharArtigo("4")!.artigo;
    assert.match(a4.dispositivos.at(-1)!.texto, /latino-americana/);
  });
  it("salto por número entende 'art. 37', 'adct 2' e sufixo '-A'", () => {
    assert.equal(acharArtigo("Art. 37")!.artigo.rotulo, "Art. 37");
    assert.equal(acharArtigo("adct 2")!.pagina.livro, "adct");
    assert.equal(acharArtigo("103-A")!.artigo.rotulo, "Art. 103-A");
    assert.equal(acharArtigo("art 149 b")!.artigo.rotulo, "Art. 149-B");
    assert.equal(acharArtigo("xyz"), undefined);
  });
  it("busca sem acento, todas as palavras, com trecho", () => {
    const r = buscar("dignidade pessoa humana");
    assert.ok(r.total >= 1);
    assert.ok(r.itens.some((i) => i.artigo_rotulo === "Art. 1º" && i.dispositivo_rotulo === "III"));
    assert.equal(normalizar("Ação Direta"), "acao direta");
    assert.equal(buscar("palavraquenaoexiste").total, 0);
  });
  it("sumário leve não carrega o texto e cobre todas as páginas", () => {
    const s = sumarioLeve();
    assert.equal(s.paginas.length, texto().paginas.length);
    assert.ok(!("dispositivos" in (s.paginas[0] as object)));
    const t1 = s.paginas.find((p) => p.id === "cf-ti")!;
    assert.deepEqual(t1.artigos.map((a) => a.rotulo), ["Art. 1º", "Art. 2º", "Art. 3º", "Art. 4º"]);
    assert.equal(t1.artigos[0]!.id, "cf-art-1");
    const folhas: string[] = [];
    const andar = (n: { pagina?: string; filhos: typeof s.sumario }) => { if (n.pagina) folhas.push(n.pagina); n.filhos.forEach(andar); };
    s.sumario.forEach(andar);
    assert.equal(new Set(folhas).size, s.paginas.length);
    assert.ok(pagina("cf-tii-ci"));
  });
});
