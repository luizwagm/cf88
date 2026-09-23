# Changelog

## 1.3.0 — 2026-09-22

- Sumário (gaveta e tela cheia) mostra os artigos de cada página como pastilhas
  ("1º", "2º", "103-A"…); cada uma abre a página já no artigo. O sumário leve passou a
  trazer id e rótulo de cada artigo (o cliente aceita a forma antiga em cache).

## 1.2.0 — 2026-09-22

- **Aplicativo instalável (PWA)**: manifesto, ícones, service worker com a casca em cache
  por versão e aviso de "versão nova — atualizar". Menu do topo ganhou "Instalar no
  tablet" (usa o prompt do navegador; senão, instruções para Samsung Internet/Chrome).
- **Funciona sem internet**: armazém local (IndexedDB) com texto, anotações, preferências
  e resumo; "Baixar para usar sem internet" traz as 93 páginas e todas as anotações.
  Toda escrita muda o espelho local na hora e entra numa fila persistente que sobe
  quando a rede volta (ids nascem no cliente; o servidor ignora reenvio repetido).
  Estante, revisão e busca têm versão local; salto por artigo funciona pelo sumário.
- Chip de rede no topo ("Sem internet", "3 a enviar"); boot com a cópia local quando a
  rede falta.
- 6 provas novas (ids do cliente, reenvio, /sw.js, manifesto).

## 1.1.0 — 2026-09-22

- Operação para cf88.projetos.luizaugust.me: `criar-site.sh` (vhost com noindex, freio no
  login, retorno do vhost anterior se o nginx recusar, certificado), `deploy.sh` (prova antes
  de reiniciar, confere a versão no ar), `verificar.sh`, unidades do systemd (serviço + cópia
  diária 03:30 por `VACUUM INTO`), Node 24 isolado em /opt/node24, GitHub Actions
  (testes + deploy por push), `SUBIR.md`.
- `robots.txt` fechado e `X-Robots-Tag` no vhost: caderno pessoal, fora do índice.
- 8 provas novas de operação (vhost em ensaio, unidades, CRLF, deploy).

## 1.0.0 — 2026-09-22

Primeira versão.

- Extrator do PDF do Senado (CF88 até a EC 139/2026) para JSON estruturado: 93 páginas,
  277 artigos na CF + 143 no ADCT, 3.346 dispositivos, 28 notas do editor.
- Backend Node 24 + TypeScript, SQLite/Postgres, sessões, limitador de força bruta, CSP estrita.
- Leitor em folha com caneta, marca-texto, borracha, notas e marcação de trecho por seleção;
  tinta ancorada ao dispositivo, reescalada a qualquer largura.
- Leitura em voz (Web Speech) da página, do artigo, do trecho e das anotações.
- Estante, sumário em gaveta, busca, revisão de anotações e ajustes.
- 34 provas (conteúdo + API real com dois usuários).
