/* ==========================================================================
   api.test.ts — o fluxo do caderno pela API real: login e proteções,
   texto, traços, marcações, notas, leitura, resumo, revisão, preferências
   e isolamento entre dois usuários.
   ========================================================================== */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { subirAmbiente, criarUsuario, Cliente, type Ambiente } from "./apoio-teste.ts";

let ambiente: Ambiente;
let c: Cliente;
let outro: Cliente;
let art5: any;
let caputId: string;
let incisoId: string;
let tracoIds: string[] = [];
let marcacaoId: string;
let notaId: string;

before(async () => {
  const { carregarTexto } = await import("../src/dados/texto.ts");
  carregarTexto();
  ambiente = await subirAmbiente();
  await criarUsuario("teste@lacarta.local", "senha-de-teste-123", "Teste");
  await criarUsuario("outro@lacarta.local", "outra-senha-456", "Outro");
  c = new Cliente(ambiente.base);
  outro = new Cliente(ambiente.base);
  assert.equal((await c.entrar("teste@lacarta.local", "senha-de-teste-123")).status, 200);
  assert.equal((await outro.entrar("outro@lacarta.local", "outra-senha-456")).status, 200);
});
after(async () => { await ambiente.fechar(); });

describe("autenticação e proteção", () => {
  it("/saude é pública e informa a versão", async () => {
    const r = await new Cliente(ambiente.base).get("/api/v1/saude");
    assert.equal(r.status, 200);
    assert.equal(r.dados["servico"], "la-carta");
    assert.match(r.dados["versao"], /^\d+\.\d+\.\d+$/);
  });
  it("rota sem sessão devolve 401", async () => {
    assert.equal((await new Cliente(ambiente.base).get("/api/v1/resumo")).status, 401);
    assert.equal((await new Cliente(ambiente.base).get("/api/v1/texto/sumario")).status, 401);
  });
  it("mutação sem cabeçalho anti-CSRF devolve 403", async () => {
    const r = await c.requisicao("PUT", "/api/v1/preferencias", { tamanho_fonte: "20" }, { semCsrf: true });
    assert.equal(r.status, 403);
  });
  it("login errado devolve a MESMA mensagem para conta inexistente e senha errada", async () => {
    const a = new Cliente(ambiente.base);
    const r1 = await a.entrar("nao-existe@x.com", "qualquer");
    const r2 = await a.entrar("teste@lacarta.local", "senha-errada");
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
    assert.equal(r1.dados["erro"], r2.dados["erro"]);
  });
  it("força bruta trava a conta depois de 6 falhas", async () => {
    const atacante = new Cliente(ambiente.base);
    let ultimo = 0;
    for (let i = 0; i < 8; i++) ultimo = (await atacante.entrar("vitima@lacarta.local", "chute-" + i)).status;
    assert.equal(ultimo, 429);
  });
  it("estático fora de publico/ não sai (autorização por lugar)", async () => {
    for (const caminho of ["/package.json", "/src/servidor.ts", "/../package.json", "/.env.exemplo", "/sql/001_esquema.sql", "/conteudo/cf88.json", "/js/../../package.json"]) {
      const r = await fetch(ambiente.base + caminho);
      assert.notEqual(r.status, 200, caminho);
    }
    const spa = await fetch(ambiente.base + "/.env");
    const corpo = await spa.text();
    assert.match(corpo, /^<!DOCTYPE html>/i);
    assert.doesNotMatch(corpo, /CARTA_SEGREDO/);
  });
  it("cabeçalhos de segurança presentes", async () => {
    const r = await fetch(ambiente.base + "/");
    assert.match(r.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  });
  it("/eu devolve o usuário", async () => {
    const r = await c.get("/api/v1/eu");
    assert.equal(r.dados["email"], "teste@lacarta.local");
  });
});

describe("texto", () => {
  it("sumário leve e página completa", async () => {
    const s = await c.get("/api/v1/texto/sumario");
    assert.equal(s.status, 200);
    assert.ok(s.dados["paginas"].length > 80);
    const p = await c.get("/api/v1/texto/paginas/cf-tii-ci");
    assert.equal(p.status, 200);
    art5 = p.dados["artigos"][0];
    assert.equal(art5.rotulo, "Art. 5º");
    caputId = art5.dispositivos[0].id;
    incisoId = art5.dispositivos.find((d: any) => d.rotulo === "II").id;
  });
  it("página inexistente dá 404; busca curta dá 400", async () => {
    assert.equal((await c.get("/api/v1/texto/paginas/nao-existe")).status, 404);
    assert.equal((await c.get("/api/v1/texto/busca?q=a")).status, 400);
  });
  it("busca e salto para artigo", async () => {
    const b = await c.get("/api/v1/texto/busca?q=" + encodeURIComponent("asilo inviolável"));
    assert.equal(b.status, 200);
    assert.ok(b.dados["itens"].some((i: any) => i.dispositivo_rotulo === "XI"));
    const a = await c.get("/api/v1/texto/artigo?q=" + encodeURIComponent("art. 37"));
    assert.equal(a.dados["rotulo"], "Art. 37");
    assert.equal((await c.get("/api/v1/texto/artigo?q=999")).status, 404);
  });
});

describe("traços de caneta", () => {
  it("grava um lote e devolve ids na ordem", async () => {
    const r = await c.post("/api/v1/paginas/cf-tii-ci/tracos", { tracos: [
      { dispositivo_id: caputId, ferramenta: "caneta", cor: "#1D2433", largura: 2.2, pontos: [1, 2, 0.5, 10, 12, 0.6, 20, 22, 0.7], largura_ref: 700, altura_ref: 90 },
      { dispositivo_id: incisoId, ferramenta: "marcador", cor: "#fff59a", largura: 16, pontos: [0, 5, 0.5, 300, 5, 0.5], largura_ref: 700, altura_ref: 40 },
    ] });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    tracoIds = r.dados["ids"];
    assert.equal(tracoIds.length, 2);
  });
  it("rejeita dispositivo de outra página, cor inválida e pontos tortos", async () => {
    const outraPagina = (await c.get("/api/v1/texto/paginas/cf-ti")).dados["artigos"][0].dispositivos[0].id;
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/tracos", { tracos: [{ dispositivo_id: outraPagina, ferramenta: "caneta", cor: "#000000", largura: 2, pontos: [1, 1, 1, 2, 2, 1], largura_ref: 1, altura_ref: 1 }] })).status, 400);
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/tracos", { tracos: [{ dispositivo_id: caputId, ferramenta: "caneta", cor: "red", largura: 2, pontos: [1, 1, 1, 2, 2, 1], largura_ref: 1, altura_ref: 1 }] })).status, 400);
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/tracos", { tracos: [{ dispositivo_id: caputId, ferramenta: "caneta", cor: "#000000", largura: 2, pontos: [1, 1], largura_ref: 1, altura_ref: 1 }] })).status, 400);
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/tracos", { tracos: [] })).status, 400);
  });
  it("lê os traços da página com a cor normalizada e pontos abertos", async () => {
    const r = await c.get("/api/v1/paginas/cf-tii-ci/anotacoes");
    assert.equal(r.dados["tracos"].length, 2);
    assert.equal(r.dados["tracos"][0].cor, "#1d2433");
    assert.deepEqual(r.dados["tracos"][0].pontos, [1, 2, 0.5, 10, 12, 0.6, 20, 22, 0.7]);
  });
  it("outro usuário não vê nem apaga", async () => {
    const r = await outro.get("/api/v1/paginas/cf-tii-ci/anotacoes");
    assert.equal(r.dados["tracos"].length, 0);
    assert.equal((await outro.del(`/api/v1/tracos/${tracoIds[0]}`)).status, 404);
    const lote = await outro.post("/api/v1/tracos/apagar", { ids: tracoIds });
    assert.equal(lote.dados["apagados"], 0);
  });
  it("apaga em lote e um a um", async () => {
    assert.equal((await c.post("/api/v1/tracos/apagar", { ids: [tracoIds[0]] })).dados["apagados"], 1);
    assert.equal((await c.del(`/api/v1/tracos/${tracoIds[1]}`)).status, 200);
    assert.equal((await c.get("/api/v1/paginas/cf-tii-ci/anotacoes")).dados["tracos"].length, 0);
  });
});

describe("marcações de trecho", () => {
  it("cria com o trecho calculado pelo servidor", async () => {
    const r = await c.post("/api/v1/paginas/cf-tii-ci/marcacoes", { dispositivo_id: incisoId, inicio: 0, fim: 7, cor: "#fff59a" });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    assert.equal(r.dados["trecho"], "ninguém");
    assert.equal(r.dados["estilo"], "marca");
    marcacaoId = r.dados["id"];
  });
  it("rejeita intervalo fora do texto", async () => {
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/marcacoes", { dispositivo_id: incisoId, inicio: 5, fim: 5, cor: "#fff59a" })).status, 400);
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/marcacoes", { dispositivo_id: incisoId, inicio: 0, fim: 99999, cor: "#fff59a" })).status, 400);
  });
  it("muda estilo e cor; outro usuário não", async () => {
    const r = await c.put(`/api/v1/marcacoes/${marcacaoId}`, { estilo: "sublinhado", cor: "#c62828" });
    assert.equal(r.dados["estilo"], "sublinhado");
    assert.equal((await outro.put(`/api/v1/marcacoes/${marcacaoId}`, { estilo: "riscado" })).status, 404);
  });
});

describe("notas e leitura", () => {
  it("cria, edita e lista a nota", async () => {
    const r = await c.post("/api/v1/paginas/cf-tii-ci/notas", { dispositivo_id: caputId, texto: "Princípio da igualdade — cai muito na OAB.", cor: "#b9f2d6" });
    assert.equal(r.status, 201, JSON.stringify(r.dados));
    notaId = r.dados["id"];
    const e = await c.put(`/api/v1/notas/${notaId}`, { texto: "Princípio da isonomia — cai muito na OAB." });
    assert.equal(e.status, 200);
    const a = await c.get("/api/v1/paginas/cf-tii-ci/anotacoes");
    assert.equal(a.dados["notas"].length, 1);
    assert.match(a.dados["notas"][0].texto, /isonomia/);
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/notas", { dispositivo_id: caputId, texto: "", cor: "#b9f2d6" })).status, 400);
  });
  it("registra a visita e a posição", async () => {
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/leitura", { posicao: 0, contar: true })).status, 200);
    assert.equal((await c.post("/api/v1/paginas/cf-tii-ci/leitura", { posicao: 0.42, contar: false })).status, 200);
    assert.equal((await c.post("/api/v1/paginas/cf-ti/leitura", { posicao: 0 })).status, 200);
    const a = await c.get("/api/v1/paginas/cf-tii-ci/anotacoes");
    assert.equal(a.dados["leitura"].visitas, 1);
    assert.equal(Number(a.dados["leitura"].posicao), 0.42);
  });
});

describe("estante e revisão", () => {
  it("resumo consolida contagens, última página e páginas anotadas", async () => {
    const r = await c.get("/api/v1/resumo");
    assert.equal(r.status, 200);
    assert.equal(r.dados["paginas_lidas"], 2);
    assert.equal(r.dados["contagens"].marcacoes, 1);
    assert.equal(r.dados["contagens"].notas, 1);
    assert.equal(r.dados["ultima"].pagina_id, "cf-ti");
    const p = r.dados["paginas"].find((x: any) => x.pagina_id === "cf-tii-ci");
    assert.equal(p.marcacoes, 1);
    assert.equal(p.notas, 1);
    assert.equal(p.rotulo, "Capítulo I");
  });
  it("revisão lista marcações e notas na ordem do livro, com referência", async () => {
    const r = await c.get("/api/v1/anotacoes");
    assert.equal(r.dados["itens"].length, 2);
    assert.equal(r.dados["itens"][0].tipo, "nota");            // caput vem antes do inciso II
    assert.equal(r.dados["itens"][0].referencia, "Art. 5º");
    assert.equal(r.dados["itens"][1].referencia, "Art. 5º, II");
    assert.equal((await outro.get("/api/v1/anotacoes")).dados["itens"].length, 0);
  });
  it("apaga a marcação e a nota", async () => {
    assert.equal((await c.del(`/api/v1/marcacoes/${marcacaoId}`)).status, 200);
    assert.equal((await c.del(`/api/v1/notas/${notaId}`)).status, 200);
    assert.equal((await c.del(`/api/v1/notas/${notaId}`)).status, 404);
  });
});

describe("preferências e conta", () => {
  it("lê os padrões, grava e valida", async () => {
    const p = await c.get("/api/v1/preferencias");
    assert.equal(p.dados["tamanho_fonte"], "19");
    const g = await c.put("/api/v1/preferencias", { tamanho_fonte: "22", cor_caneta: "#1f4fb3", ferramenta: "marcador", desenhar_com_dedo: "1" });
    assert.equal(g.status, 200);
    assert.equal((await c.get("/api/v1/preferencias")).dados["tamanho_fonte"], "22");
    assert.equal((await c.put("/api/v1/preferencias", { tamanho_fonte: "99" })).status, 400);
    assert.equal((await c.put("/api/v1/preferencias", { inventada: "x" })).status, 400);
  });
  it("troca a senha e a sessão antiga cai", async () => {
    const r = await c.post("/api/v1/trocar-senha", { senha_atual: "senha-de-teste-123", senha_nova: "nova-senha-forte-789" });
    assert.equal(r.status, 200);
    assert.equal((await c.get("/api/v1/eu")).status, 200);
    const velho = new Cliente(ambiente.base);
    assert.equal((await velho.entrar("teste@lacarta.local", "senha-de-teste-123")).status, 401);
    assert.equal((await velho.entrar("teste@lacarta.local", "nova-senha-forte-789")).status, 200);
  });
});
