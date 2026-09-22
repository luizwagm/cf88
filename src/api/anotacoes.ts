/* ==========================================================================
   api/anotacoes.ts — o caderno: traços de caneta, marcações de trecho,
   notas e leitura de cada página. Toda linha pertence a um usuário e toda
   consulta filtra por ele — a autorização é por linha, no backend, sempre.

   A página e o dispositivo são conferidos contra o TEXTO carregado: não
   existe anotação pendurada em id inventado.
   ========================================================================== */
import type { Roteador, Contexto } from "../http/roteador.ts";
import { corpoObjeto, texto as campoTexto, opcaoDe, inteiro, numero } from "../http/roteador.ts";
import { banco, novoId } from "../dados/bd.ts";
import { agoraISO } from "../nucleo/datas.ts";
import { erroNaoEncontrado, erroValidacao } from "../nucleo/erros.ts";
import { pagina as acharPagina, dispositivo as acharDispositivo } from "../dados/texto.ts";

const FERRAMENTAS = ["caneta", "marcador"] as const;
const ESTILOS = ["marca", "sublinhado", "riscado"] as const;
const MAX_PONTOS = 4000 * 3;   // um traço muito longo ainda cabe
const MAX_TRACOS_LOTE = 400;

function cor(o: Record<string, unknown>, campo = "cor"): string {
  const v = campoTexto(o, campo, { obrigatorio: true, max: 9 });
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw erroValidacao(`Campo ${campo} deve ser uma cor #rrggbb.`, { campo });
  return v.toLowerCase();
}

function paginaDe(ctx: Contexto) {
  const p = acharPagina(ctx.params["id"]!);
  if (!p) throw erroNaoEncontrado("Página");
  return p;
}

function dispositivoDaPagina(paginaId: string, o: Record<string, unknown>) {
  const id = campoTexto(o, "dispositivo_id", { obrigatorio: true, max: 80 });
  const d = acharDispositivo(id);
  if (!d || d.pagina.id !== paginaId) throw erroValidacao("Dispositivo não pertence a esta página.", { campo: "dispositivo_id" });
  return d;
}

function pontos(o: Record<string, unknown>): number[] {
  const v = o["pontos"];
  if (!Array.isArray(v) || v.length < 3 || v.length % 3 !== 0) throw erroValidacao("Campo pontos deve ser uma lista [x, y, pressão, …].", { campo: "pontos" });
  if (v.length > MAX_PONTOS) throw erroValidacao("Traço longo demais.", { campo: "pontos" });
  const saida = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    const n = Number(v[i]);
    if (!Number.isFinite(n)) throw erroValidacao("Ponto inválido no traço.", { campo: "pontos" });
    saida[i] = Math.round(n * 100) / 100;
  }
  return saida;
}

interface LinhaTraco { id: string; dispositivo_id: string; ferramenta: string; cor: string; largura: number; pontos: string; largura_ref: number; altura_ref: number; criado_em: string }

function abrirTraco(l: LinhaTraco) {
  return { ...l, pontos: JSON.parse(l.pontos) as number[] };
}

export function registrarAnotacoes(r: Roteador): void {
  /* ---------- tudo da página ---------- */
  r.get("/api/v1/paginas/:id/anotacoes", async (ctx) => {
    const p = paginaDe(ctx);
    const uid = ctx.sessao!.usuarioId;
    const [tracos, marcacoes, notas, leitura] = await Promise.all([
      banco().all<LinhaTraco>("SELECT id, dispositivo_id, ferramenta, cor, largura, pontos, largura_ref, altura_ref, criado_em FROM tracos WHERE usuario_id = ? AND pagina_id = ? ORDER BY criado_em", uid, p.id),
      banco().all("SELECT id, dispositivo_id, inicio, fim, estilo, cor, trecho, criado_em FROM marcacoes WHERE usuario_id = ? AND pagina_id = ? ORDER BY criado_em", uid, p.id),
      banco().all("SELECT id, dispositivo_id, texto, cor, criado_em, atualizado_em FROM notas WHERE usuario_id = ? AND pagina_id = ? ORDER BY criado_em", uid, p.id),
      banco().get("SELECT visitas, posicao, ultima_em FROM leituras WHERE usuario_id = ? AND pagina_id = ?", uid, p.id),
    ]);
    return { corpo: { pagina_id: p.id, tracos: tracos.map(abrirTraco), marcacoes, notas, leitura: leitura ?? null } };
  });

  /* ---------- traços ---------- */
  r.post("/api/v1/paginas/:id/tracos", async (ctx) => {
    const p = paginaDe(ctx);
    const o = corpoObjeto(ctx);
    const lote = o["tracos"];
    if (!Array.isArray(lote) || lote.length === 0) throw erroValidacao("Envie uma lista em tracos.", { campo: "tracos" });
    if (lote.length > MAX_TRACOS_LOTE) throw erroValidacao("Lote grande demais; envie em partes.", { campo: "tracos" });
    const uid = ctx.sessao!.usuarioId;
    const agora = agoraISO();
    const ids: string[] = [];
    await banco().transacao(async (t) => {
      for (const item of lote) {
        if (typeof item !== "object" || item === null) throw erroValidacao("Traço inválido.", { campo: "tracos" });
        const it = item as Record<string, unknown>;
        const d = dispositivoDaPagina(p.id, it);
        const id = novoId();
        await t.run(
          `INSERT INTO tracos (id, usuario_id, pagina_id, dispositivo_id, ferramenta, cor, largura, pontos, largura_ref, altura_ref, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, uid, p.id, d.dispositivo.id,
          opcaoDe(it, "ferramenta", FERRAMENTAS, "caneta"),
          cor(it),
          numero(it, "largura", { obrigatorio: true, min: 0.5, max: 80 }),
          JSON.stringify(pontos(it)),
          numero(it, "largura_ref", { obrigatorio: true, min: 1, max: 10000 }),
          numero(it, "altura_ref", { obrigatorio: true, min: 1, max: 100000 }),
          agora,
        );
        ids.push(id);
      }
    });
    return { status: 201, corpo: { ids } };
  });

  r.post("/api/v1/tracos/apagar", async (ctx) => {
    const o = corpoObjeto(ctx);
    const ids = o["ids"];
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 2000) throw erroValidacao("Envie uma lista de ids.", { campo: "ids" });
    let apagados = 0;
    await banco().transacao(async (t) => {
      for (const id of ids) {
        if (typeof id !== "string") continue;
        apagados += (await t.run("DELETE FROM tracos WHERE id = ? AND usuario_id = ?", id, ctx.sessao!.usuarioId)).mudancas;
      }
    });
    return { corpo: { apagados } };
  });

  r.delete("/api/v1/tracos/:id", async (ctx) => {
    const r2 = await banco().run("DELETE FROM tracos WHERE id = ? AND usuario_id = ?", ctx.params["id"], ctx.sessao!.usuarioId);
    if (!r2.mudancas) throw erroNaoEncontrado("Traço");
    return { corpo: { ok: true } };
  });

  r.delete("/api/v1/paginas/:id/tracos", async (ctx) => {
    const p = paginaDe(ctx);
    const r2 = await banco().run("DELETE FROM tracos WHERE usuario_id = ? AND pagina_id = ?", ctx.sessao!.usuarioId, p.id);
    return { corpo: { apagados: r2.mudancas } };
  });

  /* ---------- marcações de trecho ---------- */
  r.post("/api/v1/paginas/:id/marcacoes", async (ctx) => {
    const p = paginaDe(ctx);
    const o = corpoObjeto(ctx);
    const d = dispositivoDaPagina(p.id, o);
    const inicio = inteiro(o, "inicio", { obrigatorio: true, min: 0 });
    const fim = inteiro(o, "fim", { obrigatorio: true, min: 1 });
    const tamanho = d.dispositivo.texto.length;
    if (inicio >= fim || fim > tamanho) throw erroValidacao("Intervalo fora do texto do dispositivo.", { campo: "fim" });
    const id = novoId();
    const agora = agoraISO();
    const estilo = opcaoDe(o, "estilo", ESTILOS, "marca");
    const c = cor(o);
    const trecho = d.dispositivo.texto.slice(inicio, fim);
    await banco().run(
      "INSERT INTO marcacoes (id, usuario_id, pagina_id, dispositivo_id, inicio, fim, estilo, cor, trecho, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, ctx.sessao!.usuarioId, p.id, d.dispositivo.id, inicio, fim, estilo, c, trecho, agora,
    );
    return { status: 201, corpo: { id, dispositivo_id: d.dispositivo.id, inicio, fim, estilo, cor: c, trecho, criado_em: agora } };
  });

  r.put("/api/v1/marcacoes/:id", async (ctx) => {
    const o = corpoObjeto(ctx);
    const atual = await banco().get<{ estilo: string; cor: string }>("SELECT estilo, cor FROM marcacoes WHERE id = ? AND usuario_id = ?", ctx.params["id"], ctx.sessao!.usuarioId);
    if (!atual) throw erroNaoEncontrado("Marcação");
    const estilo = opcaoDe(o, "estilo", ESTILOS, atual.estilo);
    const c = o["cor"] === undefined ? atual.cor : cor(o);
    await banco().run("UPDATE marcacoes SET estilo = ?, cor = ? WHERE id = ? AND usuario_id = ?", estilo, c, ctx.params["id"], ctx.sessao!.usuarioId);
    return { corpo: { ok: true, estilo, cor: c } };
  });

  r.delete("/api/v1/marcacoes/:id", async (ctx) => {
    const r2 = await banco().run("DELETE FROM marcacoes WHERE id = ? AND usuario_id = ?", ctx.params["id"], ctx.sessao!.usuarioId);
    if (!r2.mudancas) throw erroNaoEncontrado("Marcação");
    return { corpo: { ok: true } };
  });

  /* ---------- notas ---------- */
  r.post("/api/v1/paginas/:id/notas", async (ctx) => {
    const p = paginaDe(ctx);
    const o = corpoObjeto(ctx);
    const d = dispositivoDaPagina(p.id, o);
    const textoNota = campoTexto(o, "texto", { obrigatorio: true, max: 5000 });
    const c = cor(o);
    const id = novoId();
    const agora = agoraISO();
    await banco().run(
      "INSERT INTO notas (id, usuario_id, pagina_id, dispositivo_id, texto, cor, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, ctx.sessao!.usuarioId, p.id, d.dispositivo.id, textoNota, c, agora, agora,
    );
    return { status: 201, corpo: { id, dispositivo_id: d.dispositivo.id, texto: textoNota, cor: c, criado_em: agora, atualizado_em: agora } };
  });

  r.put("/api/v1/notas/:id", async (ctx) => {
    const o = corpoObjeto(ctx);
    const atual = await banco().get<{ texto: string; cor: string }>("SELECT texto, cor FROM notas WHERE id = ? AND usuario_id = ?", ctx.params["id"], ctx.sessao!.usuarioId);
    if (!atual) throw erroNaoEncontrado("Nota");
    const textoNota = o["texto"] === undefined ? atual.texto : campoTexto(o, "texto", { obrigatorio: true, max: 5000 });
    const c = o["cor"] === undefined ? atual.cor : cor(o);
    const agora = agoraISO();
    await banco().run("UPDATE notas SET texto = ?, cor = ?, atualizado_em = ? WHERE id = ? AND usuario_id = ?", textoNota, c, agora, ctx.params["id"], ctx.sessao!.usuarioId);
    return { corpo: { ok: true, texto: textoNota, cor: c, atualizado_em: agora } };
  });

  r.delete("/api/v1/notas/:id", async (ctx) => {
    const r2 = await banco().run("DELETE FROM notas WHERE id = ? AND usuario_id = ?", ctx.params["id"], ctx.sessao!.usuarioId);
    if (!r2.mudancas) throw erroNaoEncontrado("Nota");
    return { corpo: { ok: true } };
  });

  /* ---------- leitura (onde estive) ---------- */
  r.post("/api/v1/paginas/:id/leitura", async (ctx) => {
    const p = paginaDe(ctx);
    const o = corpoObjeto(ctx);
    const posicao = numero(o, "posicao", { padrao: 0, min: 0, max: 1 });
    const contar = o["contar"] === undefined ? true : Boolean(o["contar"]);
    const uid = ctx.sessao!.usuarioId;
    const agora = agoraISO();
    const r2 = await banco().run(
      `UPDATE leituras SET visitas = visitas + ?, posicao = ?, ultima_em = ? WHERE usuario_id = ? AND pagina_id = ?`,
      contar ? 1 : 0, posicao, agora, uid, p.id,
    );
    if (!r2.mudancas) {
      await banco().run("INSERT INTO leituras (usuario_id, pagina_id, visitas, posicao, ultima_em) VALUES (?, ?, 1, ?, ?)", uid, p.id, posicao, agora);
    }
    return { corpo: { ok: true } };
  });
}
