/* ==========================================================================
   api/index.ts — monta o roteador completo da API v1.
   ========================================================================== */
import { Roteador } from "../http/roteador.ts";
import { VERSAO } from "../nucleo/versao.ts";
import { registrarAutenticacao } from "./autenticacao.ts";
import { registrarTexto } from "./texto.ts";
import { registrarAnotacoes } from "./anotacoes.ts";
import { registrarEstudo } from "./estudo.ts";

export function montarApi(): Roteador {
  const r = new Roteador();

  r.get("/api/v1/saude", async () => ({ corpo: { ok: true, servico: "la-carta", versao: VERSAO } }), { autenticada: false });

  registrarAutenticacao(r);
  registrarTexto(r);
  registrarAnotacoes(r);
  registrarEstudo(r);

  return r;
}
