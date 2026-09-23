/* ==========================================================================
   sw.js — o service worker do LA Carta.

   Guarda a CASCA do aplicativo (HTML, CSS, JS, manifesto, ícones) numa
   cache com o nome da versão. Sem internet, a casca abre do mesmo jeito; o
   texto e as anotações vêm do IndexedDB (armazem.js), não daqui — por isso
   /api/ passa direto pela rede e, falhando, quem responde é o armazém.

   O servidor serve este arquivo trocando __VERSAO__ pela versão real: versão
   nova = cache nova; a antiga é apagada no activate.
   ========================================================================== */
const VERSAO = "__VERSAO__";
const CACHE = `carta-casca-${VERSAO}`;
const CASCA = [
  "/", "/index.html", "/estilo.css", "/manifest.webmanifest", "/robots.txt",
  "/js/api.js", "/js/ui.js", "/js/voz.js", "/js/tinta.js", "/js/armazem.js", "/js/leitor.js", "/js/telas.js", "/js/app.js",
  "/icones/icone-192.png", "/icones/icone-512.png", "/icones/icone-mascara-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* cache: "reload" ignora a cache HTTP do navegador: a casca que entra aqui
       é a que o servidor tem AGORA. */
    await cache.addAll(CASCA.map((c) => new Request(c, { cache: "reload" })));
  })());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== CACHE) await caches.delete(nome);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (evento) => {
  if (evento.data === "pular-espera") self.skipWaiting();
  /* O app pergunta qual versão está NO CONTROLE: é a versão dele mesmo, não a
     do servidor (que pode já estar à frente). */
  if (evento.data === "versao?" && evento.ports[0]) evento.ports[0].postMessage(VERSAO);
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;   // rede pura

  /* Navegação (qualquer rota da SPA) → a casca da cache; rede só se faltar. */
  if (req.mode === "navigate" || !/\.[a-z0-9]+$/i.test(url.pathname)) {
    evento.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match("/index.html")) || fetch(req);
    })());
    return;
  }

  /* Estático: cache primeiro; o que não estiver lá vai à rede e entra. */
  evento.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    const resposta = await fetch(req);
    if (resposta.ok) cache.put(req, resposta.clone());
    return resposta;
  })());
});
