/* ==========================================================================
   apoio-teste.ts — sobe o sistema INTEIRO (banco em memória + HTTP em porta
   efêmera) para os testes de API e autorização. Nada de mock: o que o teste
   exercita é o mesmo caminho que a produção roda.

   Os imports do src/ são DINÂMICOS de propósito: import estático içaria o
   config.ts para antes destas linhas de ambiente.
   ========================================================================== */
process.env["PORTA"] = "0";
process.env["CARTA_AMBIENTE"] = "teste";
process.env["CARTA_BANCO"] = "sqlite";

import type { Server } from "node:http";

export interface Ambiente {
  base: string;
  servidor: Server;
  fechar: () => Promise<void>;
}

export async function subirAmbiente(): Promise<Ambiente> {
  const { abrirBanco, fecharBanco } = await import("../src/dados/bd.ts");
  const { migrar } = await import("../src/dados/migrar.ts");
  const { montarApi } = await import("../src/api/index.ts");
  const { ouvir } = await import("../src/http/servidor.ts");

  await abrirBanco({ tipo: "sqlite", caminhoOuUrl: ":memory:" });
  await migrar();
  const servidor = ouvir(montarApi());
  await new Promise<void>((r) => servidor.once("listening", () => r()));
  const endereco = servidor.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  return {
    base: `http://127.0.0.1:${porta}`,
    servidor,
    fechar: async () => {
      await new Promise<void>((r) => servidor.close(() => r()));
      await fecharBanco();
    },
  };
}

export async function criarUsuario(email: string, senha: string, nome = "Teste"): Promise<string> {
  const { banco } = await import("../src/dados/bd.ts");
  const { semear } = await import("../src/dados/semear.ts");
  const r = await semear(banco(), { email, senha, nome });
  return r.usuarioId;
}

export class Cliente {
  base: string;
  cookie = "";
  constructor(base: string) { this.base = base; }

  async requisicao(metodo: string, caminho: string, corpo?: unknown, opcoes?: { semCsrf?: boolean; semCookie?: boolean }) {
    const cabecalhos: Record<string, string> = {};
    if (!opcoes?.semCsrf) cabecalhos["X-Requisicao"] = "carta";
    if (this.cookie && !opcoes?.semCookie) cabecalhos["Cookie"] = this.cookie;
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
    const init: RequestInit = { method: metodo, headers: cabecalhos };
    if (corpo !== undefined) init.body = JSON.stringify(corpo);
    const resposta = await fetch(this.base + caminho, init);
    const setCookie = resposta.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    const dados = await resposta.json().catch(() => ({}));
    return { status: resposta.status, dados: dados as Record<string, any> };
  }

  get = (c: string) => this.requisicao("GET", c);
  post = (c: string, corpo?: unknown, o?: { semCsrf?: boolean }) => this.requisicao("POST", c, corpo ?? {}, o);
  put = (c: string, corpo?: unknown) => this.requisicao("PUT", c, corpo ?? {});
  del = (c: string) => this.requisicao("DELETE", c);

  async entrar(email: string, senha: string) {
    return this.post("/api/v1/entrar", { email, senha });
  }
}
