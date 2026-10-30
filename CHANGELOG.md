# Changelog

## 1.6.0 — 2026-10-30

**Celular e computador, e as leis se atualizam sozinhas.** O tablet com caneta fica como
era; o caderno passa a servir também a quem não tem caneta.

- **O aparelho se identifica** (`publico/js/aparelho.js`): ponteiro principal fino/grosso e
  o menor lado da tela decidem entre tablet, celular e computador; a primeira vez que uma
  caneta toca a tela, o aparelho vira tablet. O modo pode ser fixado em **Ajustes › Modo de
  uso**, e a ferramenta escolhida é lembrada por aparelho.
- **Celular**: tocar num trecho abre uma folha de baixo com as cores (marca o texto todo),
  **Marcar só uma parte** (toca-se a primeira e a última palavra), sublinhar, riscar, nota,
  ouvir e copiar, mais a lista das marcações já feitas ali, cada uma com remover. A seleção
  nativa também vira folha. A tinta continua disponível pelo botão **Desenhar** da barra
  (o estojo aparece na horizontal; "Pronto" volta à leitura).
- **Computador**: botão ⋯ ao passar o mouse em cada trecho (mesmo painel, flutuando ao
  lado); seleção com o mouse e atalhos **1–6** (cores), **S** sublinhar, **R** riscar,
  **N** nota, **O** ouvir, **Esc** fecha; **/** vai para a busca.
- No celular e no computador a seleção cresce até a **palavra inteira** (mouse e dedo
  erram a borda); a caneta continua exata.
- A referência do trecho leva o pai: **"Art. 121, § 2º-B, II"**, não "Art. 121, II", que
  confundia com o inciso do caput (folha de ações, revisão, notas e voz).
- **Atualização automática das leis** (`ferramentas/leis/atualizar.ts` +
  `operacao/lacarta-leis.timer`, 05:15): GET condicional no Planalto (ETag/Last-Modified,
  só baixa o que mudou), validação de cada lei (a que não fechar a conta fica na versão
  anterior), montagem numa pasta de ensaio e troca atômica em `dados/leis/`, com trava e
  histórico (quantos dispositivos mudaram de **texto** e quantos só ganharam **nota**).
  O servidor recarrega o texto sozinho em até 1 minuto, sem reiniciar e sem tocar o git.
  Confere também se a Constituição ganhou emenda depois da EC do PDF e avisa.
- Biblioteca com **Atualizações do Planalto** e avisos; tela da lei com "conferido no
  Planalto há…" e "Atualizada em…". O que estava baixado para uso offline é baixado de
  novo em segundo plano quando a lei muda (versão por obra).
- Marcação cuja lei mudou por baixo é **realocada** para o trecho igual mais próximo; se o
  trecho sumiu, aparece como "marcação órfã" com o texto antigo e um botão de remover.
- `ferramentas/usuario.ts`: criar, listar, trocar senha (derruba as sessões), desativar e
  reativar contas de quem vai testar.
- 79 provas: Planalto falso para a atualização, unidades novas, referência.

## 1.5.0 — 2026-10-04

**Vade Mecum.** O caderno deixa de ser só a Constituição: 83 leis federais entram ao lado
dela, com o texto compilado do Planalto baixado em 04/10/2026 (13.161 artigos, 2.422
páginas, 12,5 MB).

- **Extrator do Planalto** (`ferramentas/leis/`, Node puro, sem dependências): tokenizador
  tolerante ao HTML de lá (cp1252 e UTF-16, `</body>` no meio, sobrescrito "o" → º, texto
  riscado descartado), cabeçalhos em árvore (Parte › Livro › Título › Subtítulo › Capítulo ›
  Seção › Subseção), rubricas, penas, faixas de artigos revogados e **texto citado de outras
  leis** mantido dentro do artigo que altera. Cada lei só entra se fechar a conta do último
  artigo esperado. `npm run leis -- --atualizar` baixa tudo de novo.
- **Ids por caminho** (`cp-art-121-p2-i6`): uma alteração futura na lei não desloca os ids
  vizinhos, então as anotações sobrevivem às atualizações do texto. A Constituição mantém
  os ids que já tinha.
- **Biblioteca** por matéria com filtro, "Em estudo", tela de cada lei (identificação,
  ementa, data do texto, última alteração incorporada, sumário), leitor com rubrica do
  artigo, pena e notas de alteração (que se pode esconder em Ajustes).
- **Busca** no Vade Mecum inteiro, com contagem por lei e filtro; "121 cp", "cc 1.639",
  "art. 5º" (na lei aberta) vão direto ao artigo.
- **Offline por lei**: escolhe-se o que baixar (uma lei, uma matéria, tudo); cada obra vem
  numa resposta só. Resumo, revisão e busca locais entendem várias obras.
- API: `/texto/obras`, `/texto/sumario?obra=`, `/texto/obras/:id/completo`, busca e salto
  com `obra`. 17 provas novas (extrator contra HTML de teste + o conteúdo gerado).

## 1.4.1 — 2026-09-23

- `backups/` (cópia diária) entra no `.gitignore`: sem isso o `deploy.sh` via a pasta como
  arquivo não commitado no servidor e recusava a entrega.

## 1.4.0 — 2026-09-22

- O aplicativo **observa atualizações**: confere ao abrir, ao voltar ao primeiro plano, ao
  recuperar a rede e a cada 20 minutos (worker novo + versão anunciada em /api/v1/saude).
  Havendo uma, mostra pastilha pulsante no topo, item em destaque no menu e cartão em
  Ajustes › Aplicativo, até ser aplicada; a tinta pendente vai para a fila antes de recarregar.

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
