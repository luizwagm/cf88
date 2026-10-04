/* ==========================================================================
   telas.js — estante (biblioteca do Vade Mecum), a tela de cada lei com o
   seu sumário, revisão das anotações, busca e ajustes.
   ========================================================================== */
import { api, qs } from "./api.js";
import { el, preencher, icone, avisar, confirmar, fmtRelativo, fmtData, plural, nomeDaCor, ehClara, debounce } from "./ui.js";
import * as voz from "./voz.js";
import * as armazem from "./armazem.js";
import { prefs, salvarPrefs, sumario, sumarioDe, obras, obraAtual, definirObraAtual, baixarObras, irPara, usuarioAtual, atualizarNome, atualizacao, temAtualizacao, verificarAtualizacao, aplicarAtualizacao, aoMudarAtualizacao, versaoApp } from "./app.js";

const numero = (n) => Number(n || 0).toLocaleString("pt-BR");

/* ============================ estante ============================ */
export async function telaEstante(container) {
  const cat = obras();
  const r = await armazem.lerResumo();
  const baixadas = new Set(await armazem.obrasBaixadas());
  const porObra = new Map((r.obras ?? []).map((o) => [o.obra_id, o]));
  const cf = cat.obras.find((o) => o.id === "cf") ?? cat.obras[0];

  const continuar = r.ultima
    ? el("a", { classe: "continuar", href: `#/ler/${r.ultima.pagina_id}?pos=${r.ultima.posicao}` },
        el("div", {},
          el("span", { classe: "rotulo" }, "Continuar de onde parei"),
          el("h2", {}, `${r.ultima.rotulo}${r.ultima.nome ? " — " + r.ultima.nome : ""}`),
          el("p", {}, `${r.ultima.obra_sigla ?? "CF/88"} · ${r.ultima.trilha} · ${fmtRelativo(r.ultima.ultima_em)}`),
        ),
        el("span", { classe: "botao botao-primario" }, "Abrir", icone("seta", 18)))
    : el("a", { classe: "continuar", href: `#/obra/${cf.id}` },
        el("div", {},
          el("span", { classe: "rotulo" }, "Começar"),
          el("h2", {}, cf.nome),
          el("p", {}, "Escolha uma lei abaixo, abra uma página e pegue a caneta: o caderno começa a ser seu."),
        ),
        el("span", { classe: "botao botao-primario" }, "Abrir", icone("seta", 18)));

  const numeros = el("div", { classe: "numeros" },
    el("div", { classe: "numero" }, el("b", {}, numero(cat.obras.length)), el("span", {}, "leis no Vade Mecum")),
    el("div", { classe: "numero" }, el("b", {}, numero(r.paginas_lidas)), el("span", {}, "páginas abertas")),
    el("div", { classe: "numero" }, el("b", {}, numero(r.contagens.marcacoes)), el("span", {}, "trechos marcados")),
    el("div", { classe: "numero" }, el("b", {}, numero(r.contagens.notas)), el("span", {}, "notas escritas")),
    el("div", { classe: "numero" }, el("b", {}, numero(r.contagens.tracos)), el("span", {}, "traços de caneta")),
  );

  const cartao = (o) => {
    const uso = porObra.get(o.id);
    const pct = uso && o.paginas ? Math.round((uso.lidas / o.paginas) * 100) : 0;
    return el("a", { classe: `obra-cartao ${uso ? "em-uso" : ""}`, href: `#/obra/${o.id}` },
      el("span", { classe: "obra-sigla" }, o.sigla),
      el("span", { classe: "obra-nome" }, o.nome),
      el("span", { classe: "obra-meta" }, `${numero(o.artigos)} artigos${baixadas.has(o.id) ? " · offline" : ""}`),
      uso ? el("span", { classe: "obra-uso" },
        uso.marcacoes + uso.notas + uso.tracos > 0 ? `✎ ${numero(uso.marcacoes + uso.notas + uso.tracos)} · ` : "", `${pct}% lido`) : null,
      uso ? el("span", { classe: "progresso" }, el("span", { style: `width: ${Math.max(2, pct)}%` })) : null,
    );
  };

  const minhas = (r.obras ?? []).map((u) => cat.obras.find((o) => o.id === u.obra_id)).filter(Boolean);
  const filtro = el("input", { type: "search", placeholder: "Filtrar leis: “penal”, “CLT”, “consumidor”…", "aria-label": "Filtrar leis", autocomplete: "off", classe: "filtro-obras" });
  const biblioteca = el("div", {});
  const desenharBiblioteca = () => {
    const termo = filtro.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const casa = (o) => !termo || `${o.sigla} ${o.nome} ${o.identificacao} ${o.categoria}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(termo);
    const secoes = cat.categorias.map((c) => ({ c, lista: cat.obras.filter((o) => o.categoria === c && casa(o)) })).filter((s) => s.lista.length);
    preencher(biblioteca, secoes.length
      ? secoes.map((s) => el("section", { classe: "categoria" },
          el("h3", {}, s.c, el("small", {}, plural(s.lista.length, "lei", "leis"))),
          el("div", { classe: "obras-grade" }, ...s.lista.map(cartao))))
      : el("p", { classe: "vazio" }, "Nenhuma lei com esse nome. A busca do topo procura dentro do texto."));
  };
  filtro.addEventListener("input", debounce(desenharBiblioteca, 120));
  desenharBiblioteca();

  preencher(container, el("div", { classe: "tela" },
    el("div", { classe: "tela-cabecalho" },
      el("div", {}, el("h1", {}, `Olá, ${usuarioAtual().nome.split(" ")[0]}`), el("p", {}, `Vade Mecum · ${numero(cat.obras.length)} leis, ${numero(cat.obras.reduce((s, o) => s + o.artigos, 0))} artigos`)),
      el("div", { classe: "acoes" },
        el("a", { classe: "botao", href: "#/busca" }, icone("buscar", 18), "Buscar"),
        el("a", { classe: "botao", href: "#/anotacoes" }, icone("nota", 18), "Revisar anotações"),
      ),
    ),
    r.offline ? el("p", { classe: "selo" }, "sem internet · números da cópia local") : null,
    continuar,
    numeros,
    minhas.length ? el("section", { classe: "categoria" }, el("h3", {}, "Em estudo"), el("div", { classe: "obras-grade" }, ...minhas.map(cartao))) : null,
    el("div", { classe: "biblioteca-cabecalho" }, el("h2", {}, "Biblioteca"), filtro),
    biblioteca,
  ));
}

/* ============================ sumário ============================ */
/* "Art. 5º" → "5º"; "Art. 103-A" → "103-A"; "Arts. 108 a 112" → "108 a 112". */
const rotuloCurto = (r) => String(r).replace(/^Arts?\.\s*/, "");

/* As pastilhas dos artigos de uma página: cada uma abre a página já no artigo. */
function pastilhasDeArtigos(s, paginaId, aoAbrir) {
  const p = s?.paginas.find((x) => x.id === paginaId);
  if (!p || !p.artigos?.length) return null;
  const nomes = p.artigos.map((a) => (typeof a === "string" ? a : a.rotulo));
  if (nomes.length === 1 && !/^Art/.test(nomes[0])) return null;   // o Preâmbulo não tem artigo
  return el("div", { classe: "no-artigos", "aria-label": "Artigos desta página" },
    el("span", { classe: "no-artigos-rotulo" }, p.artigos.length === 1 ? "Art." : "Arts."),
    ...p.artigos.map((a) => {
      const rotulo = typeof a === "string" ? a : a.rotulo;
      const id = typeof a === "string" ? null : a.id;
      return el("a", { classe: "chip-art", href: id ? `#/ler/${paginaId}?art=${encodeURIComponent(id)}` : `#/ler/${paginaId}`, title: rotulo, aoClicar: aoAbrir }, rotuloCurto(rotulo));
    }));
}

/* A árvore de UMA obra. `opcoes.sumario` é o sumário dela (padrão: a obra aberta). */
export function arvoreSumario(nos, contagens = new Map(), opcoes = {}) {
  const s = opcoes.sumario ?? sumario();
  const atual = (window.location.hash.split("?")[0].match(/^#\/ler\/([^/]+)/) || [])[1];
  const contem = (no) => (no.pagina && no.pagina === atual) || no.filhos.some(contem);
  /* obra grande (Código Civil: 319 páginas): só o primeiro nível nasce aberto */
  const grande = (s?.paginas.length ?? 0) > 60;
  const render = (no, nivel) => {
    const temFilhos = no.filhos && no.filhos.length > 0;
    const c = no.pagina ? contagens.get(no.pagina) : null;
    const aberto = opcoes.tudoAberto ? (!grande || nivel <= 1 || contem(no)) : (nivel === 0 && !grande) || contem(no);
    const link = no.pagina
      ? el("a", { classe: "no-link", href: `#/ler/${no.pagina}`, aoClicar: opcoes.aoAbrir },
          el("span", { classe: "no-rotulo" }, no.rotulo), el("span", { classe: "no-nome" }, no.nome || (no.tipo === "preambulo" ? "Preâmbulo" : "")))
      : el("button", { classe: "no-link", type: "button", aoClicar: (e) => e.currentTarget.closest(".no").classList.toggle("aberto") },
          el("span", { classe: "no-rotulo" }, no.rotulo), el("span", { classe: "no-nome" }, no.nome));
    const linha = el("div", { classe: `no-linha ${no.pagina && no.pagina === atual ? "ativo" : ""}` },
      link,
      c && (c.marcacoes + c.notas + c.tracos) > 0 ? el("span", { classe: "selo-contagem", title: `${c.marcacoes} marcações, ${c.notas} notas, ${c.tracos} traços` }, "✎") : null,
      temFilhos ? el("button", { classe: "no-alterna", type: "button", "aria-label": "Abrir ou fechar", aoClicar: (e) => e.currentTarget.closest(".no").classList.toggle("aberto") }, icone("seta", 16)) : null,
    );
    return el("div", { classe: `no nivel-${nivel} ${aberto ? "aberto" : ""}` }, linha,
      no.pagina ? pastilhasDeArtigos(s, no.pagina, opcoes.aoAbrir) : null,
      temFilhos ? el("div", { classe: "no-filhos" }, ...no.filhos.map((f) => render(f, nivel + 1))) : null);
  };
  return nos.map((n) => render(n, 0));
}

/* A tela de uma lei: o que ela é, de quando é o texto, e o sumário. */
export async function telaObra(container, partes) {
  const id = partes?.[0] || obraAtual();
  const o = obras().obras.find((x) => x.id === id);
  if (!o) { irPara("#/"); return; }
  const s = await sumarioDe(id);
  definirObraAtual(id);
  let contagens = new Map(), uso = null;
  try {
    const r = await armazem.lerResumo();
    contagens = new Map(r.paginas.map((p) => [p.pagina_id, p]));
    uso = (r.obras ?? []).find((x) => x.obra_id === id) ?? null;
  } catch { /* sem contagens */ }
  const baixadas = new Set(await armazem.obrasBaixadas());
  const primeira = s.paginas[0];
  const fonte = o.url
    ? [`Texto compilado do Planalto, baixado em ${fmtData(o.baixado_em)}`, o.atualizado_ate ? ` · última alteração incorporada: ${o.atualizado_ate}` : ""].join("")
    : `${o.fonte} · ${o.atualizado_ate}`;

  const botaoBaixar = el("button", { classe: "botao", type: "button" }, icone("baixar", 18), baixadas.has(id) ? "Atualizar cópia offline" : "Baixar esta lei");
  botaoBaixar.addEventListener("click", () => baixarObras([id]));

  preencher(container, el("div", { classe: "tela" },
    el("a", { classe: "voltar", href: "#/" }, icone("anterior", 16), "Biblioteca"),
    el("div", { classe: "obra-cabecalho" },
      el("span", { classe: "obra-sigla grande" }, o.sigla),
      el("div", {},
        el("h1", {}, o.nome),
        el("p", { classe: "obra-ident" }, o.identificacao),
        o.ementa ? el("p", { classe: "obra-ementa" }, o.ementa) : null,
        el("p", { classe: "obra-fonte" }, fonte, o.url ? el("a", { href: o.url, target: "_blank", rel: "noopener noreferrer" }, " · ver no Planalto") : null),
      ),
    ),
    el("div", { classe: "acoes obra-acoes" },
      uso?.ultima_pagina
        ? el("a", { classe: "botao botao-primario", href: `#/ler/${uso.ultima_pagina}` }, "Continuar", icone("seta", 18))
        : el("a", { classe: "botao botao-primario", href: `#/ler/${primeira.id}` }, "Começar a ler", icone("seta", 18)),
      el("a", { classe: "botao", href: `#/busca?obra=${encodeURIComponent(id)}` }, icone("buscar", 18), "Buscar nesta lei"),
      botaoBaixar,
      el("span", { classe: "selo" }, `${numero(o.artigos)} artigos · ${numero(o.paginas)} páginas`),
      baixadas.has(id) ? el("span", { classe: "selo acento" }, "disponível offline") : null,
    ),
    el("nav", { classe: `sumario-nav sumario-tela cartao ${s.paginas.length > 60 ? "recolhivel" : ""}` }, ...arvoreSumario(s.sumario, contagens, { tudoAberto: true, sumario: s })),
  ));
}

export const telaSumario = (container) => telaObra(container, [obraAtual()]);

/* ============================ revisão ============================ */
export async function telaAnotacoes(container) {
  const r = await armazem.lerRevisao();
  const grupos = new Map();
  for (const i of r.itens) {
    if (!grupos.has(i.pagina_id)) grupos.set(i.pagina_id, { pagina_id: i.pagina_id, rotulo: i.pagina_rotulo, nome: i.pagina_nome, ordem: i.ordem, sigla: i.obra_sigla || "", itens: [] });
    grupos.get(i.pagina_id).itens.push(i);
  }
  const ordenados = [...grupos.values()].sort((a, b) => a.ordem - b.ordem);

  const falarTudo = (lista) => lista.map((i) => ({ texto: i.tipo === "nota" ? `Minha nota em ${i.referencia}: ${i.texto}` : `Trecho marcado em ${i.referencia}: ${i.trecho}` }));

  const cabecalho = el("div", { classe: "tela-cabecalho" },
    el("div", {}, el("h1", {}, "Minhas anotações"), el("p", {}, r.itens.length ? `${plural(r.itens.filter((i) => i.tipo === "marcacao").length, "trecho marcado", "trechos marcados")} e ${plural(r.itens.filter((i) => i.tipo === "nota").length, "nota", "notas")}, lei por lei, na ordem do texto` : "Tudo o que você marcar e escrever aparece aqui, lei por lei, na ordem do texto.")),
    r.itens.length ? el("div", { classe: "acoes" },
      el("button", { classe: "botao botao-primario", type: "button", aoClicar: () => { if (!voz.falar(falarTudo(r.itens))) avisar("Este navegador não tem leitura em voz.", "erro"); } }, icone("ouvir", 18), "Ouvir tudo"),
      el("button", { classe: "botao", type: "button", aoClicar: () => voz.parar() }, icone("parar", 16), "Parar"),
    ) : null,
  );
  if (r.offline) cabecalho.append(el("p", { classe: "selo" }, "sem internet · lista da cópia local"));

  const corpo = ordenados.length ? ordenados.map((g) => el("section", { classe: "grupo-pagina" },
    el("h2", {}, g.sigla ? el("span", { classe: "selo ouro" }, g.sigla) : null, el("a", { href: `#/ler/${g.pagina_id}` }, `${g.rotulo}${g.nome ? " — " + g.nome : ""}`), el("small", {}, plural(g.itens.length, "item", "itens")),
      el("button", { classe: "botao botao-mini botao-fantasma", type: "button", title: "Ouvir as anotações desta página", aoClicar: () => voz.falar(falarTudo(g.itens)) }, icone("ouvir", 16))),
    ...g.itens.map((i) => itemAnotacao(i, () => telaAnotacoes(container))),
  )) : [el("div", { classe: "vazio" }, el("span", { classe: "grande" }, "☰"), el("p", {}, "Nenhuma marcação ou nota ainda."))];

  preencher(container, el("div", { classe: "tela" }, cabecalho, ...corpo));
}

function itemAnotacao(i, recarregar) {
  const nota = i.tipo === "nota";
  const card = el("div", { classe: "item-anotacao", style: `--cor: ${i.cor}` },
    el("span", { classe: "cor" }),
    el("div", {},
      el("div", { classe: "ref" }, `${nota ? "Nota" : { marca: "Marcado", sublinhado: "Sublinhado", riscado: "Riscado" }[i.estilo] || "Marcado"} · ${i.referencia} · ${nomeDaCor(i.cor)}`),
      el("div", { classe: `texto ${nota ? "nota-texto" : ""}` }, nota ? i.texto : `“${i.trecho}”`),
      el("div", { classe: "quando", style: "color: var(--tinta-3); font-size: .76rem" }, fmtRelativo(i.atualizado_em || i.criado_em)),
    ),
    el("div", { classe: "acoes-item" },
      el("button", { classe: "botao-icone", type: "button", title: "Ouvir", aoClicar: () => voz.falar([{ texto: nota ? i.texto : i.trecho, elemento: card }]) }, icone("ouvir", 18)),
      el("a", { classe: "botao-icone", href: `#/ler/${i.pagina_id}?d=${encodeURIComponent(i.dispositivo_id)}`, title: "Abrir na página" }, icone("seta", 18)),
      el("button", { classe: "botao-icone", type: "button", title: "Apagar", aoClicar: () => confirmar(nota ? "Apagar esta nota?" : "Remover esta marcação?", async () => {
        await armazem.removerDoEspelho(i.pagina_id, nota ? "notas" : "marcacoes", i.id);
        void armazem.mutar({ metodo: "DELETE", caminho: nota ? `/api/v1/notas/${i.id}` : `/api/v1/marcacoes/${i.id}` });
        avisar(nota ? "Nota apagada." : "Marcação removida.");
        await recarregar();
      }, "Apagar") }, icone("lixo", 18)),
    ),
  );
  return card;
}

/* ============================ busca ============================ */
export async function telaBusca(container, partes, query) {
  const q = (query.get("q") || "").trim();
  let filtro = (query.get("obra") || "").trim();
  const cat = obras();
  const siglaDe = (id) => cat.obras.find((o) => o.id === id)?.sigla ?? id;
  const campo = el("input", { type: "search", value: q, placeholder: "Palavra, expressão ou “art. 121 cp”", "aria-label": "Buscar", autocomplete: "off" });
  const resultados = el("div", {});
  const escopo = el("div", { classe: "escopo-busca" });
  const desenharEscopo = (porObra = []) => {
    const chip = (id, rotulo) => el("button", { type: "button", classe: `chip-escopo ${filtro === id ? "ativo" : ""}`, aoClicar: () => { filtro = id; desenharEscopo(porObra); void buscar(campo.value); } }, rotulo);
    preencher(escopo,
      chip("", "Todo o Vade Mecum"),
      filtro && !porObra.some((p) => p.obra_id === filtro) ? chip(filtro, siglaDe(filtro)) : null,
      ...porObra.slice(0, 14).map((p) => chip(p.obra_id, `${p.obra_sigla} · ${p.total}`)),
    );
  };
  const buscar = async (termo) => {
    if (termo.trim().length < 2) { preencher(resultados, el("p", { classe: "vazio" }, "Digite pelo menos duas letras.")); return; }
    preencher(resultados, el("p", { classe: "vazio" }, "Buscando…"));
    try {
      let r;
      try { r = await api.get(`/api/v1/texto/busca${qs({ q: termo, obra: filtro, em: obraAtual() })}`); }
      catch (e) { if (e.status !== 0) throw e; r = await armazem.buscarLocal(termo, filtro); }
      if (!filtro) desenharEscopo(r.por_obra ?? []);
      const termos = termo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
      preencher(resultados,
        r.artigo ? el("a", { classe: "resultado", href: `#/ler/${r.artigo.pagina_id}?art=${encodeURIComponent(r.artigo.artigo_id)}`, style: "border-color: var(--acento)" },
          el("div", { classe: "onde" }, "Ir direto para"), el("div", { classe: "ref" }, `${r.artigo.rotulo ?? "Artigo"}${r.artigo.obra_sigla ? " · " + r.artigo.obra_sigla : ""}`)) : null,
        el("p", { style: "color: var(--tinta-3)" }, (r.offline ? `Sem internet: buscando na cópia local (${plural(r.paginas, "página baixada", "páginas baixadas")}). ` : "") + (r.total ? `${plural(r.total, "dispositivo encontrado", "dispositivos encontrados")}${r.total > r.itens.length ? ` · mostrando ${r.itens.length}` : ""}` : "Nada encontrado com essas palavras.")),
        ...r.itens.map((i) => el("a", { classe: "resultado", href: `#/ler/${i.pagina_id}?d=${encodeURIComponent(i.dispositivo_id)}` },
          el("div", { classe: "onde" }, el("b", {}, i.obra_sigla ?? ""), ` · ${i.trilha}${i.pagina_nome ? " — " + i.pagina_nome : ""}`),
          el("div", { classe: "ref" }, i.dispositivo_rotulo ? `${i.artigo_rotulo}, ${i.dispositivo_rotulo}` : i.artigo_rotulo),
          el("div", { classe: "trecho" }, ...realcar(i.trecho, termos)),
        )),
      );
    } catch (e) { preencher(resultados, el("p", { classe: "vazio" }, e.message)); }
  };
  const form = el("form", { classe: "form", aoEnviar: (e) => { e.preventDefault(); irPara(`#/busca${qs({ q: campo.value, obra: filtro })}`); } },
    el("div", { style: "display:flex; gap:.5rem" }, campo, el("button", { classe: "botao botao-primario", type: "submit" }, icone("buscar", 18), "Buscar")));
  campo.addEventListener("input", debounce(() => buscar(campo.value), 350));
  desenharEscopo();
  preencher(container, el("div", { classe: "tela" },
    el("div", { classe: "tela-cabecalho" }, el("div", {}, el("h1", {}, "Buscar no Vade Mecum"), el("p", {}, "Sem acento, sem maiúscula: todas as palavras precisam aparecer no mesmo dispositivo. “art. 121 cp” vai direto ao artigo."))),
    form, escopo, resultados,
  ));
  if (q) await buscar(q); else campo.focus();
}

function realcar(texto, termos) {
  if (!termos.length) return [texto];
  const semAcento = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nos = [];
  let i = 0;
  while (i < texto.length) {
    let melhor = -1, tam = 0;
    for (const t of termos) { const p = semAcento.indexOf(t, i); if (p !== -1 && (melhor === -1 || p < melhor)) { melhor = p; tam = t.length; } }
    if (melhor === -1) { nos.push(texto.slice(i)); break; }
    if (melhor > i) nos.push(texto.slice(i, melhor));
    nos.push(el("mark", {}, texto.slice(melhor, melhor + tam)));
    i = melhor + tam;
  }
  return nos;
}

/* ============================ aplicativo ============================ */
function cartaoAplicativo(eu) {
  const estadoEl = el("p", { style: "margin: 0; color: var(--tinta-3); font-size: .86rem" });
  const botao = el("button", { classe: "botao", type: "button" });
  const desenhar = () => {
    const ha = temAtualizacao();
    preencher(estadoEl, ha
      ? `Versão ${atualizacao.versaoNova || "nova"} pronta para instalar. Você está na ${versaoApp()}.`
      : `Você está na versão ${versaoApp()}.${atualizacao.ultimaVerificacao ? ` Última conferência ${fmtRelativo(atualizacao.ultimaVerificacao)}.` : ""} O aplicativo confere sozinho ao abrir, ao voltar ao primeiro plano e a cada 20 minutos.`);
    preencher(botao, icone("atualizar", 18), ha ? "Atualizar agora" : "Verificar atualização");
    botao.className = ha ? "botao botao-primario" : "botao";
    botao.onclick = async () => {
      if (temAtualizacao()) return aplicarAtualizacao();
      botao.disabled = true;
      const nova = await verificarAtualizacao("manual");
      botao.disabled = false;
      if (!nova) avisar(`Você está na versão mais recente (${versaoApp()}).`);
    };
  };
  desenhar();
  aoMudarAtualizacao(desenhar);
  const instalado = window.matchMedia("(display-mode: standalone)").matches;
  return el("div", { classe: "cartao form" },
    el("h2", { style: "font-size:1.1rem" }, "Aplicativo"),
    estadoEl,
    el("div", { classe: "acoes" }, botao),
    el("p", { style: "margin: 0; color: var(--tinta-3); font-size: .82rem" }, `${instalado ? "Instalado como aplicativo." : "Aberto no navegador (o menu do avatar instala no tablet)."} ${armazemBaixado()}`),
  );
}
function armazemBaixado() {
  const b = armazem.estado.baixadoEm;
  return b ? `Cópia offline de ${fmtRelativo(b)}.` : "Sem cópia offline ainda.";
}

/* ============================ ajustes ============================ */
export async function telaAjustes(container) {
  const p = prefs();
  const eu = usuarioAtual();
  const nome = el("input", { type: "text", value: eu.nome, maxlength: "120" });
  const tamanho = el("input", { type: "range", min: "14", max: "30", step: "1", value: p.tamanho_fonte });
  const tamanhoRotulo = el("span", {}, `${p.tamanho_fonte}px`);
  const velocidade = el("input", { type: "range", min: "0.5", max: "2", step: "0.1", value: p.velocidade_voz });
  const velocidadeRotulo = el("span", {}, `${Number(p.velocidade_voz).toFixed(1)}×`);
  const vozSelect = el("select", {}, el("option", { value: "" }, "Automática (melhor voz em português)"));
  const montarVozes = () => {
    const atual = vozSelect.value || p.voz;
    preencher(vozSelect, el("option", { value: "" }, "Automática (melhor voz em português)"), ...voz.listarVozes().map((v) => el("option", { value: v.nome, selected: v.nome === atual ? true : undefined }, `${v.nome} (${v.lang}${v.local ? "" : ", online"})`)));
  };
  montarVozes();
  if ("speechSynthesis" in window) window.speechSynthesis.addEventListener("voiceschanged", montarVozes, { once: true });
  const notas = el("button", { classe: `chave ${p.notas_alteracao !== "0" ? "ligada" : ""}`, type: "button", role: "switch", "aria-checked": p.notas_alteracao !== "0" ? "true" : "false", aoClicar: async (e) => {
    const ligado = !e.currentTarget.classList.contains("ligada");
    e.currentTarget.classList.toggle("ligada", ligado);
    e.currentTarget.setAttribute("aria-checked", String(ligado));
    await salvarPrefs({ notas_alteracao: ligado ? "1" : "0" });
  } });
  const dedo = el("button", { classe: `chave ${p.desenhar_com_dedo === "1" ? "ligada" : ""}`, type: "button", role: "switch", "aria-checked": p.desenhar_com_dedo === "1" ? "true" : "false", aoClicar: async (e) => {
    const ligado = !e.currentTarget.classList.contains("ligada");
    e.currentTarget.classList.toggle("ligada", ligado);
    e.currentTarget.setAttribute("aria-checked", String(ligado));
    await salvarPrefs({ desenhar_com_dedo: ligado ? "1" : "0" });
  } });

  tamanho.addEventListener("input", () => { tamanhoRotulo.textContent = `${tamanho.value}px`; document.documentElement.style.setProperty("--tamanho-texto", `${tamanho.value}px`); });
  tamanho.addEventListener("change", () => salvarPrefs({ tamanho_fonte: tamanho.value }));
  velocidade.addEventListener("input", () => { velocidadeRotulo.textContent = `${Number(velocidade.value).toFixed(1)}×`; });
  velocidade.addEventListener("change", () => salvarPrefs({ velocidade_voz: velocidade.value }));
  vozSelect.addEventListener("change", () => salvarPrefs({ voz: vozSelect.value }));

  const senhaAtual = el("input", { type: "password", autocomplete: "current-password" });
  const senhaNova = el("input", { type: "password", autocomplete: "new-password", minlength: "10" });

  preencher(container, el("div", { classe: "tela" },
    el("div", { classe: "tela-cabecalho" }, el("div", {}, el("h1", {}, "Ajustes"), el("p", {}, "Leitura, caneta, voz e conta."))),
    el("div", { classe: "grade", style: "align-items: start" },
      el("div", { classe: "cartao form" },
        el("h2", { style: "font-size:1.1rem" }, "Leitura"),
        el("label", {}, el("span", {}, "Tamanho do texto · ", tamanhoRotulo), tamanho),
        el("p", { style: "font-family: var(--serifa); font-size: var(--tamanho-texto); margin: 0; line-height: 1.6" }, "Art. 1º A República Federativa do Brasil, formada pela união indissolúvel dos Estados e Municípios e do Distrito Federal…"),
        el("div", { classe: "opcao-toggle" }, el("div", {}, el("b", {}, "Notas de alteração"), el("span", {}, "Mostra, sob cada dispositivo, a lei que deu a redação atual (\u201cRedação dada pela Lei nº…\u201d).")), notas),
        el("div", { classe: "opcao-toggle" }, el("div", {}, el("b", {}, "Desenhar com o dedo"), el("span", {}, "Desligado, o dedo só rola a página e a caneta desenha (o ideal com a S Pen).")), dedo),
      ),
      el("div", { classe: "cartao form" },
        el("h2", { style: "font-size:1.1rem" }, "Voz"),
        el("label", {}, "Voz do sistema", vozSelect),
        el("label", {}, el("span", {}, "Velocidade · ", velocidadeRotulo), velocidade),
        el("div", { classe: "acoes" },
          el("button", { classe: "botao", type: "button", aoClicar: () => { voz.configurarVoz({ voz: vozSelect.value, velocidade: velocidade.value }); if (!voz.falar([{ texto: "Todos são iguais perante a lei, sem distinção de qualquer natureza." }])) avisar("Este navegador não tem leitura em voz.", "erro"); } }, icone("ouvir", 18), "Testar a voz"),
          el("button", { classe: "botao botao-fantasma", type: "button", aoClicar: () => voz.parar() }, "Parar"),
        ),
        el("p", { style: "color: var(--tinta-3); font-size: .82rem; margin: 0" }, "As vozes vêm do próprio aparelho. No Galaxy Tab, instale ou atualize as vozes em português nos ajustes de Texto para voz do Android."),
      ),
      cartaoAplicativo(eu),
      el("form", { classe: "cartao form", aoEnviar: async (e) => {
        e.preventDefault();
        try { await api.put("/api/v1/eu", { nome: nome.value }); atualizarNome(nome.value); avisar("Nome salvo."); } catch (ex) { avisar(ex.message, "erro"); }
      } },
        el("h2", { style: "font-size:1.1rem" }, "Conta"),
        el("label", {}, "Nome", nome),
        el("label", {}, "E-mail", el("input", { type: "email", value: eu.email, disabled: true })),
        el("div", { classe: "acoes" }, el("button", { classe: "botao botao-primario", type: "submit" }, "Salvar nome")),
      ),
      el("form", { classe: "cartao form", aoEnviar: async (e) => {
        e.preventDefault();
        try { await api.post("/api/v1/trocar-senha", { senha_atual: senhaAtual.value, senha_nova: senhaNova.value }); senhaAtual.value = ""; senhaNova.value = ""; avisar("Senha trocada."); } catch (ex) { avisar(ex.message, "erro"); }
      } },
        el("h2", { style: "font-size:1.1rem" }, "Senha"),
        el("label", {}, "Senha atual", senhaAtual),
        el("label", {}, "Senha nova (mínimo 10 caracteres)", senhaNova),
        el("div", { classe: "acoes" }, el("button", { classe: "botao", type: "submit" }, "Trocar senha")),
      ),
    ),
  ));
}
