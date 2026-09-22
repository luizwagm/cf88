# Subir o LA Carta no servidor

Endereço: **cf88.projetos.luizaugust.me**. É um caderno pessoal: fica fora do
Google em qualquer endereço (robots fechado, meta noindex e `X-Robots-Tag`).

## 0. Antes: DNS e porta

1. **DNS**: crie o registro `A` (e `AAAA`, se houver IPv6) de
   `cf88.projetos.luizaugust.me` apontando para o servidor. O `criar-site.sh`
   confere com `dig` e para se não bater.
2. **Porta**: a local é a 5209, mas **porta livre aqui não é livre lá** — o
   servidor tem sites que não estão no `launch.json`.

```bash
sudo ss -ltnp | grep -oP ':\K52[0-9]{2}' | sort -u
```

Se a 5209 estiver ocupada, escolha outra, ajuste `Environment=PORTA=` em
`operacao/lacarta.service` e passe a porta como 2º argumento do `criar-site.sh`.

## 0b. O repositório (na sua máquina)

```bash
cd C:\Projects\SitesProjects\LA-Carta
git init -b main
git add -A && git commit -m "LA Carta 1.1.0"
git remote add origin git@github.com:luizwagm/la-carta.git   # PRIVADO
git push -u origin main
```

O `conteudo/cf88.json` (875 KB) vai no repositório de propósito: o servidor
não tem o PDF nem o PyMuPDF. O `.gitignore` deixa `dados/` e `.env` de fora.

## 1. O Node 24 próprio (uma vez por servidor)

O `/usr/bin/node` do servidor é a linha 22 dos outros sites, com módulos
nativos compilados para ela. O LA Carta exige 24 (TypeScript direto e
`node:sqlite`) e ganha um Node isolado em `/opt/node24`, sem tocar no global:

```bash
sudo /var/www/projetos/LA-Carta/operacao/instalar-node24.sh
```

Rodar de novo atualiza para a última 24.x (o link `/opt/node24` troca; a
anterior fica no disco).

## 2. O código (como `deploy`, nunca como root)

```bash
sudo -u deploy git clone git@github.com:luizwagm/la-carta.git /var/www/projetos/LA-Carta
cd /var/www/projetos/LA-Carta
sudo -u deploy cp .env.exemplo .env && sudo chmod 600 .env
```

O projeto não tem dependência de runtime — não precisa de `npm ci` na
instalação (o `deploy.sh` roda para manter o lock honesto). Se rodar algo
com `sudo` sem `-u deploy`, devolva a posse: `sudo chown -R deploy:deploy
/var/www/projetos/LA-Carta`.

## 3. O serviço e a cópia diária

```bash
sudo cp operacao/lacarta.service operacao/lacarta-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lacarta lacarta-backup.timer
```

A unidade cria `dados/` e `backups/` sozinha em `ExecStartPre=+` (fora do
sandbox), porque com `ProtectSystem=strict` o processo não consegue criá-las.
O `.env` precisa de `CARTA_SEGREDO_SESSAO` com 32+ caracteres em produção,
senão o boot recusa subir com código 78 — o `criar-site.sh` gera um se faltar,
mas se quiser subir antes dele:

```bash
sudo -u deploy sh -c 'echo "CARTA_SEGREDO_SESSAO=$(/opt/node24/bin/node -e "console.log(require(\"node:crypto\").randomBytes(32).toString(\"base64url\"))")" >> .env'
sudo systemctl restart lacarta
curl -s http://127.0.0.1:5209/api/v1/saude
```

## 3b. O reinício sem senha (uma vez por servidor)

```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart lacarta.service, /bin/systemctl restart lacarta.service' | sudo tee /etc/sudoers.d/lacarta
sudo chmod 440 /etc/sudoers.d/lacarta && sudo visudo -c
```

Sem isso, a entrega instala o código novo e para no último passo com o
serviço velho rodando.

## 4. O vhost e o certificado

```bash
sudo ./criar-site.sh                 # cf88.projetos.luizaugust.me, porta 5209
```

O script confere DNS, porta (com `ss`), Node 24, serviço e `.env` antes de
mexer no nginx. Se o `nginx -t` recusar o vhost novo, ele devolve o anterior
ou tira o link de `sites-enabled` — um arquivo ruim habilitado derrubaria o
próximo reload de qualquer site. Sob `*.projetos.luizaugust.me` o navegador
recusa `http://` (HSTS do domínio pai): o certificado sai no mesmo passo.

## 5. O seu usuário (a senha aparece UMA vez)

```bash
sudo -u deploy /opt/node24/bin/node /var/www/projetos/LA-Carta/src/dados/semear.ts
```

Cria `luiz@lacarta.local` com senha sorteada (ou a de `CARTA_SENHA_INICIAL`,
se estiver no ambiente). Troque em **Ajustes** no primeiro acesso. Para
outra conta, passe `CARTA_EMAIL_INICIAL=…` na frente do comando.

## 6. Conferir de fora

```bash
./verificar.sh
```

## 7. Entregas seguintes

Manual:

```bash
sudo -u deploy ./deploy.sh
```

Automática: `push` na `main` roda os testes no GitHub e, verde, entra no
servidor e roda o mesmo `deploy.sh`. Segredos em *Settings → Secrets and
variables → Actions*: `SSH_HOST`, `SSH_USER=deploy`, `SSH_KEY` (privada) e
`SSH_KNOWN_HOSTS`. Antes de prender a chave a um `command=`, prenda-a a um
`echo` e prove o acesso — chave com `command=` **roda o deploy** em qualquer
teste de conexão.

O `deploy.sh` puxa, instala, **prova** a suíte inteira (porta efêmera, banco
em memória, mais o vhost em ensaio e as unidades) e só então reinicia. Depois
confere se a versão no ar é a do código.

## No tablet

Abra `https://cf88.projetos.luizaugust.me` no Chrome ou no Samsung Internet e
adicione à tela inicial. A leitura em voz usa as vozes do Android: confira em
*Configurações › Gerenciamento geral › Texto para voz* se há uma voz em
português do Brasil instalada.
