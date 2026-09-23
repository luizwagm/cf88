/* ==========================================================================
   telas.js — estante (início), sumário, revisão das anotações, busca e
   ajustes.
   ========================================================================== */
import { api, qs } from "./api.js";
import { el, preencher, icone, avisar, confirmar, fmtRelativo, plural, nomeDaCor, ehClara, debounce } from "./ui.js";
import * as voz from "./voz.js";
import * as armazem from "./armazem.js";
import { prefs, salvarPrefs, sumario, irPara, usuarioAtual, atualizarNome } from "./app.js";

/* ============================ estante ============================ */
export async function telaEstante(container) {
  const s = sumario();
  const r = await armazem.lerResumo(s);
  const primeira = s.paginas[0];
  const pct = r.total_paginas ? Math.round((r.paginas_lidas / r.total_paginas) * 100) : 0;

  const continuar = r.ultima
    ? el("a", { classe: "continuar", href: `#/ler/${r.ultima.pagina_id}?pos=${r.ultima.posicao}` },
        el("div", {},
          el("span", { classe: "rotulo" }, "Continuar de onde parei"),
          el("h2", {}, `${r.ultima.rotulo}${r.ultima.nome ? " — " + r.ultima.nome : ""}`),
          el("p", {}, `${r.ultima.trilha} · ${fmtRelativo(r.ultima.ultima_em)}`),
          el("div", { classe: "progresso" }, el("span", { style: `width: ${pct}%` })),
        ),
        el("span", { classe: "botao botao-primario" }, "Abrir", icone("seta", 18)))
    : el("a", { classe: "continuar", href: `#/ler/${primeira.id}` },
        el("div", {},
          el("span", { classe: "rotulo" }, "Começar pelo início"),
          el("h2", {}, "Preâmbulo"),
          el("p", {}, "Nós, representantes do povo brasileiro, reunidos em Assembleia Nacional Constituinte…"),
        ),
        el("span", { classe: "botao botao-primario" }, "Abrir o caderno", icone("seta", 18)));

  const numeros = el("div", { classe: "numeros" },
    el("div", { classe: "numero" }, el("b", {}, `${r.paginas_lidas}/${r.total_paginas}`), el("span", {}, `páginas abertas · ${pct}%`)),
    el("div", { classe: "numero" }, el("b", {}, r.contagens.marcacoes), el("span", {}, "trechos marcados")),
    el("div", { classe: "numero" }, el("b", {}, r.contagens.notas), el("span", {}, "notas escritas")),
    el("div", { classe: "numero" }, el("b", {}, r.contagens.tracos), el("span", {}, "traços de caneta")),
  );

  const anotadas = r.paginas.filter((p) => p.tracos + p.marcacoes + p.notas > 0);
  const lista = anotadas.length
    ? el("div", { classe: "lista" }, ...anotadas.map(linhaPagina))
    : el("div", { classe: "vazio" }, el("span", { classe: "grande" }, "✎"), el("p", {}, "Nenhuma página anotada ainda. Abra uma página, pegue a caneta e o caderno começa a ser seu."));

  preencher(container, el("div", { classe: "tela" },
    el("div", { classe: "tela-cabecalho" },
      el("div", {}, el("h1", {}, `Olá, ${usuarioAtual().nome.split(" ")[0]}`), el("p", {}, `Constituição da República Federativa do Brasil · texto compilado até a ${r.atualizado_ate}`)),
      el("div", { classe: "acoes" },
        el("a", { classe: "botao", href: "#/sumario" }, icone("livro", 18), "Sumário"),
        el("a", { classe: "botao", href: "#/anotacoes" }, icone("nota", 18), "Revisar anotações"),
      ),
    ),
    r.offline ? el("p", { classe: "selo" }, "sem internet · números da cópia local") : null,
    continuar,
    numeros,
    el("h2", { style: "font-size: 1.2rem; margin-top: 1.6rem" }, "Páginas com anotações"),
    lista,
  ));
}

function linhaPagina(p) {
  return el("a", { classe: "linha-pagina", href: `#/ler/${p.pagina_id}` },
    el("div", {}, el("div", { classe: "trilha" }, p.trilha), el("div", { classe: "nome" }, `${p.rotulo}${p.nome ? " — " + p.nome : ""}`)),
    el("div", { classe: "contagens" },
      p.marcacoes ? el("span", { classe: "selo ouro" }, plural(p.marcacoes, "marcação", "marcações")) : null,
      p.notas ? el("span", { classe: "selo acento" }, plural(p.notas, "nota", "notas")) : null,
      p.tracos ? el("span", { classe: "selo" }, plural(p.tracos, "traço", "traços")) : null,
      p.ultima_em ? el("span", { classe: "quando" }, fmtRelativo(p.ultima_em)) : null,
    ),
  );
}

/* ============================ sumário ============================ */
/* "Art. 5º" → "5º"; "Art. 103-A" → "103-A"; "Arts. 108 a 112" → "108 a 112". */
const rotuloCurto = (r) => String(r).replace(/^Arts?\.\s*/, "");

/* As pastilhas dos artigos de uma página: cada uma abre a página já no artigo. */
function pastilhasDeArtigos(paginaId, aoAbrir) {
  const p = sumario()?.paginas.find((x) => x.id === paginaId);
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

export function arvoreSumario(nos, contagens = new Map(), opcoes = {}) {
  const atual = (window.location.hash.split("?")[0].match(/^#\/ler\/([^/]+)/) || [])[1];
  const contem = (no) => (no.pagina && no.pagina === atual) || no.filhos.some(contem);
  const render = (no, nivel) => {
    const temFilhos = no.filhos && no.filhos.length > 0;
    const c = no.pagina ? contagens.get(no.pagina) : null;
    const aberto = opcoes.tudoAberto || nivel === 0 || contem(no);
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
      no.pagina ? pastilhasDeArtigos(no.pagina, opcoes.aoAbrir) : null,
      temFilhos ? el("div", { classe: "no-filhos" }, ...no.filhos.map((f) => render(f, nivel + 1))) : null);
  };
  return nos.map((n) => render(n, 0));
}

export async function telaSumario(container) {
  const s = sumario();
  let contagens = new Map();
  try { const r = await armazem.lerResumo(s); contagens = new Map(r.paginas.map((p) => [p.pagina_id, p])); } catch { /* sem contagens */ }
  preencher(container, el("div", { classe: "tela" },
    el("div", { classe: "tela-cabecalho" },
      el("div", {}, el("h1", {}, "Sumário"), el("p", {}, `${s.paginas.length} páginas · ${s.fonte}`)),
    ),
    el("nav", { classe: "sumario-nav sumario-tela cartao" }, ...arvoreSumario(s.sumario, contagens, { tudoAberto: true })),
  ));
}

/* ============================ revisão ============================ */
export async function telaAnotacoes(container) {
  const r = await armazem.lerRevisao(sumario());
  const grupos = new Map();
  for (const i of r.itens) {
    if (!grupos.has(i.pagina_id)) grupos.set(i.pagina_id, { pagina_id: i.pagina_id, rotulo: i.pagina_rotulo, nome: i.pagina_nome, ordem: i.ordem, itens: [] });
    grupos.get(i.pagina_id).itens.push(i);
  }
  const ordenados = [...grupos.values()].sort((a, b) => a.ordem - b.ordem);

  const falarTudo = (lista) => lista.map((i) => ({ texto: i.tipo === "nota" ? `Minha nota em ${i.referencia}: ${i.texto}` : `Trecho marcado em ${i.referencia}: ${i.trecho}` }));

  const cabecalho = el("div", { classe: "tela-cabecalho" },
    el("div", {}, el("h1", {}, "Minhas anotações"), el("p", {}, r.itens.length ? `${plural(r.itens.filter((i) => i.tipo === "marcacao").length, "trecho marcado", "trechos marcados")} e ${plural(r.itens.filter((i) => i.tipo === "nota").length, "nota", "notas")}, na ordem do livro` : "Tudo o que você marcar e escrever aparece aqui, na ordem do livro.")),
    r.itens.length ? el("div", { classe: "acoes" },
      el("button", { classe: "botao botao-primario", type: "button", aoClicar: () => { if (!voz.falar(falarTudo(r.itens))) avisar("Este navegador não tem leitura em voz.", "erro"); } }, icone("ouvir", 18), "Ouvir tudo"),
      el("button", { classe: "botao", type: "button", aoClicar: () => voz.parar() }, icone("parar", 16), "Parar"),
    ) : null,
  );
  if (r.offline) cabecalho.append(el("p", { classe: "selo" }, "sem internet · lista da cópia local"));

  const corpo = ordenados.length ? ordenados.map((g) => el("section", { classe: "grupo-pagina" },
    el("h2", {}, el("a", { href: `#/ler/${g.pagina_id}` }, `${g.rotulo}${g.nome ? " — " + g.nome : ""}`), el("small", {}, plural(g.itens.length, "item", "itens")),
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
  const campo = el("input", { type: "search", value: q, placeholder: "Palavra, expressão ou “art. 37”", "aria-label": "Buscar", autocomplete: "off" });
  const resultados = el("div", {});
  const buscar = async (termo) => {
    if (termo.trim().length < 2) { preencher(resultados, el("p", { classe: "vazio" }, "Digite pelo menos duas letras.")); return; }
    preencher(resultados, el("p", { classe: "vazio" }, "Buscando…"));
    try {
      let r;
      try { r = await api.get(`/api/v1/texto/busca${qs({ q: termo })}`); }
      catch (e) { if (e.status !== 0) throw e; r = await armazem.buscarLocal(termo); }
      const termos = termo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
      preencher(resultados,
        r.artigo ? el("a", { classe: "resultado", href: `#/ler/${r.artigo.pagina_id}?art=${encodeURIComponent(r.artigo.artigo_id)}`, style: "border-color: var(--acento)" },
          el("div", { classe: "onde" }, "Ir direto para"), el("div", { classe: "ref" }, `Artigo ${termo.replace(/\D+/g, "")}${/adct/i.test(termo) ? " do ADCT" : ""}`)) : null,
        el("p", { style: "color: var(--tinta-3)" }, (r.offline ? `Sem internet: buscando na cópia local (${plural(r.paginas, "página baixada", "páginas baixadas")}). ` : "") + (r.total ? `${plural(r.total, "dispositivo encontrado", "dispositivos encontrados")}${r.total > r.itens.length ? ` · mostrando ${r.itens.length}` : ""}` : "Nada encontrado com essas palavras.")),
        ...r.itens.map((i) => el("a", { classe: "resultado", href: `#/ler/${i.pagina_id}?d=${encodeURIComponent(i.dispositivo_id)}` },
          el("div", { classe: "onde" }, `${i.trilha} · ${i.pagina_rotulo}${i.pagina_nome ? " — " + i.pagina_nome : ""}`),
          el("div", { classe: "ref" }, i.dispositivo_rotulo ? `${i.artigo_rotulo}, ${i.dispositivo_rotulo}` : i.artigo_rotulo),
          el("div", { classe: "trecho" }, ...realcar(i.trecho, termos)),
        )),
      );
    } catch (e) { preencher(resultados, el("p", { classe: "vazio" }, e.message)); }
  };
  const form = el("form", { classe: "form", aoEnviar: (e) => { e.preventDefault(); irPara(`#/busca?q=${encodeURIComponent(campo.value)}`); } },
    el("div", { style: "display:flex; gap:.5rem" }, campo, el("button", { classe: "botao botao-primario", type: "submit" }, icone("buscar", 18), "Buscar")));
  campo.addEventListener("input", debounce(() => buscar(campo.value), 350));
  preencher(container, el("div", { classe: "tela" },
    el("div", { classe: "tela-cabecalho" }, el("div", {}, el("h1", {}, "Buscar no texto"), el("p", {}, "Sem acento, sem maiúscula: todas as palavras precisam aparecer no mesmo dispositivo."))),
    form, el("div", { style: "height: 1rem" }), resultados,
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
