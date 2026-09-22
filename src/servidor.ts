/* ==========================================================================
   servidor.ts — ponto de entrada. O boot confere antes de abrir a porta:
   configuração válida, conteúdo carregado, banco migrado. Processo que não
   sobe é melhor que processo que sobe torto.
   ========================================================================== */
import { config, conferirConfig } from "./nucleo/config.ts";
import { log } from "./nucleo/log.ts";
import { VERSAO } from "./nucleo/versao.ts";
import { abrirBanco, fecharBanco, banco } from "./dados/bd.ts";
import { migrar } from "./dados/migrar.ts";
import { carregarTexto } from "./dados/texto.ts";
import { montarApi } from "./api/index.ts";
import { ouvir } from "./http/servidor.ts";

async function principal(): Promise<void> {
  conferirConfig();
  console.log(`\n  LA Carta ${VERSAO} — ${config.ambiente} (${config.banco.tipo})\n`);

  const c = carregarTexto();
  log.info("conteúdo carregado", { paginas: c.paginas.length, atualizado_ate: c.atualizado_ate });

  await abrirBanco();
  const { aplicadas } = await migrar();
  if (aplicadas.length) log.info("migrações aplicadas", { arquivos: aplicadas });

  const usuarios = await banco().get<{ n: number }>("SELECT count(*) AS n FROM usuarios");
  if (Number(usuarios?.n ?? 0) === 0) console.log("  ⚠ Nenhum usuário cadastrado. Rode: npm run semear\n");

  const roteador = montarApi();
  log.info("rotas registradas", { total: roteador.listar().length });

  const servidor = ouvir(roteador);

  const encerrar = (sinal: string) => {
    log.info("encerrando", { sinal });
    servidor.close(() => { void fecharBanco().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => encerrar("SIGTERM"));
  process.on("SIGINT", () => encerrar("SIGINT"));
  process.on("unhandledRejection", (motivo) => {
    log.erro("promessa rejeitada sem tratamento", {
      erro: motivo instanceof Error ? motivo.message : String(motivo),
      pilha: motivo instanceof Error ? motivo.stack : undefined,
    });
  });
}

if (import.meta.filename === process.argv[1]) {
  principal().catch((e) => {
    console.error("\n  ✖ falha no boot:", (e as Error).message, "\n");
    process.exit(1);
  });
}
