/* ==========================================================================
   leitor.js — a página aberta do caderno: a folha com o texto, a tinta por
   cima, a marcação de trechos por seleção, as notas na margem, o estojo de
   ferramentas e a barra de leitura em voz.

   OFFLINE: toda leitura passa pelo armazém (rede → cópia local) e toda
   escrita muda o espelho local NA HORA e entra na fila de envio. A tela
   nunca espera o servidor para mostrar o que o estudante acabou de fazer.
   ========================================================================== */
import { el, preencher, icone, avisar, abrirModal, fecharModal, confirmar, paletaDeCores, CORES, ehClara, rotuloFalado, fmtRelativo, debounce } from "./ui.js";
import { Tinta } from "./tinta.js";
import * as voz from "./voz.js";
import * as armazem from "./armazem.js";
import { prefs, salvarPrefs, sumario } from "./app.js";

let estado = null;   // { pagina, marcacoes, notas, leitura, tinta, folha, leitor, estojo, barra, popover, painel }

const caminhoPagina = (id) => `/api/v1/paginas/${encodeURIComponent(id)}`;

export function limparLeitor() {
  if (!estado) return;
  voz.parar();
  estado.tinta?.destruir();
  estado.estojo?.remove();
  estado.barra?.remove();
  estado.painel?.remove();
  estado.popover?.remove();
  estado.menuOuvir?.remove();
  document.removeEventListener("selectionchange", estado.aoSelecionar);
  document.removeEventListener("pointerup", estado.aoSoltar);
  document.removeEventListener("click", estado.aoClicarFora, true);
  window.removeEventListener("scroll", estado.aoRolar);
  estado.cancelarVoz?.();
  document.getElementById("conteudo").classList.remove("leitura");
  document.getElementById("topo-titulo").replaceChildren();
  estado = null;
}

/* Antes de recarregar (atualização do app): a tinta ainda não enviada vai
   para a fila agora, sem esperar o temporizador. */
export async function salvarPendentes() {
  if (!estado?.tinta) return;
  await estado.tinta.enviarPendentes(true);
  persistir();
}

/* O espelho local desta página: é o que o tablet mostra sem internet. */
function persistir() {
  if (!estado) return;
  void armazem.guardarAnotacoes(estado.pagina.id, {
    pagina_id: estado.pagina.id, tracos: estado.tinta.tracos, marcacoes: estado.marcacoes, notas: estado.notas, leitura: estado.leitura,
  });
}

/* ============================ tela ============================ */
export async function telaLeitor(container, partes, query) {
  const paginaId = partes[0];
  const sentido = estado?.pagina?.proxima === paginaId ? "frente" : estado?.pagina?.anterior === paginaId ? "tras" : "frente";
  limparLeitor();
  container.classList.add("leitura");
  preencher(container, el("div", { classe: "vazio" }, "Abrindo a página…"));

  const [pagina, anot] = await Promise.all([armazem.lerPagina(paginaId), armazem.lerAnotacoes(paginaId)]);
  estado = { pagina, marcacoes: anot.marcacoes ?? [], notas: anot.notas ?? [], leitura: anot.leitura ?? null };

  /* cabeçalho do topo */
  preencher(document.getElementById("topo-titulo"),
    el("span", { classe: "trilha" }, pagina.trilha.slice(0, -1).map((t) => t.rotulo).join(" › ") || (pagina.livro === "adct" ? "ADCT" : "Constituição")),
    el("span", { classe: "nome" }, `${pagina.rotulo}${pagina.nome ? " — " + pagina.nome : ""}`),
  );

  const folha = el("article", { classe: `folha ${sentido === "tras" ? "virar-tras" : ""}` },
    el("div", { classe: "folha-trilha" }, pagina.trilha.map((t) => `${t.rotulo}${t.nome ? " · " + t.nome : ""}`).join("  ›  ")),
    el("header", { classe: "folha-titulo" },
      el("span", { classe: "rotulo" }, pagina.rotulo),
      el("h1", {}, pagina.nome || (pagina.livro === "adct" ? "Ato das Disposições Constitucionais Transitórias" : pagina.rotulo)),
      el("div", { classe: "fio" }),
    ),
    ...pagina.artigos.map((a) => renderArtigo(a)),
  );
  const leitor = el("div", { classe: "leitor" }, el("div", { classe: "folha-envelope" }, folha));
  preencher(container, leitor);
  estado.folha = folha;
  estado.leitor = leitor;

  /* tinta */
  const topo = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--topo")) || 56;
  estado.tinta = new Tinta({
    folha, topo,
    gerarId: armazem.novoIdLocal,
    aoGravar: async (tracos) => {
      void armazem.mutar({ metodo: "POST", caminho: `${caminhoPagina(pagina.id)}/tracos`, corpo: { tracos } });
      persistir();
      return tracos.map((t) => t.id);
    },
    aoApagar: async (ids) => {
      void armazem.mutar({ metodo: "POST", caminho: "/api/v1/tracos/apagar", corpo: { ids } });
      persistir();
    },
  });
  estado.tinta.cor = prefs().cor_caneta;
  estado.tinta.corMarcador = prefs().cor_marcador;
  estado.tinta.largura = Number(prefs().largura_caneta) || 2.2;
  estado.tinta.definirDedo(prefs().desenhar_com_dedo === "1");
  estado.tinta.carregar(anot.tracos ?? []);

  montarEstojo();
  montarBarra();
  ligarSelecao();
  ligarNotasPorToque();
  definirFerramenta(prefs().ferramenta && prefs().ferramenta !== "selecao" ? prefs().ferramenta : "mao");

  /* leitura: registra a visita e acompanha a posição (espelho + fila) */
  estado.leitura = { visitas: (estado.leitura?.visitas ?? 0) + 1, posicao: 0, ultima_em: new Date().toISOString() };
  persistir();
  void armazem.mutar({ metodo: "POST", caminho: `${caminhoPagina(pagina.id)}/leitura`, corpo: { posicao: 0, contar: true } });
  estado.aoRolar = debounce(() => {
    if (!estado) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pos = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    estado.leitura = { ...estado.leitura, posicao: pos, ultima_em: new Date().toISOString() };
    persistir();
    void armazem.mutar({ metodo: "POST", caminho: `${caminhoPagina(pagina.id)}/leitura`, corpo: { posicao: pos, contar: false }, chave: `leitura:${pagina.id}` });
  }, 1200);
  window.addEventListener("scroll", estado.aoRolar, { passive: true });

  /* posição inicial: artigo/dispositivo pedido, ou onde parou */
  requestAnimationFrame(() => {
    const alvoId = query.get("d") || query.get("art");
    if (alvoId) {
      const alvo = folha.querySelector(`[data-id="${CSS.escape(alvoId)}"], [data-artigo-id="${CSS.escape(alvoId)}"]`);
      if (alvo) { alvo.scrollIntoView({ block: "center" }); piscar(alvo); return; }
    }
    const pos = query.get("pos");
    if (pos !== null) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Number(pos) * max, behavior: "auto" });
    }
  });
}

function piscar(alvo) {
  alvo.classList.add("lendo");
  setTimeout(() => alvo.classList.remove("lendo"), 1800);
}

/* ============================ render ============================ */
function renderArtigo(a) {
  return el("section", { classe: "artigo", "data-artigo-id": a.id },
    el("button", { classe: "artigo-rotulo", type: "button", title: "Ouvir este artigo", "aria-label": `Ouvir ${a.rotulo}`, aoClicar: () => ouvirArtigo(a) }, a.rotulo, icone("ouvir", 16)),
    ...a.dispositivos.map((d) => renderBloco(a, d)),
  );
}

function renderBloco(a, d) {
  const disp = el("div", { classe: `dispositivo tipo-${d.tipo}`, "data-id": d.id, "data-artigo": a.id },
    d.rotulo ? el("span", { classe: "disp-rotulo" }, d.rotulo) : null,
    el("span", { classe: "disp-texto" }),
    ...(d.notas ?? []).map((n) => el("span", { classe: "disp-nota-editor" }, n)),
  );
  renderTexto(disp, d);
  const bloco = el("div", { classe: "bloco" }, disp);
  for (const n of estado.notas.filter((x) => x.dispositivo_id === d.id)) bloco.append(renderNota(n));
  return bloco;
}

function marcacoesDe(id) { return estado.marcacoes.filter((m) => m.dispositivo_id === id); }

/* O texto do dispositivo com as marcações aplicadas por intervalo. */
function renderTexto(disp, d) {
  const alvo = disp.querySelector(".disp-texto");
  const marcas = marcacoesDe(d.id);
  const texto = d.texto;
  if (!marcas.length) { alvo.replaceChildren(document.createTextNode(texto)); return; }
  const cortes = new Set([0, texto.length]);
  for (const m of marcas) { cortes.add(Math.max(0, Math.min(texto.length, m.inicio))); cortes.add(Math.max(0, Math.min(texto.length, m.fim))); }
  const pontos = [...cortes].sort((x, y) => x - y);
  const nos = [];
  for (let i = 0; i + 1 < pontos.length; i++) {
    const de = pontos[i], ate = pontos[i + 1];
    if (ate <= de) continue;
    const cobre = marcas.filter((m) => m.inicio <= de && m.fim >= ate);
    const pedaco = texto.slice(de, ate);
    if (!cobre.length) { nos.push(document.createTextNode(pedaco)); continue; }
    const m = cobre[cobre.length - 1];
    const escura = m.estilo === "marca" && !ehClara(m.cor);
    nos.push(el("mark", {
      classe: `marca estilo-${m.estilo} ${escura ? "escura" : ""} ${m.recente ? "recente" : ""}`, "data-marca-id": m.id, style: `--cor: ${m.cor}`,
      aoClicar: (e) => { e.stopPropagation(); abrirPopoverMarcacao(m, e.currentTarget); },
    }, pedaco));
  }
  alvo.replaceChildren(...nos);
}

function dispositivoPorId(id) {
  for (const a of estado.pagina.artigos) for (const d of a.dispositivos) if (d.id === id) return { artigo: a, dispositivo: d };
  return null;
}
function referenciaDe(id) {
  const r = dispositivoPorId(id);
  if (!r) return "";
  return r.dispositivo.rotulo ? `${r.artigo.rotulo}, ${r.dispositivo.rotulo}` : r.artigo.rotulo;
}

function renderNota(n) {
  const escura = !ehClara(n.cor);
  const card = el("aside", { classe: `nota-margem ${escura ? "escura" : ""}`, "data-nota-id": n.id, style: `--cor: ${n.cor}` },
    n.texto,
    el("div", { classe: "nota-acoes" },
      el("span", { classe: "nota-quando" }, fmtRelativo(n.atualizado_em)),
      el("span", { classe: "espaco" }),
      el("button", { classe: "botao-icone", type: "button", title: "Ouvir a nota", aoClicar: () => voz.falar([{ texto: n.texto, elemento: card }]) }, icone("ouvir", 16)),
      el("button", { classe: "botao-icone", type: "button", title: "Editar", aoClicar: () => modalNota(n.dispositivo_id, n) }, icone("caneta", 16)),
      el("button", { classe: "botao-icone", type: "button", title: "Apagar", aoClicar: () => confirmar("Apagar esta nota?", async () => {
        estado.notas = estado.notas.filter((x) => x.id !== n.id);
        persistir();
        void armazem.mutar({ metodo: "DELETE", caminho: `/api/v1/notas/${n.id}` });
        card.remove();
        avisar("Nota apagada.");
      }, "Apagar") }, icone("lixo", 16)),
    ),
  );
  return card;
}

/* ============================ estojo ============================ */
const FERRAMENTAS = [
  { chave: "mao", nome: "Ler e selecionar", icone: "mao" },
  { chave: "caneta", nome: "Caneta", icone: "caneta" },
  { chave: "marcador", nome: "Marca-texto", icone: "marcador" },
  { chave: "borracha", nome: "Borracha", icone: "borracha" },
  { chave: "nota", nome: "Nota (toque num trecho)", icone: "nota" },
];
const LARGURAS = [{ v: 1.4, nome: "Fina" }, { v: 2.4, nome: "Média" }, { v: 4.2, nome: "Grossa" }];

function montarEstojo() {
  const estojo = el("div", { classe: "estojo", role: "toolbar", "aria-label": "Ferramentas" });
  for (const f of FERRAMENTAS) {
    estojo.append(el("button", { classe: "ferramenta", type: "button", "data-ferramenta": f.chave, title: f.nome, "aria-label": f.nome, aoClicar: () => definirFerramenta(f.chave) },
      icone(f.icone, 22), (f.chave === "caneta" || f.chave === "marcador") ? el("span", { classe: "ponta" }) : null));
  }
  estojo.append(el("div", { classe: "separador" }));
  estojo.append(el("button", { classe: "cor-atual", type: "button", title: "Cores", "aria-label": "Escolher cor", aoClicar: (e) => abrirPainelCores(e.currentTarget) }));
  const larguras = el("div", { classe: "larguras" }, ...LARGURAS.map((l) => el("button", { classe: "largura", type: "button", "data-largura": l.v, title: l.nome, "aria-label": `Espessura ${l.nome}`, aoClicar: () => definirLargura(l.v) },
    el("i", { style: `height: ${l.v * 1.6}px` }))));
  estojo.append(larguras);
  estojo.append(el("div", { classe: "separador" }));
  estojo.append(el("button", { classe: "ferramenta pequena", type: "button", title: "Desfazer último traço", "aria-label": "Desfazer", aoClicar: () => { if (!estado.tinta.desfazerUltimo()) avisar("Nada para desfazer nesta sessão."); } }, icone("desfazer", 20)));
  estojo.append(el("button", { classe: "ferramenta pequena", type: "button", title: "Apagar toda a tinta desta página", "aria-label": "Limpar tinta da página", aoClicar: () => confirmar("Apagar TODOS os traços de caneta e marca-texto desta página? As marcações de trecho e as notas ficam.", async () => {
    estado.tinta.limparTudo();
    persistir();
    void armazem.mutar({ metodo: "DELETE", caminho: `${caminhoPagina(estado.pagina.id)}/tracos` });
    avisar("Tinta da página apagada.");
  }, "Apagar tudo") }, icone("lixo", 20)));
  document.body.append(estojo);
  estado.estojo = estojo;
  atualizarEstojo();
}

function atualizarEstojo() {
  const t = estado.tinta;
  const corAtiva = t.ferramenta === "marcador" ? t.corMarcador : t.cor;
  for (const b of estado.estojo.querySelectorAll(".ferramenta[data-ferramenta]")) b.classList.toggle("ativa", b.dataset.ferramenta === t.ferramenta);
  estado.estojo.querySelector('[data-ferramenta="caneta"] .ponta')?.style.setProperty("--cor", t.cor);
  estado.estojo.querySelector('[data-ferramenta="marcador"] .ponta')?.style.setProperty("--cor", t.corMarcador);
  estado.estojo.querySelector(".cor-atual").style.setProperty("--cor", corAtiva);
  for (const b of estado.estojo.querySelectorAll(".largura")) b.classList.toggle("ativa", Math.abs(Number(b.dataset.largura) - t.largura) < 0.01);
}

function definirFerramenta(f) {
  if (!estado) return;
  estado.tinta.definirFerramenta(f);
  estado.folha.classList.toggle("sem-selecao", f !== "mao");
  estado.folha.classList.toggle("modo-nota", f === "nota");
  if (f !== "nota") for (const d of estado.folha.querySelectorAll(".dispositivo.alvo-nota")) d.classList.remove("alvo-nota");
  fecharPopover();
  atualizarEstojo();
  void salvarPrefs({ ferramenta: f });
}
function definirLargura(v) {
  estado.tinta.largura = v;
  atualizarEstojo();
  void salvarPrefs({ largura_caneta: String(v) });
}

function abrirPainelCores(ancora) {
  fecharPainel();
  const t = estado.tinta;
  const marcador = t.ferramenta === "marcador";
  const painel = el("div", { classe: "painel-flutuante" },
    el("span", { classe: "paleta-titulo" }, marcador ? "Cor do marca-texto" : "Cor da caneta"),
    paletaDeCores(marcador ? t.corMarcador : t.cor, (hex) => {
      if (marcador) { t.corMarcador = hex; void salvarPrefs({ cor_marcador: hex }); }
      else { t.cor = hex; void salvarPrefs({ cor_caneta: hex }); }
      atualizarEstojo();
      fecharPainel();
    }, { pasteisPrimeiro: marcador }),
  );
  document.body.append(painel);
  posicionarJunto(painel, ancora);
  estado.painel = painel;
  estado.aoClicarFora = (e) => { if (!painel.contains(e.target) && e.target !== ancora) fecharPainel(); };
  setTimeout(() => document.addEventListener("click", estado.aoClicarFora, true), 0);
}
function fecharPainel() {
  if (!estado?.painel) return;
  estado.painel.remove();
  estado.painel = null;
  document.removeEventListener("click", estado.aoClicarFora, true);
}
function posicionarJunto(painel, ancora) {
  const r = ancora.getBoundingClientRect();
  const largo = window.innerWidth <= 760;
  painel.style.setProperty("left", "0px");
  painel.style.setProperty("top", "0px");
  const pr = painel.getBoundingClientRect();
  const esq = largo ? Math.max(8, Math.min(window.innerWidth - pr.width - 8, r.left + r.width / 2 - pr.width / 2)) : r.left - pr.width - 12;
  const topo = largo ? r.top - pr.height - 10 : Math.max(8, Math.min(window.innerHeight - pr.height - 8, r.top + r.height / 2 - pr.height / 2));
  painel.style.setProperty("left", `${esq}px`);
  painel.style.setProperty("top", `${topo}px`);
}

/* ============================ seleção de texto ============================ */
function ligarSelecao() {
  estado.aoSelecionar = debounce(() => { if (estado && estado.tinta.ferramenta === "mao") mostrarPopoverSelecao(); }, 260);
  estado.aoSoltar = () => { if (estado && estado.tinta.ferramenta === "mao") setTimeout(mostrarPopoverSelecao, 30); };
  document.addEventListener("selectionchange", estado.aoSelecionar);
  document.addEventListener("pointerup", estado.aoSoltar);
}

function intervalosDaSelecao() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  if (!estado.folha.contains(range.commonAncestorContainer)) return [];
  const saida = [];
  for (const disp of estado.folha.querySelectorAll(".dispositivo")) {
    const alvo = disp.querySelector(".disp-texto");
    if (!range.intersectsNode(alvo)) continue;
    const total = alvo.textContent.length;
    let inicio = 0, fim = total;
    const medir = (no, off) => { const r = document.createRange(); r.setStart(alvo, 0); r.setEnd(no, off); return r.toString().length; };
    if (alvo.contains(range.startContainer)) inicio = medir(range.startContainer, range.startOffset);
    if (alvo.contains(range.endContainer)) fim = medir(range.endContainer, range.endOffset);
    const texto = alvo.textContent;
    while (inicio < fim && /\s/.test(texto[inicio])) inicio += 1;
    while (fim > inicio && /\s/.test(texto[fim - 1])) fim -= 1;
    if (fim > inicio) saida.push({ dispositivo_id: disp.dataset.id, inicio, fim, trecho: texto.slice(inicio, fim), elemento: disp });
  }
  return saida;
}

/* Cria a marcação LOCALMENTE (id, trecho e data nascem aqui) e enfileira. */
function criarMarcacao(i, estilo, cor) {
  const agora = new Date().toISOString();
  const m = { id: armazem.novoIdLocal(), dispositivo_id: i.dispositivo_id, inicio: i.inicio, fim: i.fim, estilo, cor, trecho: i.trecho, criado_em: agora, recente: true };
  estado.marcacoes.push(m);
  persistir();
  void armazem.mutar({ metodo: "POST", caminho: `${caminhoPagina(estado.pagina.id)}/marcacoes`, corpo: { id: m.id, dispositivo_id: m.dispositivo_id, inicio: m.inicio, fim: m.fim, estilo, cor } });
  return m;
}

function mostrarPopoverSelecao() {
  if (!estado) return;
  const intervalos = intervalosDaSelecao();
  if (!intervalos.length) { if (estado.popover?.dataset.tipo === "selecao") fecharPopover(); return; }
  fecharPopover();
  const sel = window.getSelection();
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const criar = (estilo, cor) => () => {
    for (const i of intervalos) {
      criarMarcacao(i, estilo, cor);
      renderTexto(i.elemento, dispositivoPorId(i.dispositivo_id).dispositivo);
    }
    sel.removeAllRanges();
    fecharPopover();
    avisar(estilo === "marca" ? "Trecho marcado." : estilo === "sublinhado" ? "Trecho sublinhado." : "Trecho riscado.");
  };
  const pop = el("div", { classe: "popover-selecao", "data-tipo": "selecao", role: "toolbar" },
    ...CORES.pasteis.map((c) => el("button", { classe: "cor", type: "button", title: `Marcar em ${c.nome.toLowerCase()}`, style: `--cor: ${c.hex}`, aoClicar: criar("marca", c.hex) })),
    el("span", { classe: "divisor" }),
    el("button", { classe: "acao", type: "button", title: "Sublinhar com a cor da caneta", aoClicar: criar("sublinhado", estado.tinta.cor) }, "S̲"),
    el("button", { classe: "acao", type: "button", title: "Riscar com a cor da caneta", aoClicar: criar("riscado", estado.tinta.cor) }, "R̶"),
    el("span", { classe: "divisor" }),
    el("button", { classe: "acao icone-so", type: "button", title: "Ouvir o trecho", aoClicar: () => {
      voz.falar(intervalos.map((i) => ({ texto: i.trecho, elemento: i.elemento })));
      fecharPopover();
    } }, icone("ouvir", 18)),
    el("button", { classe: "acao icone-so", type: "button", title: "Escrever uma nota sobre o trecho", aoClicar: () => { const i = intervalos[0]; fecharPopover(); sel.removeAllRanges(); modalNota(i.dispositivo_id, null, i.trecho); } }, icone("nota", 18)),
  );
  posicionarPopover(pop, rect);
}

function posicionarPopover(pop, rect) {
  const lr = estado.leitor.getBoundingClientRect();
  estado.leitor.append(pop);
  const largura = pop.offsetWidth, altura = pop.offsetHeight;
  const x = rect.left + rect.width / 2 - lr.left - largura / 2;
  const y = rect.top - lr.top - altura - 12;
  pop.style.setProperty("left", `${Math.max(8, Math.min(lr.width - largura - 8, x))}px`);
  pop.style.setProperty("top", `${Math.max(8, y)}px`);
  estado.popover = pop;
}
function fecharPopover() {
  if (!estado?.popover) return;
  estado.popover.remove();
  estado.popover = null;
}

function abrirPopoverMarcacao(m, elMark) {
  if (estado.tinta.ferramenta !== "mao") return;
  fecharPopover();
  const rect = elMark.getBoundingClientRect();
  const disp = elMark.closest(".dispositivo");
  const r = dispositivoPorId(m.dispositivo_id);
  const mudar = (mudancas) => () => {
    Object.assign(m, mudancas);
    persistir();
    void armazem.mutar({ metodo: "PUT", caminho: `/api/v1/marcacoes/${m.id}`, corpo: mudancas, chave: `marcacao:${m.id}`, modo: "mesclar" });
    renderTexto(disp, r.dispositivo);
    fecharPopover();
  };
  const pop = el("div", { classe: "popover-selecao", "data-tipo": "marcacao", role: "toolbar" },
    ...CORES.pasteis.map((c) => el("button", { classe: "cor", type: "button", title: c.nome, style: `--cor: ${c.hex}`, aoClicar: mudar({ cor: c.hex, estilo: "marca" }) })),
    el("span", { classe: "divisor" }),
    el("button", { classe: "acao", type: "button", title: "Sublinhado", aoClicar: mudar({ estilo: "sublinhado", cor: ehClara(m.cor) ? estado.tinta.cor : m.cor }) }, "S̲"),
    el("button", { classe: "acao", type: "button", title: "Riscado", aoClicar: mudar({ estilo: "riscado", cor: ehClara(m.cor) ? estado.tinta.cor : m.cor }) }, "R̶"),
    el("span", { classe: "divisor" }),
    el("button", { classe: "acao icone-so", type: "button", title: "Ouvir", aoClicar: () => { voz.falar([{ texto: m.trecho, elemento: disp }]); fecharPopover(); } }, icone("ouvir", 18)),
    el("button", { classe: "acao icone-so", type: "button", title: "Nota sobre o trecho", aoClicar: () => { fecharPopover(); modalNota(m.dispositivo_id, null, m.trecho); } }, icone("nota", 18)),
    el("button", { classe: "acao icone-so", type: "button", title: "Remover marcação", aoClicar: () => {
      estado.marcacoes = estado.marcacoes.filter((x) => x.id !== m.id);
      persistir();
      void armazem.mutar({ metodo: "DELETE", caminho: `/api/v1/marcacoes/${m.id}` });
      renderTexto(disp, r.dispositivo);
      fecharPopover();
      avisar("Marcação removida.");
    } }, icone("lixo", 18)),
  );
  posicionarPopover(pop, rect);
  const fora = (e) => { if (!pop.contains(e.target)) { fecharPopover(); document.removeEventListener("pointerdown", fora, true); } };
  setTimeout(() => document.addEventListener("pointerdown", fora, true), 0);
}

/* ============================ notas ============================ */
function ligarNotasPorToque() {
  estado.folha.addEventListener("click", (e) => {
    if (!estado || estado.tinta.ferramenta !== "nota") return;
    const disp = e.target.closest(".dispositivo");
    if (!disp) return;
    modalNota(disp.dataset.id);
  });
  estado.folha.addEventListener("pointerover", (e) => {
    if (!estado || estado.tinta.ferramenta !== "nota") return;
    for (const d of estado.folha.querySelectorAll(".dispositivo.alvo-nota")) d.classList.remove("alvo-nota");
    e.target.closest(".dispositivo")?.classList.add("alvo-nota");
  });
}

function modalNota(dispositivoId, existente = null, trecho = "") {
  let cor = existente?.cor ?? CORES.pasteis[0].hex;
  const campo = el("textarea", { placeholder: trecho ? `Sobre: “${trecho.slice(0, 120)}${trecho.length > 120 ? "…" : ""}”` : "Escreva sua anotação…", maxlength: "5000" }, existente?.texto ?? "");
  const paleta = el("div");
  const montarPaleta = () => preencher(paleta, paletaDeCores(cor, (hex) => { cor = hex; montarPaleta(); }, { pasteisPrimeiro: true }));
  montarPaleta();
  const referencia = referenciaDe(dispositivoId);
  abrirModal(existente ? "Editar nota" : "Nova nota",
    el("div", { classe: "form" },
      el("p", { classe: "selo acento" }, referencia),
      trecho ? el("blockquote", { classe: "trecho", style: "margin: 0; padding: .5rem .8rem; border-left: 3px solid var(--ouro); color: var(--tinta-2); font-family: var(--serifa); font-size: .95rem" }, trecho) : null,
      el("label", {}, "Anotação", campo),
      paleta,
    ),
    [
      el("button", { classe: "botao", type: "button", aoClicar: fecharModal }, "Cancelar"),
      el("button", { classe: "botao botao-primario", type: "button", aoClicar: () => {
        const texto = campo.value.trim();
        if (!texto) { avisar("Escreva alguma coisa antes de salvar.", "erro"); campo.focus(); return; }
        const agora = new Date().toISOString();
        if (existente) {
          Object.assign(existente, { texto, cor, atualizado_em: agora });
          persistir();
          void armazem.mutar({ metodo: "PUT", caminho: `/api/v1/notas/${existente.id}`, corpo: { texto, cor }, chave: `nota:${existente.id}`, modo: "mesclar" });
          const antigo = estado.folha.querySelector(`[data-nota-id="${CSS.escape(existente.id)}"]`);
          antigo?.replaceWith(renderNota(existente));
        } else {
          const n = { id: armazem.novoIdLocal(), dispositivo_id: dispositivoId, texto, cor, criado_em: agora, atualizado_em: agora };
          estado.notas.push(n);
          persistir();
          void armazem.mutar({ metodo: "POST", caminho: `${caminhoPagina(estado.pagina.id)}/notas`, corpo: { id: n.id, dispositivo_id: dispositivoId, texto, cor } });
          const disp = estado.folha.querySelector(`[data-id="${CSS.escape(dispositivoId)}"]`);
          disp?.closest(".bloco")?.append(renderNota(n));
        }
        fecharModal();
        avisar("Nota salva.");
        if (!existente) definirFerramenta("mao");
      } }, "Salvar nota"),
    ]);
}

/* ============================ voz ============================ */
function itensDoArtigo(a) {
  const itens = [];
  for (const d of a.dispositivos) {
    const elx = estado.folha.querySelector(`[data-id="${CSS.escape(d.id)}"]`);
    const rotulo = d.tipo === "caput" ? rotuloFalado(a) : rotuloFalado(a, d);
    itens.push({ texto: `${rotulo}. ${d.texto}`, elemento: elx });
  }
  return itens;
}
function ouvirArtigo(a) {
  if (!voz.vozDisponivel()) return avisar("Este navegador não tem leitura em voz.", "erro");
  voz.falar(itensDoArtigo(a));
}
function ouvirPagina() {
  const itens = [{ texto: `${estado.pagina.rotulo}. ${estado.pagina.nome || ""}`, elemento: estado.folha.querySelector(".folha-titulo") }];
  for (const a of estado.pagina.artigos) itens.push(...itensDoArtigo(a));
  if (!voz.falar(itens)) avisar("Este navegador não tem leitura em voz.", "erro");
}
function ouvirAnotacoes() {
  const ordem = [];
  for (const a of estado.pagina.artigos) for (const d of a.dispositivos) ordem.push(d.id);
  const posicao = (id) => ordem.indexOf(id);
  const lista = [
    ...estado.marcacoes.map((m) => ({ pos: posicao(m.dispositivo_id), texto: `Trecho marcado em ${falarReferencia(m.dispositivo_id)}: ${m.trecho}`, id: m.dispositivo_id })),
    ...estado.notas.map((n) => ({ pos: posicao(n.dispositivo_id), texto: `Minha nota em ${falarReferencia(n.dispositivo_id)}: ${n.texto}`, id: n.dispositivo_id, notaId: n.id })),
  ].sort((x, y) => x.pos - y.pos);
  const itens = lista.map((i) => ({
    texto: i.texto,
    elemento: i.notaId ? estado.folha.querySelector(`[data-nota-id="${CSS.escape(i.notaId)}"]`) : estado.folha.querySelector(`[data-id="${CSS.escape(i.id)}"]`),
  }));
  if (!itens.length) return avisar("Esta página ainda não tem marcações nem notas.");
  if (!voz.falar(itens)) avisar("Este navegador não tem leitura em voz.", "erro");
}
function falarReferencia(id) {
  const r = dispositivoPorId(id);
  if (!r) return "";
  return r.dispositivo.tipo === "caput" ? rotuloFalado(r.artigo) : `${rotuloFalado(r.artigo)}, ${rotuloFalado(r.artigo, r.dispositivo)}`;
}

function montarBarra() {
  const s = sumario();
  const p = estado.pagina;
  const nomeDe = (id) => { const x = s?.paginas.find((q) => q.id === id); return x ? `${x.rotulo}${x.nome ? " · " + x.nome : ""}` : ""; };
  const anterior = el("a", { classe: `navegar ${p.anterior ? "" : "desligado"}`, href: p.anterior ? `#/ler/${p.anterior}` : "#", title: p.anterior ? nomeDe(p.anterior) : "" }, icone("anterior", 20), el("span", {}, p.anterior ? nomeDe(p.anterior) : "Início"));
  const proxima = el("a", { classe: `navegar proxima ${p.proxima ? "" : "desligado"}`, href: p.proxima ? `#/ler/${p.proxima}` : "#", title: p.proxima ? nomeDe(p.proxima) : "" }, el("span", {}, p.proxima ? nomeDe(p.proxima) : "Fim"), icone("proxima", 20));

  const botaoTocar = el("button", { classe: "botao-icone principal", type: "button", title: "Ouvir esta página", "aria-label": "Ouvir", aoClicar: () => {
    const e = voz.estadoDaVoz().estado;
    if (e === "parado") ouvirPagina();
    else voz.alternar();
  } }, icone("tocar", 20));
  const botaoParar = el("button", { classe: "botao-icone", type: "button", title: "Parar", "aria-label": "Parar leitura", aoClicar: () => voz.parar() }, icone("parar", 18));
  const progresso = el("span", { classe: "voz-progresso" }, "");
  const botaoMenu = el("button", { classe: "botao-icone", type: "button", title: "O que ouvir", "aria-label": "Opções de leitura", aoClicar: (e) => abrirMenuOuvir(e.currentTarget) }, icone("ouvir", 20));
  const controle = el("div", { classe: "voz-controle" }, botaoMenu, botaoTocar, botaoParar, progresso);

  const barra = el("div", { classe: "barra-leitura" }, anterior, el("div", { classe: "centro" }, controle), proxima);
  document.body.append(barra);
  estado.barra = barra;

  estado.cancelarVoz = voz.aoMudarVoz(({ estado: e, indice, total }) => {
    preencher(botaoTocar, icone(e === "falando" ? "pausar" : "tocar", 20));
    botaoTocar.classList.toggle("ativo", e !== "parado");
    botaoTocar.title = e === "parado" ? "Ouvir esta página" : e === "falando" ? "Pausar" : "Continuar";
    progresso.textContent = e === "parado" ? "" : `${Math.min(indice + 1, total)}/${total}`;
  });
}

function abrirMenuOuvir(ancora) {
  if (estado.menuOuvir) { estado.menuOuvir.remove(); estado.menuOuvir = null; return; }
  const intervalos = estado.tinta.ferramenta === "mao" ? intervalosDaSelecao() : [];
  const item = (rotulo, sub, fn) => el("button", { type: "button", aoClicar: () => { fecharMenu(); fn(); } }, icone("ouvir", 18), el("span", {}, rotulo, el("small", {}, sub)));
  const menu = el("div", { classe: "menu-ouvir" },
    el("div", { classe: "titulo" }, "Ouvir"),
    item("Esta página inteira", `${estado.pagina.artigos.length} artigo(s), texto original`, () => ouvirPagina()),
    intervalos.length ? item("O trecho selecionado", intervalos.map((i) => i.trecho).join(" ").slice(0, 60) + "…", () => voz.falar(intervalos.map((i) => ({ texto: i.trecho, elemento: i.elemento })))) : null,
    item("Minhas anotações desta página", `${estado.marcacoes.length} marcação(ões) e ${estado.notas.length} nota(s)`, () => ouvirAnotacoes()),
    el("div", { classe: "titulo" }, "Ou toque no número de um artigo para ouvir só ele."),
  );
  document.body.append(menu);
  const r = ancora.getBoundingClientRect();
  menu.style.setProperty("left", `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left + r.width / 2 - menu.offsetWidth / 2))}px`);
  menu.style.setProperty("top", `${r.top - menu.offsetHeight - 10}px`);
  estado.menuOuvir = menu;
  const fecharMenu = () => { menu.remove(); if (estado) estado.menuOuvir = null; document.removeEventListener("pointerdown", fora, true); };
  const fora = (e) => { if (!menu.contains(e.target) && e.target !== ancora) fecharMenu(); };
  setTimeout(() => document.addEventListener("pointerdown", fora, true), 0);
}
