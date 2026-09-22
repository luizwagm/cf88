/* ==========================================================================
   api/estudo.ts — a estante (resumo do que já foi lido e anotado), a
   revisão (todas as marcações e notas, na ordem do livro) e as preferências.
   ========================================================================== */
import type { Roteador } from "../http/roteador.ts";
import { corpoObjeto } from "../http/roteador.ts";
import { banco } from "../dados/bd.ts";
import { erroValidacao } from "../nucleo/erros.ts";
import { texto as conteudo, pagina as acharPagina } from "../dados/texto.ts";
import { PREFERENCIAS_PADRAO } from "../dados/semear.ts";

const LIMITES_PREF: Record<string, (v: string) => boolean> = {
  tamanho_fonte: (v) => /^\d{2}$/.test(v) && Number(v) >= 14 && Number(v) <= 30,
  voz: (v) => v.length <= 120,
  velocidade_voz: (v) => /^\d(\.\d+)?$/.test(v) && Number(v) >= 0.5 && Number(v) <= 2,
  desenhar_com_dedo: (v) => v === "0" || v === "1",
  cor_caneta: (v) => /^#[0-9a-f]{6}$/i.test(v),
  cor_marcador: (v) => /^#[0-9a-f]{6}$/i.test(v),
  largura_caneta: (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= 0.5 && Number(v) <= 12,
  ferramenta: (v) => ["caneta", "marcador", "borracha", "selecao", "nota", "mao"].includes(v),
};

export function registrarEstudo(r: Roteador): void {
  r.get("/api/v1/resumo", async (ctx) => {
    const uid = ctx.sessao!.usuarioId;
    const c = conteudo();
    const [ultima, lidas, tracos, marcacoes, notas, porTraco, porMarcacao, porNota, leituras] = await Promise.all([
      banco().get<{ pagina_id: string; posicao: number; ultima_em: string }>("SELECT pagina_id, posicao, ultima_em FROM leituras WHERE usuario_id = ? ORDER BY ultima_em DESC LIMIT 1", uid),
      banco().get<{ n: number }>("SELECT count(*) AS n FROM leituras WHERE usuario_id = ?", uid),
      banco().get<{ n: number }>("SELECT count(*) AS n FROM tracos WHERE usuario_id = ?", uid),
      banco().get<{ n: number }>("SELECT count(*) AS n FROM marcacoes WHERE usuario_id = ?", uid),
      banco().get<{ n: number }>("SELECT count(*) AS n FROM notas WHERE usuario_id = ?", uid),
      banco().all<{ pagina_id: string; n: number }>("SELECT pagina_id, count(*) AS n FROM tracos WHERE usuario_id = ? GROUP BY pagina_id", uid),
      banco().all<{ pagina_id: string; n: number }>("SELECT pagina_id, count(*) AS n FROM marcacoes WHERE usuario_id = ? GROUP BY pagina_id", uid),
      banco().all<{ pagina_id: string; n: number }>("SELECT pagina_id, count(*) AS n FROM notas WHERE usuario_id = ? GROUP BY pagina_id", uid),
      banco().all<{ pagina_id: string; visitas: number; posicao: number; ultima_em: string }>("SELECT pagina_id, visitas, posicao, ultima_em FROM leituras WHERE usuario_id = ?", uid),
    ]);

    const porPagina = new Map<string, { pagina_id: string; tracos: number; marcacoes: number; notas: number; visitas: number; posicao: number; ultima_em: string | null }>();
    const entrada = (id: string) => {
      let e = porPagina.get(id);
      if (!e) { e = { pagina_id: id, tracos: 0, marcacoes: 0, notas: 0, visitas: 0, posicao: 0, ultima_em: null }; porPagina.set(id, e); }
      return e;
    };
    for (const l of porTraco) entrada(l.pagina_id).tracos = Number(l.n);
    for (const l of porMarcacao) entrada(l.pagina_id).marcacoes = Number(l.n);
    for (const l of porNota) entrada(l.pagina_id).notas = Number(l.n);
    for (const l of leituras) { const e = entrada(l.pagina_id); e.visitas = Number(l.visitas); e.posicao = Number(l.posicao); e.ultima_em = l.ultima_em; }

    const itens = [...porPagina.values()]
      .map((e) => {
        const p = acharPagina(e.pagina_id);
        return p ? { ...e, ordem: p.ordem, rotulo: p.rotulo, nome: p.nome, livro: p.livro, trilha: p.trilha.map((t) => t.rotulo).join(" › ") } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.ordem - b.ordem);

    const ultimaPagina = ultima ? acharPagina(ultima.pagina_id) : undefined;
    return {
      corpo: {
        atualizado_ate: c.atualizado_ate,
        total_paginas: c.paginas.length,
        paginas_lidas: Number(lidas?.n ?? 0),
        contagens: { tracos: Number(tracos?.n ?? 0), marcacoes: Number(marcacoes?.n ?? 0), notas: Number(notas?.n ?? 0) },
        ultima: ultima && ultimaPagina ? { pagina_id: ultima.pagina_id, posicao: Number(ultima.posicao), ultima_em: ultima.ultima_em, rotulo: ultimaPagina.rotulo, nome: ultimaPagina.nome, trilha: ultimaPagina.trilha.map((t) => t.rotulo).join(" › ") } : null,
        paginas: itens,
      },
    };
  });

  /* Revisão: marcações e notas de todas as páginas (ou de uma), na ordem do livro. */
  r.get("/api/v1/anotacoes", async (ctx) => {
    const uid = ctx.sessao!.usuarioId;
    const filtro = ctx.query.get("pagina");
    const [marcacoes, notas] = await Promise.all([
      filtro
        ? banco().all("SELECT id, pagina_id, dispositivo_id, inicio, fim, estilo, cor, trecho, criado_em FROM marcacoes WHERE usuario_id = ? AND pagina_id = ? ORDER BY criado_em", uid, filtro)
        : banco().all("SELECT id, pagina_id, dispositivo_id, inicio, fim, estilo, cor, trecho, criado_em FROM marcacoes WHERE usuario_id = ? ORDER BY criado_em", uid),
      filtro
        ? banco().all("SELECT id, pagina_id, dispositivo_id, texto, cor, criado_em, atualizado_em FROM notas WHERE usuario_id = ? AND pagina_id = ? ORDER BY criado_em", uid, filtro)
        : banco().all("SELECT id, pagina_id, dispositivo_id, texto, cor, criado_em, atualizado_em FROM notas WHERE usuario_id = ? ORDER BY criado_em", uid),
    ]);
    const ordemDe = (id: string) => acharPagina(id)?.ordem ?? 0;
    const posicaoDe = (paginaId: string, dispositivoId: string) => {
      const p = acharPagina(paginaId);
      if (!p) return 0;
      let i = 0;
      for (const a of p.artigos) for (const d of a.dispositivos) { i += 1; if (d.id === dispositivoId) return i; }
      return 0;
    };
    const rotuloDe = (dispositivoId: string) => {
      for (const p of conteudo().paginas) for (const a of p.artigos) for (const d of a.dispositivos) {
        if (d.id === dispositivoId) return d.rotulo ? `${a.rotulo}, ${d.rotulo}` : a.rotulo;
      }
      return "";
    };
    type Item = Record<string, unknown> & { pagina_id: string; dispositivo_id: string; criado_em: string };
    const marcar = (tipo: string, lista: Item[]) => lista.map((m) => ({
      tipo, ...m, ordem: ordemDe(m.pagina_id), posicao: posicaoDe(m.pagina_id, m.dispositivo_id), referencia: rotuloDe(m.dispositivo_id),
      pagina_rotulo: acharPagina(m.pagina_id)?.rotulo ?? "", pagina_nome: acharPagina(m.pagina_id)?.nome ?? "",
    }));
    const itens = [...marcar("marcacao", marcacoes as Item[]), ...marcar("nota", notas as Item[])]
      .sort((a, b) => a.ordem - b.ordem || a.posicao - b.posicao || String(a.criado_em).localeCompare(String(b.criado_em)));
    return { corpo: { itens } };
  });

  /* ---------- preferências ---------- */
  r.get("/api/v1/preferencias", async (ctx) => {
    const linhas = await banco().all<{ chave: string; valor: string }>("SELECT chave, valor FROM preferencias WHERE usuario_id = ?", ctx.sessao!.usuarioId);
    const prefs: Record<string, string> = { ...PREFERENCIAS_PADRAO };
    for (const l of linhas) prefs[l.chave] = l.valor;
    return { corpo: prefs };
  });

  r.put("/api/v1/preferencias", async (ctx) => {
    const o = corpoObjeto(ctx);
    const uid = ctx.sessao!.usuarioId;
    const gravadas: Record<string, string> = {};
    await banco().transacao(async (t) => {
      for (const [chave, valor] of Object.entries(o)) {
        const valida = LIMITES_PREF[chave];
        if (!valida) throw erroValidacao(`Preferência desconhecida: ${chave}.`, { campo: chave });
        const v = String(valor ?? "").trim();
        if (!valida(v)) throw erroValidacao(`Valor inválido para ${chave}.`, { campo: chave });
        const r2 = await t.run("UPDATE preferencias SET valor = ? WHERE usuario_id = ? AND chave = ?", v, uid, chave);
        if (!r2.mudancas) await t.run("INSERT INTO preferencias (usuario_id, chave, valor) VALUES (?, ?, ?)", uid, chave, v);
        gravadas[chave] = v;
      }
    });
    return { corpo: gravadas };
  });
}
