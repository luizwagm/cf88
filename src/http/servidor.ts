/* ==========================================================================
   servidor.ts (http) — estáticos + /api.

   · IP real: com PROXIES_CONFIAVEIS=0 o X-Forwarded-For é IGNORADO. Com N
     proxies vale o N-ésimo item a partir da DIREITA — o primeiro da esquerda
     é texto do atacante.
   · CSRF: cookie SameSite=Strict + cabeçalho "X-Requisicao: carta" em toda
     requisição mutante.
   · CSP sem 'unsafe-inline': todo JS e CSS em arquivos próprios. A voz é a
     Web Speech API do próprio navegador — nada externo.
   · Erro interno nunca ecoa mensagem crua.
   ========================================================================== */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, normalize, extname, sep } from "node:path";
import { config, RAIZ } from "../nucleo/config.ts";
import { log } from "../nucleo/log.ts";
import { ErroHttp, erroNaoAutenticado } from "../nucleo/erros.ts";
import type { Roteador, Contexto } from "./roteador.ts";
import { lerCookie, validarSessao } from "./sessao.ts";
import { VERSAO } from "../nucleo/versao.ts";

const PASTA_PUBLICA = resolve(RAIZ, "publico");
const LIMITE_CORPO = 4_000_000; // lote de traços de uma página cheia cabe folgado

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function cabecalhosSeguranca(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.producao) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

export function extrairIp(req: IncomingMessage): string {
  const direto = req.socket.remoteAddress ?? "";
  const n = config.proxiesConfiaveis;
  if (n <= 0) return direto;
  const xff = String(req.headers["x-forwarded-for"] ?? "");
  const itens = xff.split(",").map((s) => s.trim()).filter(Boolean);
  const idx = itens.length - n;
  if (idx < 0 || !itens[idx]) return direto;
  return itens[idx]!;
}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolver, rejeitar) => {
    const pedacos: Buffer[] = [];
    let total = 0;
    req.on("data", (p: Buffer) => {
      total += p.length;
      if (total > LIMITE_CORPO) {
        rejeitar(new ErroHttp(413, "Corpo da requisição grande demais."));
        req.destroy();
        return;
      }
      pedacos.push(p);
    });
    req.on("end", () => {
      if (total === 0) return resolver(undefined);
      try {
        resolver(JSON.parse(Buffer.concat(pedacos).toString("utf8")));
      } catch {
        rejeitar(new ErroHttp(400, "JSON inválido no corpo da requisição."));
      }
    });
    req.on("error", rejeitar);
  });
}

function servirEstatico(caminho: string, res: ServerResponse): boolean {
  /* Autorização POR LUGAR, não por extensão: só sai daqui o que está DENTRO
     de publico/ depois de normalizar o caminho. */
  const alvo = normalize(resolve(PASTA_PUBLICA, "." + caminho));
  if (alvo !== PASTA_PUBLICA && !alvo.startsWith(PASTA_PUBLICA + sep)) return false;
  if (!existsSync(alvo) || !statSync(alvo).isFile()) return false;

  const tipo = TIPOS[extname(alvo).toLowerCase()];
  if (!tipo) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", tipo);
  const revalida = [".html", ".js", ".css"].includes(extname(alvo).toLowerCase());
  res.setHeader("Cache-Control", revalida ? "no-cache" : "public, max-age=86400");
  res.end(readFileSync(alvo));
  return true;
}

export function ouvir(roteador: Roteador): Server {
  const servidor = createServer(async (req, res) => {
    cabecalhosSeguranca(res);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
    const caminho = url.pathname;

    try {
      if (caminho.startsWith("/api/")) {
        await tratarApi(roteador, req, res, caminho, url.searchParams);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end("Método não permitido");
        return;
      }
      if (caminho === "/" || caminho === "/index.html") {
        servirEstatico("/index.html", res);
        return;
      }
      /* O service worker sai com a versão real no lugar de __VERSAO__: versão
         nova = cache nova da casca. Sem cache HTTP, para o navegador ver a
         troca na próxima abertura. */
      if (caminho === "/sw.js") {
        res.statusCode = 200;
        res.setHeader("Content-Type", TIPOS[".js"]!);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(readFileSync(resolve(PASTA_PUBLICA, "sw.js"), "utf8").replace(/__VERSAO__/g, VERSAO));
        return;
      }
      if (servirEstatico(caminho, res)) return;
      if (!extname(caminho)) {
        servirEstatico("/index.html", res);
        return;
      }
      res.statusCode = 404;
      res.end("Não encontrado");
    } catch (e) {
      responderErro(res, e, caminho);
    }
  });

  servidor.listen(config.porta, config.host, () => {
    log.info("servidor ouvindo", { host: config.host, porta: config.porta });
  });
  return servidor;
}

async function tratarApi(roteador: Roteador, req: IncomingMessage, res: ServerResponse, caminho: string, query: URLSearchParams): Promise<void> {
  const metodo = (req.method ?? "GET").toUpperCase();
  const achado = roteador.achar(metodo, caminho);
  if (!achado) {
    responderJson(res, 404, { erro: "Rota não encontrada." });
    return;
  }

  const mutante = metodo !== "GET" && metodo !== "HEAD";
  if (mutante && req.headers["x-requisicao"] !== "carta") {
    responderJson(res, 403, { erro: "Cabeçalho anti-CSRF ausente." });
    return;
  }

  const ip = extrairIp(req);
  let sessao = null;
  if (achado.rota.autenticada) {
    sessao = await validarSessao(lerCookie(req.headers.cookie));
    if (!sessao) throw erroNaoAutenticado();
  }

  const ctx: Contexto = {
    metodo, caminho, params: achado.params, query,
    corpo: mutante ? await lerCorpo(req) : undefined,
    ip, sessao,
  };

  const resposta = await achado.rota.tratador(ctx);
  for (const [k, v] of Object.entries(resposta.cabecalhos ?? {})) res.setHeader(k, v);
  responderJson(res, resposta.status ?? 200, resposta.corpo ?? { ok: true }, resposta.cabecalhos?.["Cache-Control"]);
}

function responderJson(res: ServerResponse, status: number, corpo: unknown, cache?: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache ?? "no-store");
  res.end(JSON.stringify(corpo));
}

function responderErro(res: ServerResponse, e: unknown, caminho: string): void {
  if (e instanceof ErroHttp) {
    responderJson(res, e.status, { erro: e.message, detalhes: e.detalhes });
    return;
  }
  log.erro("erro interno", { caminho, erro: e instanceof Error ? e.message : String(e), pilha: e instanceof Error ? e.stack : undefined });
  responderJson(res, 500, { erro: "Erro interno. O detalhe está no log do servidor." });
}
