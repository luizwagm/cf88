# LA Carta

A Constituição da República Federativa do Brasil (texto compilado até a EC 139/2026,
edição administrativa do Senado Federal) como um **caderno de estudo** para tablet com
caneta — Galaxy Tab S10 + S Pen em primeiro lugar, mas qualquer navegador moderno serve.

- Login pessoal; tudo o que se anota é do usuário e só dele.
- Texto em **páginas** (título, capítulo, seção ou subseção; o ADCT em blocos de 10 artigos),
  com sumário em árvore, busca sem acento e salto direto ("art. 37", "adct 2", "103-A").
- **Caneta e marca-texto** desenhados sobre a folha (pressão da S Pen, botão lateral =
  borracha), 6 cores tradicionais + 6 tons pastel, 3 espessuras, desfazer, borracha de traço.
  O dedo rola a página; a caneta escreve (ou ligue "desenhar com o dedo").
- **Marcação de trecho** por seleção (marca, sublinhado, riscado) e **notas** escritas
  presas ao dispositivo, como post-its na margem.
- **Leitura em voz** com a voz do próprio aparelho: a página inteira, um artigo, o trecho
  selecionado ou as suas anotações — a frase lida acende na tela.
- **Estante** com "continuar de onde parei", páginas anotadas e **revisão** de todas as
  marcações e notas na ordem do livro.

## Como a tinta fica no lugar certo

Cada traço é guardado em coordenadas relativas ao **dispositivo** (caput, inciso, parágrafo…)
sobre o qual começou, junto com a largura e a altura desse dispositivo naquele momento. Ao
redesenhar — noutro aparelho, outra fonte, outra largura — o traço é reescalado para a caixa
atual do mesmo dispositivo. O texto reflui, a anotação continua ao lado do trecho certo.
As marcações de trecho são intervalos de caracteres, imunes a reflow por natureza.

## Rodar

```bash
cp .env.exemplo .env          # ajuste CARTA_SEGREDO_SESSAO
npm run semear                # cria o usuário inicial e imprime a senha
npm start                     # http://127.0.0.1:5209
npm test                      # 34 provas: conteúdo + API real
```

Requer Node ≥ 24 (TypeScript roda direto, sem build). Banco SQLite embutido por padrão
(`dados/carta.db`); PostgreSQL com `CARTA_BANCO=postgres` + `DATABASE_URL`.

## Atualizar o texto constitucional

```bash
pip install pymupdf
npm run extrair -- "C:\caminho\CF88_EC139_livro.pdf"   # gera conteudo/cf88.json
```

O extrator (`ferramentas/extrair-cf88.py`) lê o PDF por fontes (negrito = artigo/cabeçalho,
sobrescrito = º, 9pt = nota do editor) e imprime avisos de sequência quebrada. Os ids das
páginas e dos dispositivos são estáveis entre execuções — as anotações apontam para eles.

## Estrutura

```
src/nucleo      config, cripto (scrypt), erros, log, datas, versão
src/dados       bd (SQLite/Postgres), migrar, semear, texto (a Constituição em memória)
src/http        servidor (estáticos + /api, CSP estrita), roteador, sessão, limitador
src/api         autenticação, texto, anotações (traços/marcações/notas/leitura), estudo (resumo/revisão/preferências)
publico         SPA vanilla: app, leitor, tinta (canvas), voz (Web Speech), telas, ui
conteudo        cf88.json (gerado)
sql             migrações
testes          texto.test.ts, api.test.ts
```
