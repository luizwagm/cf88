#!/usr/bin/env bash
# ==========================================================================
# LA CARTA — verificação de fora (de qualquer máquina com curl)
#
#   ./verificar.sh                         → cf88.projetos.luizaugust.me
#   ./verificar.sh <dominio>
#
# Pergunta primeiro se o site RESPONDE e para ali se não: verificador que
# segue com o site fora do ar inventa problemas.
# ==========================================================================
set -uo pipefail
D="${1:-cf88.projetos.luizaugust.me}"
U="https://$D"
F=0
ok()   { printf "  \033[1;32m✔\033[0m %s\n" "$1"; }
ruim() { printf "  \033[1;31m✖\033[0m %s\n" "$1"; F=$((F+1)); }
cod()  { curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$1"; }

echo; echo "Verificando $U"; echo
SAUDE=$(curl -s --max-time 10 "$U/api/v1/saude" || true)
if ! echo "$SAUDE" | grep -q '"ok":true'; then
  ruim "o site não respondeu /api/v1/saude — pare aqui: é queda, não é detalhe. (${SAUDE:-sem resposta})"
  exit 1
fi
ok "no ar: $SAUDE"

for P in / /estilo.css /js/app.js /js/leitor.js /js/tinta.js /js/voz.js /robots.txt; do
  C=$(cod "$U$P"); [ "$C" = "200" ] && ok "$P 200" || ruim "$P respondeu $C"
done
# O que NUNCA pode sair: por lugar, não por extensão.
for P in /package.json /src/servidor.ts /conteudo/cf88.json /dados/carta.db /.env /sql/001_esquema.sql /js/../package.json /operacao/lacarta.service; do
  C=$(cod "$U$P"); { [ "$C" = "404" ] || [ "$C" = "400" ]; } && ok "$P não é servido ($C)" || ruim "$P respondeu $C — VAZAMENTO"
done
# A API sem sessão fecha a porta (401), e sem o cabeçalho anti-CSRF recusa (403).
C=$(cod "$U/api/v1/resumo"); [ "$C" = "401" ] && ok "/api/v1/resumo sem sessão → 401" || ruim "/api/v1/resumo sem sessão respondeu $C"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST -H 'Content-Type: application/json' -d '{}' "$U/api/v1/entrar")
[ "$C" = "403" ] && ok "POST sem X-Requisicao → 403" || ruim "POST sem cabeçalho anti-CSRF respondeu $C"
C=$(cod "http://$D/"); [ "$C" = "301" ] && ok "http → https (301)" || ruim "http respondeu $C"

CAB=$(curl -s -I --max-time 10 "$U/")
echo "$CAB" | grep -qi 'content-security-policy' && ok "CSP presente" || ruim "sem CSP"
echo "$CAB" | grep -qi 'x-frame-options: DENY' && ok "X-Frame-Options DENY" || ruim "sem X-Frame-Options"
echo "$CAB" | grep -qi 'x-robots-tag: noindex' && ok "X-Robots-Tag noindex (caderno pessoal, fora do Google)" || ruim "sem X-Robots-Tag noindex"
echo "$CAB" | grep -qi 'strict-transport-security' && ok "HSTS presente" || ok "sem HSTS próprio (o domínio pai luizaugust.me já anuncia includeSubDomains)"
curl -s "$U/robots.txt" | grep -q "Disallow: /$" && ok "robots fecha tudo" || ruim "robots.txt não fecha o site"
curl -s "$U/" | grep -q 'name="robots" content="noindex' && ok "meta noindex na página" || ruim "sem meta noindex"

echo; [ "$F" -eq 0 ] && printf "\033[1;32mTudo certo.\033[0m\n" || printf "\033[1;31m%s problema(s).\033[0m\n" "$F"
exit "$F"
