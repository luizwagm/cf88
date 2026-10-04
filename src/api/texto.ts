/* ==========================================================================
   api/texto.ts — o texto do Vade Mecum: a lista de obras, o sumário de cada
   uma, a página, a obra inteira (para baixar e usar sem internet), busca e
   salto para artigo. Tudo autenticado: o caderno é pessoal.
   ========================================================================== */
import type { Roteador } from "../http/roteador.ts";
import { erroNaoEncontrado, erroValidacao } from "../nucleo/erros.ts";
import { sumarioLeve, pagina, buscar, acharArtigo, obras, categorias, obra, existeObra } from "../dados/texto.ts";

const CACHE = { "Cache-Control": "private, max-age=3600" };

export function registrarTexto(r: Roteador): void {
  /* A estante: todas as obras, por categoria. */
  r.get("/api/v1/texto/obras", async () => ({ corpo: { categorias: categorias(), obras: obras() }, cabecalhos: CACHE }));

  /* Sumário de uma obra (sem ?obra é a Constituição — o que sempre foi). */
  r.get("/api/v1/texto/sumario", async (ctx) => {
    const id = (ctx.query.get("obra") ?? "cf").trim();
    if (!existeObra(id)) throw erroNaoEncontrado("Obra");
    return { corpo: sumarioLeve(id), cabecalhos: CACHE };
  });

  /* A obra inteira numa resposta só: é o que o tablet guarda para ler offline. */
  r.get("/api/v1/texto/obras/:id/completo", async (ctx) => {
    const id = ctx.params["id"]!;
    const o = obra(id);
    if (!o) throw erroNaoEncontrado("Obra");
    return { corpo: { sumario: sumarioLeve(id), paginas: o.conteudo.paginas }, cabecalhos: CACHE };
  });

  r.get("/api/v1/texto/paginas/:id", async (ctx) => {
    const p = pagina(ctx.params["id"]!);
    if (!p) throw erroNaoEncontrado("Página");
    return { corpo: p, cabecalhos: CACHE };
  });

  r.get("/api/v1/texto/busca", async (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    if (q.length < 2) throw erroValidacao("Digite pelo menos 2 caracteres.");
    if (q.length > 120) throw erroValidacao("Busca longa demais.");
    const filtro = (ctx.query.get("obra") ?? "").trim();
    if (filtro && !existeObra(filtro)) throw erroNaoEncontrado("Obra");
    const padrao = (ctx.query.get("em") ?? "cf").trim();
    return { corpo: buscar(q, { ...(filtro ? { obra: filtro } : {}), obraPadrao: existeObra(padrao) ? padrao : "cf" }) };
  });

  /* "art 5", "121 cp", "adct 2": onde está o artigo. `obra` é a lei em que o leitor está. */
  r.get("/api/v1/texto/artigo", async (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    const padrao = (ctx.query.get("obra") ?? "cf").trim();
    const achado = acharArtigo(q, existeObra(padrao) ? padrao : "cf");
    if (!achado) throw erroNaoEncontrado("Artigo");
    return { corpo: { pagina_id: achado.pagina.id, artigo_id: achado.artigo.id, rotulo: achado.artigo.rotulo, obra_id: achado.obra.id, obra_sigla: achado.obra.sigla } };
  });
}
