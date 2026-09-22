/* ==========================================================================
   offline.test.ts — o que o caderno precisa do servidor para funcionar sem
   internet: ids gerados no cliente aceitos e reenvio idempotente (a fila
   offline manda a mesma operação duas vezes sem duplicar), o service worker
   servido com a versão real e o manifesto instalável.
   ========================================================================== */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { subirAmbiente, criarUsuario, Cliente, type Ambiente } from "./apoio-teste.ts";

let ambiente: Ambiente;
let c: Cliente;
let outro: Cliente;
let caputId: string;

before(async () => {
  const { carregarTexto } = await import("../src/dados/texto.ts");
  carregarTexto();
  ambiente = await subirAmbiente();
  await criarUsuario("off@lacarta.local", "senha-de-teste-123", "Off");
  await criarUsuario("outro-off@lacarta.local", "outra-senha-456", "Outro");
  c = new Cliente(ambiente.base);
  outro = new Cliente(ambiente.base);
  await c.entrar("off@lacarta.local", "senha-de-teste-123");
  await outro.entrar("outro-off@lacarta.local", "outra-senha-456");
  caputId = (await c.get("/api/v1/texto/paginas/cf-ti")).dados["artigos"][0].dispositivos[0].id;
});
after(async () => { await ambiente.fechar(); });

const uuid = () => crypto.randomUUID();

describe("ids do cliente e reenvio idempotente", () => {
  it("marcação com id do cliente: criada uma vez, reenviada sem duplicar", async () => {
    const id = uuid();
    const corpo = { id, dispositivo_id: caputId, inicio: 0, fim: 10, cor: "#fff59a" };
    const r1 = await c.post("/api/v1/paginas/cf-ti/marcacoes", corpo);
    assert.equal(r1.status, 201);
    assert.equal(r1.dados["id"], id);
    const r2 = await c.post("/api/v1/paginas/cf-ti/marcacoes", corpo);
    assert.equal(r2.status, 200);
    assert.equal(r2.dados["id"], id);
    const a = await c.get("/api/v1/paginas/cf-ti/anotacoes");
    assert.equal(a.dados["marcacoes"].filter((m: any) => m.id === id).length, 1);
  });
  it("nota e traços com id do cliente, idem", async () => {
    const idNota = uuid();
    assert.equal((await c.post("/api/v1/paginas/cf-ti/notas", { id: idNota, dispositivo_id: caputId, texto: "offline", cor: "#b9f2d6" })).status, 201);
    assert.equal((await c.post("/api/v1/paginas/cf-ti/notas", { id: idNota, dispositivo_id: caputId, texto: "offline", cor: "#b9f2d6" })).status, 200);
    const idTraco = uuid();
    const lote = { tracos: [{ id: idTraco, dispositivo_id: caputId, ferramenta: "caneta", cor: "#1d2433", largura: 2, pontos: [1, 1, 0.5, 5, 5, 0.5], largura_ref: 700, altura_ref: 50 }] };
    assert.deepEqual((await c.post("/api/v1/paginas/cf-ti/tracos", lote)).dados["ids"], [idTraco]);
    assert.deepEqual((await c.post("/api/v1/paginas/cf-ti/tracos", lote)).dados["ids"], [idTraco]);
    const a = await c.get("/api/v1/paginas/cf-ti/anotacoes");
    assert.equal(a.dados["notas"].length, 1);
    assert.equal(a.dados["tracos"].length, 1);
  });
  it("id malformado é recusado; id de outro usuário também", async () => {
    assert.equal((await c.post("/api/v1/paginas/cf-ti/notas", { id: "curto", dispositivo_id: caputId, texto: "x", cor: "#b9f2d6" })).status, 400);
    const id = uuid();
    assert.equal((await c.post("/api/v1/paginas/cf-ti/notas", { id, dispositivo_id: caputId, texto: "minha", cor: "#b9f2d6" })).status, 201);
    assert.equal((await outro.post("/api/v1/paginas/cf-ti/notas", { id, dispositivo_id: caputId, texto: "roubo", cor: "#b9f2d6" })).status, 400);
  });
  it("apagar o que já não existe devolve 404 (a fila descarta e segue)", async () => {
    assert.equal((await c.del(`/api/v1/notas/${uuid()}`)).status, 404);
    assert.equal((await c.put(`/api/v1/marcacoes/${uuid()}`, { estilo: "riscado" })).status, 404);
  });
});

describe("aplicativo instalável", () => {
  it("/sw.js sai com a versão real e sem cache HTTP", async () => {
    const r = await fetch(ambiente.base + "/sw.js");
    assert.equal(r.status, 200);
    const corpo = await r.text();
    const saude = (await (await fetch(ambiente.base + "/api/v1/saude")).json()) as any;
    assert.ok(corpo.includes(`const VERSAO = "${saude.versao}"`));
    assert.ok(!corpo.includes("__VERSAO__"));
    assert.equal(r.headers.get("cache-control"), "no-cache");
    assert.match(r.headers.get("content-type") ?? "", /javascript/);
  });
  it("manifesto, ícones e a casca que o service worker precisa existem", async () => {
    const m = await fetch(ambiente.base + "/manifest.webmanifest");
    assert.equal(m.status, 200);
    const manifesto = (await m.json()) as any;
    assert.equal(manifesto.display, "standalone");
    assert.ok(manifesto.icons.some((i: any) => i.sizes === "512x512" && i.purpose === "maskable"));
    const sw = await (await fetch(ambiente.base + "/sw.js")).text();
    const casca = [...sw.matchAll(/"(\/[^"]+)"/g)].map((x) => x[1]!).filter((p) => p !== "/" && p.includes("."));
    assert.ok(casca.length >= 12);
    for (const p of casca) assert.equal((await fetch(ambiente.base + p)).status, 200, p);
    const html = await (await fetch(ambiente.base + "/")).text();
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  });
});
