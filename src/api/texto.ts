/* ==========================================================================
   api/texto.ts — o texto constitucional: sumário, página, busca e salto
   para artigo. Tudo autenticado: o caderno é pessoal, o texto vai junto.
   ========================================================================== */
import type { Roteador } from "../http/roteador.ts";
import { erroNaoEncontrado, erroValidacao } from "../nucleo/erros.ts";
import { sumarioLeve, pagina, buscar, acharArtigo } from "../dados/texto.ts";

export function registrarTexto(r: Roteador): void {
  r.get("/api/v1/texto/sumario", async () => ({
    corpo: sumarioLeve(),
    cabecalhos: { "Cache-Control": "private, max-age=3600" },
  }));

  r.get("/api/v1/texto/paginas/:id", async (ctx) => {
    const p = pagina(ctx.params["id"]!);
    if (!p) throw erroNaoEncontrado("Página");
    return { corpo: p, cabecalhos: { "Cache-Control": "private, max-age=3600" } };
  });

  r.get("/api/v1/texto/busca", async (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    if (q.length < 2) throw erroValidacao("Digite pelo menos 2 caracteres.");
    if (q.length > 120) throw erroValidacao("Busca longa demais.");
    return { corpo: buscar(q) };
  });

  /* "art 5", "37", "adct 2": onde está o artigo. */
  r.get("/api/v1/texto/artigo", async (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    const achado = acharArtigo(q);
    if (!achado) throw erroNaoEncontrado("Artigo");
    return { corpo: { pagina_id: achado.pagina.id, artigo_id: achado.artigo.id, rotulo: achado.artigo.rotulo } };
  });
}
