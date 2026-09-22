/* ==========================================================================
   semear.ts — cria o usuário inicial com as preferências de partida.
   Idempotente por e-mail: se já existe, não toca em nada.
   ========================================================================== */
import { abrirBanco, novoId, type Q } from "./bd.ts";
import { migrar } from "./migrar.ts";
import { hashSenha, tokenAleatorio } from "../nucleo/cripto.ts";
import { agoraISO } from "../nucleo/datas.ts";
import { conferirConfig, config } from "../nucleo/config.ts";

const EMAIL_PADRAO = "luiz@lacarta.local";

export const PREFERENCIAS_PADRAO: Record<string, string> = {
  tamanho_fonte: "19",        // px do texto constitucional
  voz: "",                    // nome da voz do sistema; vazio = a melhor pt-BR disponível
  velocidade_voz: "1",
  desenhar_com_dedo: "0",     // 0 = só caneta/mouse desenham; dedo rola a página
  cor_caneta: "#1d2433",
  cor_marcador: "#fff59a",
  largura_caneta: "2.2",
  ferramenta: "caneta",
};

export async function semear(q?: Q, opcoes?: { email?: string; senha?: string; nome?: string }): Promise<{ email: string; senha: string | null; usuarioId: string }> {
  const banco = q ?? (await abrirBanco());
  const email = (opcoes?.email ?? process.env["CARTA_EMAIL_INICIAL"] ?? EMAIL_PADRAO).toLowerCase();

  const existente = await banco.get<{ id: string }>("SELECT id FROM usuarios WHERE email = ?", email);
  if (existente) return { email, senha: null, usuarioId: existente.id };

  const senha = opcoes?.senha ?? process.env["CARTA_SENHA_INICIAL"] ?? tokenAleatorio(9);
  const uid = novoId();
  await banco.transacao(async (t) => {
    await t.run(
      "INSERT INTO usuarios (id, email, nome, senha_hash, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)",
      uid, email, opcoes?.nome ?? "Luiz", hashSenha(senha), agoraISO(),
    );
    for (const [chave, valor] of Object.entries(PREFERENCIAS_PADRAO)) {
      await t.run("INSERT INTO preferencias (usuario_id, chave, valor) VALUES (?, ?, ?)", uid, chave, valor);
    }
  });
  return { email, senha, usuarioId: uid };
}

if (import.meta.filename === process.argv[1]) {
  conferirConfig();
  console.log(`\n  LA Carta — semente (${config.ambiente}, ${config.banco.tipo})\n`);
  (async () => {
    await migrar();
    const r = await semear();
    if (r.senha === null) {
      console.log(`  Usuário ${r.email} já existe — nada foi alterado.\n`);
    } else {
      console.log(`  Usuário criado: ${r.email}`);
      console.log(`  Senha inicial:  ${r.senha}`);
      console.log(`\n  Troque a senha no primeiro acesso (menu do usuário → Ajustes).\n`);
    }
    process.exit(0);
  })().catch((e) => {
    console.error("\n  ✖", (e as Error).message, "\n");
    process.exit(1);
  });
}
