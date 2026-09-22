/* ==========================================================================
   operacao.test.ts — o que só quebra no servidor, provado aqui:

     · o vhost que o criar-site.sh gera (modo de ensaio, sem root, sem nginx):
       chaves balanceadas, diretiva única repetida no mesmo bloco (include
       expandido), linha de shell vazada, noindex, freio no login, sem www e
       sem HSTS no subdomínio;
     · as unidades do systemd: sem MemoryDenyWriteExecute, pastas de escrita
       criadas no ExecStartPre=+ e no ReadWritePaths, Node de /opt/node24;
     · fim de linha LF nos .sh/.service/.timer;
     · deploy.sh sem --silent, workflow sem "sudo deploy.sh".
   ========================================================================== */
process.env["CARTA_AMBIENTE"] = "teste";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p: string) => readFileSync(resolve(RAIZ, p), "utf8");
/* No Windows, o bash do PATH pode ser o do WSL, que não enxerga este disco. */
const BASH = process.platform === "win32" && existsSync("C:/Program Files/Git/bin/bash.exe") ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const temBash = spawnSync(BASH, ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";

/* Diretivas que o nginx aceita UMA vez por bloco (as que usamos). */
const UNICAS = new Set(["proxy_read_timeout", "proxy_connect_timeout", "proxy_http_version", "client_max_body_size", "proxy_pass",
  "root", "alias", "expires", "try_files", "gzip", "gzip_comp_level", "gzip_min_length", "gzip_proxied", "gzip_vary", "server_name", "return", "limit_req"]);

interface Bloco { nome: string; diretivas: string[]; filhos: Bloco[] }

function gerar(dominio: string): { vhost: string; proxy: string } {
  const pasta = mkdtempSync(join(tmpdir(), "lacarta-vhost-")).replace(/\\/g, "/");
  const arq = `${pasta}/${dominio}.conf`;
  const r = spawnSync(BASH, ["criar-site.sh", dominio], { cwd: RAIZ, encoding: "utf8", env: { ...process.env, CARTA_VHOST_ENSAIO: arq } });
  assert.equal(r.status, 0, `ensaio falhou: ${r.stderr}${r.stdout}`);
  const saida = { vhost: readFileSync(arq, "utf8"), proxy: readFileSync(`${arq}.proxy.conf`, "utf8") };
  rmSync(pasta, { recursive: true, force: true });
  return saida;
}

function analisar(texto: string, proxy: string): { raiz: Bloco; equilibrio: number } {
  const limpo = (t: string) => t.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
  const tokens: string[] = [];
  let buf = "";
  for (const ch of limpo(texto)) {
    if (ch === "{" || ch === "}" || ch === ";") { tokens.push(buf.trim(), ch); buf = ""; } else buf += ch;
  }
  const raiz: Bloco = { nome: "(topo)", diretivas: [], filhos: [] };
  const pilha = [raiz];
  let equilibrio = 0;
  for (let i = 0; i < tokens.length; i += 2) {
    const frase = tokens[i]!, sinal = tokens[i + 1];
    const atual = pilha[pilha.length - 1]!;
    if (sinal === "{") { const b: Bloco = { nome: frase.replace(/\s+/g, " "), diretivas: [], filhos: [] }; atual.filhos.push(b); pilha.push(b); equilibrio++; }
    else if (sinal === "}") { pilha.pop(); equilibrio--; }
    else if (frase) {
      if (frase.startsWith("include") && /proxy_lacarta\.conf/.test(frase)) {
        for (const l of limpo(proxy).split(";").map((x) => x.trim()).filter(Boolean)) atual.diretivas.push(l.replace(/\s+/g, " "));
      } else atual.diretivas.push(frase.replace(/\s+/g, " "));
    }
  }
  return { raiz, equilibrio };
}
const blocos = (b: Bloco, lista: Bloco[] = []): Bloco[] => { lista.push(b); b.filhos.forEach((f) => blocos(f, lista)); return lista; };
const repetidas = (b: Bloco) => {
  const conta: Record<string, number> = {};
  for (const d of b.diretivas) { const n = d.split(" ")[0]!; if (UNICAS.has(n)) conta[n] = (conta[n] ?? 0) + 1; }
  return Object.entries(conta).filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
};

describe("vhost gerado pelo criar-site.sh (ensaio)", { skip: temBash ? false : "sem bash nesta máquina" }, () => {
  const dominio = "cf88.projetos.luizaugust.me";
  it("é nginx válido: chaves balanceadas, nenhuma diretiva única repetida, nada de shell vazado", () => {
    const { vhost, proxy } = gerar(dominio);
    const a = analisar(vhost, proxy);
    assert.equal(a.equilibrio, 0);
    const ruins = blocos(a.raiz).map((b) => [b.nome, repetidas(b)] as const).filter(([, r]) => r.length);
    assert.deepEqual(ruins, [], ruins.map(([n, r]) => `${n}: ${r.join(", ")}`).join(" | "));
    assert.doesNotMatch(vhost, /^\s*(verde|amarelo|vermelho|azul|echo|if \[|fi$|\[ensaio\])/m);
    assert.doesNotMatch(proxy, /timeout/);
    assert.match(vhost, /Confira com "nginx -T"/);
  });
  it("server certo: noindex no server, freio no login, proxy com X-Forwarded-For, sem www, sem HSTS, teto de 5m", () => {
    const { vhost, proxy } = gerar(dominio);
    const a = analisar(vhost, proxy);
    const principal = blocos(a.raiz).find((b) => b.nome === "server" && b.diretivas.includes(`server_name ${dominio}`));
    assert.ok(principal, "server principal");
    assert.ok(principal.diretivas.some((d) => /^add_header X-Robots-Tag "noindex, nofollow" always/.test(d)));
    assert.ok(principal.diretivas.includes("client_max_body_size 5m"));
    const login = principal.filhos.find((f) => f.nome === "location = /api/v1/entrar");
    assert.ok(login && login.diretivas.some((d) => /^limit_req zone=lacarta_login/.test(d)));
    const comProxy = principal.filhos.filter((f) => f.diretivas.some((d) => d.startsWith("proxy_pass")));
    assert.ok(comProxy.length >= 2);
    assert.ok(comProxy.every((f) => f.diretivas.some((d) => d.startsWith("proxy_set_header X-Forwarded-For"))));
    /* add_header dentro de location APAGA os do server: aqui não pode haver nenhum. */
    assert.ok(principal.filhos.every((f) => !f.diretivas.some((d) => d.startsWith("add_header"))));
    assert.doesNotMatch(vhost, /server_name[^;]*\bwww\./);
    assert.doesNotMatch(vhost, /Strict-Transport-Security/);
  });
  it("domínio raiz: www em bloco próprio de 301 e HSTS no server", () => {
    const { vhost } = gerar("lacarta.com.br");
    assert.equal((vhost.match(/server_name[^;]*\bwww\./g) || []).length, 1);
    assert.match(vhost, /return 301 https:\/\/lacarta\.com\.br\$request_uri/);
    assert.equal((vhost.match(/Strict-Transport-Security/g) || []).length, 1);
  });
});

describe("unidades do systemd", () => {
  const unit = ler("operacao/lacarta.service");
  const backup = ler("operacao/lacarta-backup.service");
  it("sem MemoryDenyWriteExecute (mata o V8 com 5/TRAP)", () => {
    for (const u of [unit, backup]) assert.doesNotMatch(u, /^\s*MemoryDenyWriteExecute\s*=\s*(true|yes|1)/im);
  });
  it("pastas de escrita nascem no ExecStartPre=+ e estão no ReadWritePaths", () => {
    for (const p of ["dados", "backups"]) {
      assert.match(unit, new RegExp(`^ExecStartPre=\\+/bin/mkdir -p .*LA-Carta/${p}`, "m"), p);
      assert.match(unit, new RegExp(`^ReadWritePaths=-/var/www/projetos/LA-Carta/${p}$`, "m"), p);
    }
    assert.match(unit, /^ExecStartPre=\+\/bin\/chown deploy:deploy /m);
  });
  it("roda como deploy, no Node 24 próprio, em produção, atrás de 1 proxy, na porta 5209", () => {
    assert.match(unit, /^User=deploy$/m);
    assert.match(unit, /^ExecStart=\/opt\/node24\/bin\/node src\/servidor\.ts$/m);
    assert.match(backup, /^ExecStart=\/opt\/node24\/bin\/node ferramentas\/copia\.ts$/m);
    assert.match(unit, /^Environment=CARTA_AMBIENTE=producao$/m);
    assert.match(unit, /^Environment=PROXIES_CONFIAVEIS=1$/m);
    assert.match(unit, /^Environment=PORTA=5209$/m);
    assert.match(unit, /^StartLimitIntervalSec=0$/m);
    assert.ok(unit.indexOf("StartLimitIntervalSec") < unit.indexOf("[Service]"), "StartLimitIntervalSec fica no [Unit]");
  });
  it("timer da cópia antes do LA Backup das 04:00", () => {
    assert.match(ler("operacao/lacarta-backup.timer"), /^OnCalendar=\*-\*-\* 03:30:00$/m);
  });
});

describe("scripts de operação", () => {
  it("nenhum .sh/.service/.timer com CRLF", () => {
    for (const f of ["criar-site.sh", "deploy.sh", "verificar.sh", "operacao/instalar-node24.sh", "operacao/lacarta.service", "operacao/lacarta-backup.service", "operacao/lacarta-backup.timer"]) {
      assert.doesNotMatch(ler(f), /\r/, f);
    }
  });
  it("deploy.sh recusa root, não silencia o npm, prova antes de reiniciar e confere a versão no ar", () => {
    /* Sem os comentários: eles citam justamente o que NÃO se faz (pkill, --silent). */
    const d = ler("deploy.sh").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.match(d, /id -u.*-eq 0/);
    assert.doesNotMatch(d, /--silent/);
    /* O reinício de verdade é o `sudo -n systemctl restart`; o `sudo -n -l` de cima só pergunta. */
    assert.ok(d.indexOf("node --test") < d.indexOf("sudo -n systemctl restart"), "as provas rodam antes do reinício");
    assert.match(d, /api\/v1\/saude/);
    assert.doesNotMatch(d, /pkill/);
  });
  it("criar-site.sh: nginx -t com retorno do vhost anterior, e sem crase no heredoc do vhost", () => {
    const c = ler("criar-site.sh");
    const heredoc = c.slice(c.indexOf('cat > "$ARQ" <<NGINX'), c.indexOf("\nNGINX\n"));
    assert.doesNotMatch(heredoc, /`/);
    assert.ok(c.indexOf("ln -sf") < c.indexOf("nginx -t"));
    assert.match(c, /rm -f "\/etc\/nginx\/sites-enabled\/\$DOMINIO"/);
  });
  it("o workflow de deploy não chama o script como root", () => {
    const w = ler(".github/workflows/deploy.yml");
    assert.doesNotMatch(w, /sudo +[^ \n]*deploy\.sh/);
    assert.match(w, /node-version: '24'/.test(ler(".github/workflows/testes.yml")) ? /deploy\.sh/ : /NUNCA/);
  });
});
