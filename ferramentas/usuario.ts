/* ==========================================================================
   usuario.ts — contas de quem vai testar o caderno.

     npm run usuario -- criar maria@exemplo.com "Maria Souza"
     npm run usuario -- senha maria@exemplo.com        (gera senha nova e derruba as sessões)
     npm run usuario -- desativar maria@exemplo.com
     npm run usuario -- ativar maria@exemplo.com
     npm run usuario -- listar

   No servidor, como o dono do banco e com o Node 24:
     sudo -u deploy /opt/node24/bin/node ferramentas/usuario.ts criar …

   A senha sorteada aparece UMA vez no terminal; quem recebe troca em Ajustes.
   ========================================================================== */
import { conferirConfig } from "../src/nucleo/config.ts";
import { abrirBanco, banco, fecharBanco } from "../src/dados/bd.ts";
import { migrar } from "../src/dados/migrar.ts";
import { semear } from "../src/dados/semear.ts";
import { hashSenha, tokenAleatorio } from "../src/nucleo/cripto.ts";

const [comando, email, ...resto] = process.argv.slice(2);
const uso = () => {
  console.log("\n  uso: npm run usuario -- criar <e-mail> \"<nome>\" | senha <e-mail> | desativar <e-mail> | ativar <e-mail> | listar\n");
  process.exit(2);
};
const senhaNova = () => tokenAleatorio(9).replace(/[-_]/g, "x");

async function principal(): Promise<void> {
  conferirConfig();
  await abrirBanco();
  await migrar();
  const e = (email ?? "").trim().toLowerCase();
  const existe = e ? await banco().get<{ id: string; ativo: number }>("SELECT id, ativo FROM usuarios WHERE email = ?", e) : undefined;

  switch (comando) {
    case "criar": {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) uso();
      if (existe) { console.log(`\n  ${e} já tem conta. Para nova senha: npm run usuario -- senha ${e}\n`); break; }
      const senha = senhaNova();
      await semear(banco(), { email: e, senha, nome: resto.join(" ").trim() || e.split("@")[0]! });
      console.log(`\n  Conta criada: ${e}\n  Senha inicial: ${senha}\n\n  Peça para trocar em Ajustes no primeiro acesso.\n`);
      break;
    }
    case "senha": {
      if (!existe) { console.log(`\n  ${e} não tem conta.\n`); process.exitCode = 1; break; }
      const senha = senhaNova();
      await banco().run("UPDATE usuarios SET senha_hash = ?, ativo = 1 WHERE id = ?", hashSenha(senha), existe.id);
      await banco().run("DELETE FROM sessoes WHERE usuario_id = ?", existe.id);
      console.log(`\n  Senha nova de ${e}: ${senha}\n  As sessões abertas foram encerradas.\n`);
      break;
    }
    case "desativar":
    case "ativar": {
      if (!existe) { console.log(`\n  ${e} não tem conta.\n`); process.exitCode = 1; break; }
      await banco().run("UPDATE usuarios SET ativo = ? WHERE id = ?", comando === "ativar" ? 1 : 0, existe.id);
      if (comando === "desativar") await banco().run("DELETE FROM sessoes WHERE usuario_id = ?", existe.id);
      console.log(`\n  ${e} ${comando === "ativar" ? "reativado" : "desativado (sessões encerradas; as anotações ficam guardadas)"}.\n`);
      break;
    }
    case "listar": {
      const linhas = await banco().all<{ email: string; nome: string; ativo: number; criado_em: string; notas: number; marcas: number }>(
        `SELECT u.email, u.nome, u.ativo, u.criado_em,
                (SELECT count(*) FROM notas n WHERE n.usuario_id = u.id) AS notas,
                (SELECT count(*) FROM marcacoes m WHERE m.usuario_id = u.id) AS marcas
           FROM usuarios u ORDER BY u.criado_em`);
      console.log("");
      for (const l of linhas) console.log(`  ${Number(l.ativo) ? "●" : "○"} ${l.email.padEnd(34)} ${l.nome.padEnd(24)} ${String(l.marcas).padStart(4)} marcações · ${String(l.notas).padStart(4)} notas · desde ${l.criado_em.slice(0, 10)}`);
      console.log(`\n  ${linhas.length} conta(s).\n`);
      break;
    }
    default: uso();
  }
  await fecharBanco();
}

principal().catch((err) => { console.error("\n  ✖", (err as Error).message, "\n"); process.exit(1); });
