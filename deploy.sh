#!/usr/bin/env bash
# ==========================================================================
# LA CARTA — entrega de versão nova
#
#   sudo -u deploy ./deploy.sh
#
# Puxa o código, instala, PROVA (suíte inteira: porta efêmera e banco em
# memória) e SÓ ENTÃO reinicia. Se a prova falha, o site segue no ar com a
# versão anterior.
#
# O QUE ELE NÃO FAZ, DE PROPÓSITO:
#  · não roda como root — `sudo npm ci` faz o root virar dono de node_modules/
#    e a entrega SEGUINTE falha com "exit 243", sem dizer por quê;
#  · não toca no banco — a migração roda na subida do serviço, como deploy,
#    e nunca apaga uma anotação;
#  · não usa `pkill node` — todos os sites do servidor são "node …"; quem
#    para é o systemd, pela unidade;
#  · não usa `npm ci --silent` — ele cala o npm INCLUSIVE no erro.
# ==========================================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$RAIZ" || exit 1
UNIDADE="lacarta"
PORTA="${PORTA:-5209}"
# O Node deste projeto é o 24 de /opt/node24 (ver operacao/instalar-node24.sh);
# o /usr/bin/node do servidor é a linha 22 dos outros sites.
export PATH="/opt/node24/bin:$PATH"

verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
erro()    { printf "\033[1;31m%s\033[0m\n" "$1" >&2; }
azul()    { printf "\033[1;34m%s\033[0m\n" "$1"; }

echo; azul "LA Carta — deploy"; echo

if [ "$(id -u)" -eq 0 ]; then
  erro "Não rode o deploy como root. Rode:  sudo -u deploy ./deploy.sh"
  erro "Se já rodou com sudo, devolva a posse:  sudo chown -R deploy:deploy \"$RAIZ\""
  exit 1
fi
EU="$(id -un)"

if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 24 ]; then
  erro "     Node 24 não encontrado em /opt/node24. Rode: sudo $RAIZ/operacao/instalar-node24.sh"
  exit 1
fi
echo "     node $(node --version)"

# As pastas de escrita da unidade (ProtectSystem=strict) têm de existir antes.
mkdir -p "$RAIZ/dados" "$RAIZ/backups"

# O REINÍCIO PRECISA DE SUDO SEM SENHA — conferido ANTES de mexer em nada.
# Sem a regra, a entrega instala o código novo e para no último passo com o
# serviço VELHO rodando. `sudo -n -l` pergunta sem executar; como a resposta
# depende da configuração do sudo, aqui ele AVISA — quem decide é o passo 4.
if ! sudo -n -l systemctl restart "${UNIDADE}.service" >/dev/null 2>&1; then
  amarelo "  ! não confirmei o sudo sem senha para reiniciar o serviço. Se o passo 4 falhar:"
  amarelo "    echo '$EU ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${UNIDADE}.service, /bin/systemctl restart ${UNIDADE}.service' | sudo tee /etc/sudoers.d/${UNIDADE}"
  amarelo "    sudo chmod 440 /etc/sudoers.d/${UNIDADE} && sudo visudo -c"
fi

# ------------------------------------------------------------------ 1. código
azul "1/4  código"
ANTES="$(git rev-parse HEAD 2>/dev/null || echo '-')"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  QUANTOS=$(git status --porcelain | wc -l)
  erro "     há $QUANTOS arquivo(s) não commitados NO SERVIDOR:"
  git status --short | head -10 | sed 's/^/       /' >&2
  erro "     resolva antes (commit, stash ou descarte consciente)."
  exit 1
fi
git fetch --quiet origin || { erro "     git fetch falhou"; exit 1; }
git pull --ff-only --quiet || { erro "     git pull --ff-only falhou — o ramo local divergiu."; exit 1; }
DEPOIS="$(git rev-parse HEAD)"
if [ "$ANTES" = "$DEPOIS" ]; then echo "     nada novo ($(git rev-parse --short HEAD))"
else echo "     $(git rev-parse --short "$ANTES") → $(git rev-parse --short "$DEPOIS")"; git log --oneline "$ANTES..$DEPOIS" | sed 's/^/       /'; fi
[ -s "$RAIZ/conteudo/cf88.json" ] || { erro "     conteudo/cf88.json não veio no clone — rode o extrator (npm run extrair) e commite"; exit 1; }

# ------------------------------------------------------------ 2. dependências
azul "2/4  dependências"
for PASTA in "$RAIZ/node_modules" "$HOME/.npm"; do
  [ -e "$PASTA" ] || continue
  DONO=$(stat -c '%U' "$PASTA" 2>/dev/null || echo "?")
  if [ "$DONO" != "$EU" ] && [ "$DONO" != "?" ]; then
    erro "     $PASTA pertence a '$DONO' (você é '$EU'); o 'npm ci' não vai conseguir apagá-la."
    erro "       sudo chown -R $EU:$EU \"$PASTA\""
    exit 1
  fi
done
# Sem dependência de runtime (pg é opcional e não entra); o npm ci mantém o
# node_modules/ alinhado ao lock e falha se o lock divergir do package.json.
if ! npm ci --omit=dev --omit=optional --no-audit --no-fund > /tmp/lacarta-npm.log 2>&1; then
  erro "     O 'npm ci' falhou:"; tail -25 /tmp/lacarta-npm.log | sed 's/^/       /' >&2
  exit 1
fi
echo "     ok"

# ---------------------------------------------------------------- 3. provas
# A suíte sobe o sistema numa porta EFÊMERA (PORTA=0) com banco em memória:
# nunca conversa com o processo que está no ar, e não precisa de porta livre.
# As devDependencies (typescript) não entram no servidor: as provas rodam com
# o node --test puro, e a conferência de tipos fica no CI.
azul "3/4  provando antes de subir"
if ! node --test --test-concurrency=1 testes/texto.test.ts testes/api.test.ts testes/operacao.test.ts > /tmp/lacarta-provas.log 2>&1; then
  erro "     As provas FALHARAM. O serviço NÃO foi reiniciado; o site segue na versão anterior."
  grep -E '✖|not ok|Error' /tmp/lacarta-provas.log | head -20 | sed 's/^/       /' >&2
  exit 1
fi
grep -E '^ℹ (tests|pass|fail)' /tmp/lacarta-provas.log | tr '\n' ' ' | sed 's/^/     /'; echo

# --------------------------------------------------------------- 4. serviço
azul "4/4  reiniciando o serviço"
# `-n`: sem regra no sudoers, falha NA HORA com a instrução, em vez de ficar
# parado pedindo uma senha que ninguém vai digitar (no GitHub Actions, trava).
if ! sudo -n systemctl restart "${UNIDADE}.service"; then
  erro "  ✖ o código novo está instalado, mas o serviço NÃO reiniciou (sudo pediu senha)."
  erro "    Crie a regra uma vez:"
  erro "      echo '$EU ALL=(root) NOPASSWD: /usr/bin/systemctl restart ${UNIDADE}.service, /bin/systemctl restart ${UNIDADE}.service' | sudo tee /etc/sudoers.d/${UNIDADE}"
  erro "      sudo chmod 440 /etc/sudoers.d/${UNIDADE} && sudo visudo -c"
  erro "    e reinicie à mão agora:  sudo systemctl restart ${UNIDADE}"
  exit 1
fi
NOAR=0
for _ in $(seq 1 25); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORTA}/api/v1/saude" > /tmp/lacarta-saude.json 2>/dev/null; then NOAR=1; break; fi
  sleep 1
done
if [ "$NOAR" -ne 1 ]; then
  erro "  ✖ o serviço não respondeu em 25 s — journalctl -u ${UNIDADE} -n 40 --no-pager"
  exit 1
fi
VERSAO_NO_AR=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/lacarta-saude.json","utf8")).versao)')
VERSAO_CODIGO=$(node -p 'require("./package.json").version')
[ "$VERSAO_NO_AR" = "$VERSAO_CODIGO" ] || { erro "  ✖ no ar está a $VERSAO_NO_AR, o código é $VERSAO_CODIGO — o serviço não reiniciou?"; exit 1; }
verde "  ✔ no ar — versão $VERSAO_NO_AR"
echo
