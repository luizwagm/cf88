#!/usr/bin/env bash
# ==========================================================================
# LA CARTA — criar o site no servidor (padrão do parque, ver Corte Sam)
#
#   sudo ./criar-site.sh                          → cf88.projetos.luizaugust.me
#   sudo ./criar-site.sh <dominio> <porta> [email]
#
# Cria o vhost do nginx, emite o certificado e testa a renovação. Roda UMA vez
# por domínio; depois é o deploy.sh que entrega versão nova.
#
# Sob *.projetos.luizaugust.me o navegador recusa http:// (HSTS do domínio
# pai): o certificado é PRÉ-REQUISITO para abrir a página a primeira vez. E não
# existe www num subdomínio — pedir certificado para ele derruba o pedido todo.
#
# O LA Carta é um caderno PESSOAL: fica fora do índice em qualquer endereço
# (robots fechado, meta noindex e X-Robots-Tag no vhost).
#
# MODO DE ENSAIO (sem root, sem nginx, sem DNS): gera só o vhost.
#   CARTA_VHOST_ENSAIO=/tmp/v.conf ./criar-site.sh cf88.projetos.luizaugust.me
# ==========================================================================
set -uo pipefail

DOMINIO="${1:-cf88.projetos.luizaugust.me}"
PORTA="${2:-5209}"
EMAIL="${3:-luizwagm@gmail.com}"
RAIZ="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SERVICO="lacarta"
NODE24="/opt/node24/bin/node"
ENSAIO="${CARTA_VHOST_ENSAIO:-}"

verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }
azul()    { printf "\033[1;34m%s\033[0m\n" "$1"; }

[ -n "$ENSAIO" ] || [ "$(id -u)" -eq 0 ] || { vermelho "Rode com sudo."; exit 1; }

PONTOS=$(echo "$DOMINIO" | tr -cd '.' | wc -c)
SUBDOMINIO=0
[ "$PONTOS" -ge 3 ] && SUBDOMINIO=1

echo
azul "LA Carta — instalação de $DOMINIO na porta $PORTA"
echo

if [ -n "$ENSAIO" ]; then
  echo "     [ensaio] pulando DNS, porta, Node e serviço"
  DOMINIOS="-d $DOMINIO"
  [ "$SUBDOMINIO" -eq 0 ] && DOMINIOS="$DOMINIOS -d www.$DOMINIO"
fi

if [ -z "$ENSAIO" ]; then
# ====================================================================== 1/7 DNS
echo "1/7  Conferindo o DNS"
MEUS_IPS=$(
  { ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}';
    ip -6 addr show scope global 2>/dev/null | grep -oP '(?<=inet6\s)[0-9a-f:]+';
    curl -s --max-time 5 https://api.ipify.org 2>/dev/null;
    curl -s --max-time 5 https://api64.ipify.org 2>/dev/null; } | sort -u
)
resolve() { dig +short "$1" "$2" 2>/dev/null | grep -v '\.$' | head -1; }
daqui()   { [ -n "$1" ] && echo "$MEUS_IPS" | grep -qxF "$1"; }
A=$(resolve "$DOMINIO" A); AAAA=$(resolve "$DOMINIO" AAAA)
if daqui "$A" || daqui "$AAAA"; then
  verde "     $DOMINIO -> ${A:-$AAAA}  (é este servidor)"
else
  vermelho "     $DOMINIO -> ${A:-${AAAA:-nada}} — não aponta para este servidor. O certbot vai falhar."
  exit 1
fi
DOMINIOS="-d $DOMINIO"
if [ "$SUBDOMINIO" -eq 0 ]; then
  WA=$(resolve "www.$DOMINIO" A); WAAAA=$(resolve "www.$DOMINIO" AAAA)
  if daqui "$WA" || daqui "$WAAAA"; then DOMINIOS="$DOMINIOS -d www.$DOMINIO"; verde "     www.$DOMINIO entra no certificado"
  else amarelo "     www.$DOMINIO não resolve para cá — fica de fora do certificado"; fi
fi

# ==================================================================== 2/7 porta
# Porta livre na máquina de quem desenvolve NÃO é livre aqui (o Riacho Solar
# ocupa a 5196 e nunca esteve no launch.json). Repasse para porta de vizinho
# devolve o site DELE com 200 e sem erro nenhum.
echo "2/7  Conferindo a porta $PORTA"
DONO=$(ss -ltnp 2>/dev/null | grep -E "127\.0\.0\.1:$PORTA |:::$PORTA |0\.0\.0\.0:$PORTA " || true)
if [ -n "$DONO" ]; then
  if echo "$DONO" | grep -q "$RAIZ" || systemctl is-active --quiet "$SERVICO.service" 2>/dev/null; then
    verde "     porta $PORTA já é do $SERVICO.service — reinstalação"
  else
    vermelho "     a porta $PORTA está ocupada por OUTRO processo:"; echo "$DONO" | sed 's/^/       /'
    echo "     Escolha outra (e ajuste PORTA na unidade):  ss -ltnp | grep -oP ':\\K52[0-9]{2}' | sort -u"
    exit 1
  fi
else
  verde "     porta $PORTA livre"
fi

# ============================================================== 3/7 Node e serviço
echo "3/7  Conferindo o Node 24 e o serviço"
# O Node do sistema é a linha 22 dos outros sites; este projeto exige 24
# (TypeScript direto, node:sqlite) e tem o seu em /opt/node24.
if [ ! -x "$NODE24" ] || [ "$("$NODE24" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 24 ]; then
  vermelho "     $NODE24 não existe ou é anterior ao 24. Instale primeiro (não mexe no /usr/bin/node):"
  echo "       sudo $RAIZ/operacao/instalar-node24.sh"
  exit 1
fi
verde "     Node $("$NODE24" --version) em /opt/node24"
ESTADO=$(systemctl show -p LoadState --value "$SERVICO.service" 2>/dev/null || echo "erro")
if [ "$ESTADO" != "loaded" ]; then
  amarelo "     $SERVICO.service ainda não existe (LoadState=$ESTADO). Instale antes:"
  echo "       sudo cp $RAIZ/operacao/$SERVICO.service $RAIZ/operacao/$SERVICO-backup.* /etc/systemd/system/"
  echo "       sudo systemctl daemon-reload && sudo systemctl enable --now $SERVICO $SERVICO-backup.timer"
  exit 1
fi
# As pastas de escrita: o serviço NÃO consegue criá-las (ProtectSystem=strict).
for P in dados backups; do
  if [ ! -d "$RAIZ/$P" ]; then mkdir -p "$RAIZ/$P"; chown deploy:deploy "$RAIZ/$P"; amarelo "     criei $P/ (dona: deploy)"; fi
done

# ===================================================================== 4/7 .env
# Produção exige CARTA_SEGREDO_SESSAO forte: sem ele o boot recusa subir (78).
echo "4/7  Conferindo o .env"
ENV="$RAIZ/.env"
touch "$ENV"; chmod 600 "$ENV"
SEGREDO=$(grep -m1 '^CARTA_SEGREDO_SESSAO=' "$ENV" | cut -d= -f2-)
if [ "${#SEGREDO}" -lt 32 ] || [ "$SEGREDO" = "troque-este-segredo" ]; then
  NOVO=$("$NODE24" -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')
  if grep -q '^CARTA_SEGREDO_SESSAO=' "$ENV"; then sed -i "s|^CARTA_SEGREDO_SESSAO=.*|CARTA_SEGREDO_SESSAO=$NOVO|" "$ENV"
  else echo "CARTA_SEGREDO_SESSAO=$NOVO" >> "$ENV"; fi
  amarelo "     gerei um CARTA_SEGREDO_SESSAO novo no .env"
else
  verde "     CARTA_SEGREDO_SESSAO presente"
fi
chown deploy:deploy "$ENV" 2>/dev/null || true
systemctl is-active --quiet "$SERVICO.service" || { systemctl restart "$SERVICO.service" 2>/dev/null || true; sleep 2; }
SAUDE=$(curl -s --max-time 5 "http://127.0.0.1:$PORTA/api/v1/saude" || echo "")
if echo "$SAUDE" | grep -q '"ok":true'; then
  verde "     $SERVICO responde em 127.0.0.1:$PORTA — $SAUDE"
else
  vermelho "     127.0.0.1:$PORTA não respondeu /api/v1/saude. journalctl -u $SERVICO -n 40 --no-pager"
  exit 1
fi
USUARIOS=$(sudo -u deploy "$NODE24" -e 'const {DatabaseSync}=require("node:sqlite");try{const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("SELECT count(*) n FROM usuarios").get().n)}catch{console.log(0)}' "$RAIZ/dados/carta.db" 2>/dev/null || echo 0)
if [ "${USUARIOS:-0}" -eq 0 ]; then
  amarelo "     nenhum usuário no caderno ainda. Depois do vhost, crie o seu (a senha sai UMA vez no terminal):"
  echo "       sudo -u deploy $NODE24 $RAIZ/src/dados/semear.ts"
fi
fi   # fim do trecho que o ensaio pula

# ==================================================================== 5/7 vhost
echo "5/7  Criando o vhost"
HSTS_SERVER=""
if [ "$SUBDOMINIO" -eq 0 ]; then
  # SEM preload: a lista de precarga é praticamente irreversível — decisão do dono.
  HSTS_SERVER='    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
fi

if [ -z "$ENSAIO" ]; then
  # Zona do limitador: contexto http, nome GLOBAL. Dentro do vhost, um segundo
  # domínio do mesmo site derrubaria o nginx inteiro ("already bound").
  cat > /etc/nginx/conf.d/lacarta-limites.conf <<'LIMITES'
# Gerado por criar-site.sh — LA Carta (vale para TODOS os vhosts do site)
limit_req_zone $binary_remote_addr zone=lacarta_login:10m rate=20r/m;
LIMITES
  verde "     zona do limitador em /etc/nginx/conf.d/lacarta-limites.conf"
fi

ARQ="/etc/nginx/sites-available/$DOMINIO"
[ -n "$ENSAIO" ] && ARQ="$ENSAIO"
BAK=""
[ -f "$ARQ" ] && { BAK="$ARQ.bak-$(date +%F-%H%M%S)"; cp "$ARQ" "$BAK"; amarelo "     já existia — guardei uma cópia em $(basename "$BAK")"; }

BLOCO_WWW=""
if [ "$SUBDOMINIO" -eq 0 ] && echo "$DOMINIOS" | grep -q " -d www.$DOMINIO"; then
  BLOCO_WWW=$(cat <<WWW
server {
    listen 80;
    listen [::]:80;
    server_name www.$DOMINIO;
    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$DOMINIO\$request_uri; }
}
WWW
)
fi

# Sem crase nos comentários abaixo, de propósito: num heredoc sem aspas ela
# EXECUTA na geração (Corte Sam 0.1.1).
cat > "$ARQ" <<NGINX
# Gerado por criar-site.sh — LA Carta
# Confira com "nginx -T" (o -t aprova bloco que o nginx nem carregou).
$BLOCO_WWW
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;

    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }

    access_log /var/log/nginx/$DOMINIO.access.log;
    error_log  /var/log/nginx/$DOMINIO.error.log;

    # Um lote de traços de caneta de uma página cheia passa de 1 MB com folga;
    # o servidor Node corta em 4 MB.
    client_max_body_size 5m;

    # Tempos limite AQUI, no server, nunca no arquivo comum de proxy: o nginx
    # recusa a MESMA diretiva duas vezes no MESMO bloco (Picanha 0.1.1).
    proxy_connect_timeout 10s;
    proxy_read_timeout    60s;
$HSTS_SERVER
    # Caderno pessoal: fora do índice em qualquer endereço. Cabeçalho no
    # server e NENHUM add_header em location (senão este some de lá).
    add_header X-Robots-Tag "noindex, nofollow" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 512;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_types text/plain text/css text/javascript application/javascript application/json
               image/svg+xml application/manifest+json;

    # Freio de borda do login: o abuso nem acorda o processo (o Node ainda
    # tem o limitador por conta e por IP).
    location = /api/v1/entrar {
        limit_req zone=lacarta_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:$PORTA;
        include /etc/nginx/proxy_lacarta.conf;
    }

    # Todo o resto (HTML, JS, CSS e a API) passa pelo Node: é ele que autoriza
    # os estáticos POR LUGAR (só publico/) e manda o Cache-Control certo.
    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        include /etc/nginx/proxy_lacarta.conf;
    }
}
NGINX

# O arquivo comum de proxy: SÓ cabeçalhos e versão do HTTP — nada que algum
# location precise redefinir. O X-Forwarded-For ACRESCENTA o IP real no FIM; a
# aplicação lê o último item (PROXIES_CONFIAVEIS=1). No ensaio ele sai ao lado
# do vhost, para a prova poder expandir o include e procurar diretiva repetida.
PROXY_ARQ="/etc/nginx/proxy_lacarta.conf"
[ -n "$ENSAIO" ] && PROXY_ARQ="$ENSAIO.proxy.conf"
cat > "$PROXY_ARQ" <<'PROXY'
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
PROXY

if [ -n "$ENSAIO" ]; then verde "[ensaio] vhost escrito em $ARQ (proxy em $PROXY_ARQ)"; exit 0; fi

ln -sf "$ARQ" "/etc/nginx/sites-enabled/$DOMINIO"
if ! nginx -t 2>&1 | sed 's/^/     /'; then
  # NÃO DEIXAR O VHOST QUEBRADO HABILITADO: o PRÓXIMO reload de qualquer site
  # do servidor (inclusive a renovação do certbot) falharia por causa dele.
  if [ -n "$BAK" ]; then
    cp "$BAK" "$ARQ"
    vermelho "     configuração inválida — voltei o vhost anterior ($(basename "$BAK"))"
  else
    rm -f "/etc/nginx/sites-enabled/$DOMINIO"
    vermelho "     configuração inválida — tirei o link de sites-enabled"
  fi
  if nginx -t >/dev/null 2>&1; then verde "     o nginx voltou a validar: o servidor ficou como estava"
  else vermelho "     ATENÇÃO: o nginx continua sem validar — rode 'sudo nginx -t' e veja qual arquivo"; fi
  exit 1
fi
systemctl reload nginx
verde "     vhost ativo em HTTP"

# ============================================================== 6/7 certificado
echo "6/7  Emitindo o certificado"
# shellcheck disable=SC2086
if certbot --nginx $DOMINIOS --redirect --agree-tos --no-eff-email -m "$EMAIL" --non-interactive; then
  verde "     certificado emitido e HTTPS ativo"
else
  vermelho "     o certbot falhou — /var/log/letsencrypt/letsencrypt.log"; exit 1
fi

# ================================================================ 7/7 conferir
echo "7/7  Conferindo de fora"
HTTPS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMINIO/" || echo 000)
SAUDE=$(curl -s --max-time 5 "https://$DOMINIO/api/v1/saude" || echo "")
ROBOTS=$(curl -s -o /dev/null -w "%{http_code}" -I "https://$DOMINIO/" | cat; curl -s -I "https://$DOMINIO/" | grep -i 'x-robots-tag' | head -1)
echo "     https://$DOMINIO -> $HTTPS"
echo "     $SAUDE"
echo "     $ROBOTS"
certbot renew --dry-run >/dev/null 2>&1 && verde "     renovação automática testada" || amarelo "     rode 'certbot renew --dry-run'"
[ "$HTTPS" = "200" ] && verde "Pronto: https://$DOMINIO" || vermelho "Algo não respondeu 200. Rode ./verificar.sh $DOMINIO"
