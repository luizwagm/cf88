-- ===========================================================================
-- 001_esquema.sql — esquema do LA Carta.
--
-- SQL PORTÁVEL (SQLite e PostgreSQL): ids TEXT gerados na aplicação,
-- booleanos em INTEGER 0/1, datas em TEXT ISO, nada de SERIAL/AUTOINCREMENT.
--
-- O TEXTO da Constituição não mora no banco: vem do conteudo/cf88.json,
-- imutável. O banco guarda só o que é do estudante — traço de caneta,
-- marcação de trecho, nota e leitura — sempre com usuario_id, e TODA
-- consulta da API filtra por ele.
-- ===========================================================================

CREATE TABLE migracoes (
  arquivo     TEXT PRIMARY KEY,
  sha256      TEXT NOT NULL,
  aplicada_em TEXT NOT NULL
);

CREATE TABLE usuarios (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  nome       TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL
);

CREATE TABLE sessoes (
  id         TEXT PRIMARY KEY,          -- sha256 do token; o token em si nunca toca o banco
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  criado_em  TEXT NOT NULL,
  expira_em  TEXT NOT NULL
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

CREATE TABLE preferencias (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  chave      TEXT NOT NULL,
  valor      TEXT NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);

CREATE TABLE auditoria (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT,
  acao        TEXT NOT NULL,
  entidade    TEXT NOT NULL,
  entidade_id TEXT NOT NULL,
  detalhe     TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  criado_em   TEXT NOT NULL
);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id, criado_em);

-- ---------------------------------------------------------------------------
-- O caderno
-- ---------------------------------------------------------------------------

-- Traço de caneta ou marca-texto. Os pontos são RELATIVOS ao dispositivo
-- (caput, inciso, parágrafo…) sobre o qual o traço começou — e guardam a
-- largura/altura desse dispositivo na hora do traço. Quando a tela muda
-- (outro aparelho, outra fonte), o traço é reescalado para a caixa atual do
-- mesmo dispositivo: a anotação continua ao lado do trecho certo.
CREATE TABLE tracos (
  id             TEXT PRIMARY KEY,
  usuario_id     TEXT NOT NULL REFERENCES usuarios(id),
  pagina_id      TEXT NOT NULL,
  dispositivo_id TEXT NOT NULL,
  ferramenta     TEXT NOT NULL,           -- caneta | marcador
  cor            TEXT NOT NULL,           -- #rrggbb
  largura        REAL NOT NULL,           -- px na largura de referência
  pontos         TEXT NOT NULL,           -- JSON [x, y, pressão, x, y, pressão, …]
  largura_ref    REAL NOT NULL,
  altura_ref     REAL NOT NULL,
  criado_em      TEXT NOT NULL
);
CREATE INDEX idx_tracos_pagina ON tracos(usuario_id, pagina_id);

-- Marcação de TRECHO do texto (seleção): sobrevive a qualquer reflow porque
-- é um intervalo de caracteres dentro do dispositivo, não uma posição.
CREATE TABLE marcacoes (
  id             TEXT PRIMARY KEY,
  usuario_id     TEXT NOT NULL REFERENCES usuarios(id),
  pagina_id      TEXT NOT NULL,
  dispositivo_id TEXT NOT NULL,
  inicio         INTEGER NOT NULL,
  fim            INTEGER NOT NULL,
  estilo         TEXT NOT NULL DEFAULT 'marca',   -- marca | sublinhado | riscado
  cor            TEXT NOT NULL,
  trecho         TEXT NOT NULL,           -- o texto marcado, para a revisão e a voz
  criado_em      TEXT NOT NULL
);
CREATE INDEX idx_marcacoes_pagina ON marcacoes(usuario_id, pagina_id);

-- Nota escrita (teclado): presa a um dispositivo, aparece na margem e pode
-- ser lida em voz alta.
CREATE TABLE notas (
  id             TEXT PRIMARY KEY,
  usuario_id     TEXT NOT NULL REFERENCES usuarios(id),
  pagina_id      TEXT NOT NULL,
  dispositivo_id TEXT NOT NULL,
  texto          TEXT NOT NULL,
  cor            TEXT NOT NULL,
  criado_em      TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL
);
CREATE INDEX idx_notas_pagina ON notas(usuario_id, pagina_id);

-- Onde o estudante esteve: última visita e posição de rolagem por página.
CREATE TABLE leituras (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  pagina_id  TEXT NOT NULL,
  visitas    INTEGER NOT NULL DEFAULT 0,
  posicao    REAL NOT NULL DEFAULT 0,     -- fração da página (0..1)
  ultima_em  TEXT NOT NULL,
  PRIMARY KEY (usuario_id, pagina_id)
);
