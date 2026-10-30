/* ==========================================================================
   analisar.ts — dos blocos do Planalto para a OBRA estruturada do LA Carta
   (mesmo formato do conteudo/cf88.json: sumário em árvore + páginas com
   artigos e dispositivos).

   IDS ESTÁVEIS POR CAMINHO. O id de um dispositivo descreve onde ele está
   na lei, não a ordem em que apareceu:

       cp-art-121-p2-i6        art. 121, § 2º, inciso VI
       cc-art-1639-caput       art. 1.639, caput
       clt-art-58-a-p1         art. 58-A, § 1º

   Uma lei nova que acrescente o inciso VI-A não desloca nenhum id vizinho:
   as anotações (tinta, marcações, notas) continuam no dispositivo certo
   depois de cada atualização do texto.

   A PÁGINA é o cabeçalho mais fundo que contém artigos (seção, capítulo,
   título…). Lei sem cabeçalhos é fatiada por FAIXA DE NÚMERO de artigo
   (1–15, 16–30…), que também não muda quando entra um "5-A".
   ========================================================================== */
import type { Bloco } from "./html.ts";

export interface Dispositivo { id: string; tipo: "caput" | "paragrafo" | "inciso" | "alinea" | "item" | "pena" | "rubrica" | "citacao"; rotulo: string; texto: string; notas?: string[] }
export interface Artigo { id: string; rotulo: string; numero: number; sufixo: string; rubrica?: string; dispositivos: Dispositivo[] }
export interface Pagina {
  id: string; livro: string; ordem: number; trilha: Array<{ rotulo: string; nome: string }>;
  rotulo: string; nome: string; artigos: Artigo[]; palavras: number; anterior: string | null; proxima: string | null;
}
export interface NoSumario { id: string; tipo: string; rotulo: string; nome: string; pagina?: string; filhos: NoSumario[] }
export interface MetaObra { id: string; sigla: string; nome: string; identificacao: string; categoria: string }
export interface Obra extends MetaObra {
  ementa: string; fonte: string; url: string; baixado_em: string; atualizado_ate: string;
  sumario: NoSumario[]; paginas: Pagina[];
}
export interface Relatorio { artigos: number; dispositivos: number; paginas: number; ultimoArtigo: number; avisos: string[] }

const ARTIGOS_POR_FAIXA = 15;

/* ---------- texto ---------- */
const CHAVES_NOTA = "Reda[cç][aã]o|Inclu[ií]d|Revogad|Vide|Vig[eê]ncia|Regulament|Renumerad|Acrescid|Acrescentad|Produ[cç][aã]o de efeito|Promulga[cç]|Mensagem de veto|Express[aã]o|Suprimid|Restabelecid|Revigorad|Convers[aã]o|Publica[cç][aã]o|Refer[eê]ncia|Alterad|Substitu[ií]d|Transformad|Prorroga|Partes? vetad|Veto rejeitad|Manti";
const RE_NOTA = new RegExp(`\\((?:${CHAVES_NOTA})[^()]*(?:\\([^()]*\\)[^()]*)*\\)`, "gi");
/* nota que o Planalto esqueceu de fechar: "(Incluída pelo Decreto-lei nº 1.535, de 13.4.1977" */
const RE_NOTA_ABERTA = new RegExp(`\\((?:${CHAVES_NOTA})[^()]*$`, "i");

export function limpar(t: string): string {
  return t.replace(/[    ]/g, " ").replace(/­/g, "").replace(/\s+/g, " ")
    .replace(/\s+([,;.:!?)])/g, "$1").replace(/\(\s+/g, "(").replace(/(\d)\s+([ºª°])/g, "$1$2").trim();
}

/* Tira as notas de alteração do texto e as devolve à parte. */
export function separarNotas(t: string): { texto: string; notas: string[] } {
  const notas: string[] = [];
  let texto = t.replace(RE_NOTA, (n) => { notas.push(limpar(n.slice(1, -1))); return " "; });
  texto = texto.replace(RE_NOTA_ABERTA, (n) => { notas.push(limpar(n.slice(1))); return " "; });
  texto = limpar(texto).replace(/\s+Vig[eê]ncia$/i, "");
  if (/^[\s.;:,\-–—]*$/.test(texto) && notas.length) {
    const rev = notas.find((n) => /^Revogad/i.test(n));
    texto = rev ? `(${rev})` : "";
  }
  return { texto, notas };
}

const MIUDAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "à", "às", "ao", "aos", "por", "para", "com", "contra", "sobre", "entre", "sem", "ou", "que", "se", "sob", "pelo", "pela", "pelos", "pelas", "um", "uma"]);
/* "DOS CRIMES CONTRA A VIDA" → "Dos Crimes contra a Vida" (só mexe no que veio em caixa alta). */
export function capitalizar(nome: string): string {
  const letras = nome.replace(/[^A-Za-zÀ-ú]/g, "");
  if (!letras || letras !== letras.toUpperCase()) return nome;
  return nome.toLowerCase().split(/(\s+|-)/).map((p, i) => {
    if (!/[a-zà-ú]/.test(p)) return p;
    if (i > 0 && MIUDAS.has(p)) return p;
    if (/^[ivxlcdm]+$/.test(p) && p.length <= 4 && i > 0) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join("");
}

const ROMANOS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
export function romano(r: string): number {
  let total = 0, anterior = 0;
  for (const ch of r.toUpperCase().split("").reverse()) {
    const v = ROMANOS[ch] ?? 0;
    total = v < anterior ? total - v : total + v;
    anterior = Math.max(anterior, v);
  }
  return total;
}

const ROMANO = "[IVXLCDM]+";
const ORD = "(?:º|°|o(?=[\\s.\\-–—:]|$))?";
/* O sufixo ("121-A", "359-M-A", "5º-A") vem COLADO ao número. Em
   "Art. 3º - A lei excepcional…" o A é a primeira palavra do texto: aceitar
   espaço ali transformava o art. 3º em "3-A" e sumia com ele da sequência. */
const SUF = "(?:-([A-Z]{1,2}(?:-[A-Z])?)(?![A-Za-zÀ-ú]))?";
const RE_ARTIGO = new RegExp(`^Art(?:igo)?[\\s.\\-–]*(\\d{1,4}(?:\\.\\d{3})?)\\s*${ORD}${SUF}\\s*[.\\-–—:]?\\s*(.*)$`, "s");
const RE_ARTIGOS = /^Arts?[\s.]*(\d{1,4}(?:\.\d{3})?)\s*(?:º|°|o)?\s*\.?\s*(?:a|ao|e|at[eé])\s+(\d{1,4}(?:\.\d{3})?)\s*(?:º|°|o)?\s*[.\-–—:]?\s*(.*)$/s;
const RE_PARAGRAFO = new RegExp(`^§\\s*(\\d{1,3})\\s*${ORD}(?:-([A-Z])(?![A-Za-zÀ-ú]))?\\s*[.\\-–—:]?\\s*(.*)$`, "s");
const RE_PAR_UNICO = /^(?:Par[aá]grafo\s+[uú]nico|§\s*[uú]nico)\s*[.\-–—:]?\s*(.*)$/is;
const RE_INCISO = new RegExp(`^(${ROMANO})(?:-([A-Z]))?\\s*[-–—]\\s*(.*)$`, "s");
const RE_ALINEA = /^([a-z]{1,2})\)\s*(.*)$/s;
const RE_ITEM = /^(\d{1,2})\s*(?:[.)]|\s[-–—])\s+(.*)$/s;
const RE_PENA = /^(Penas?)\s*[-–—:]\s*(.*)$/is;
const RE_FIM = /^(?:Bras[ií]lia|Rio de Janeiro|Senado Federal|Capital Federal|Distrito Federal|Pal[aá]cio)[^.]{0,40}?\b\d{1,2}\s*[ºo°]?\s+de\s+[a-zç]+\s+de\s+\d{4}/i;
const RE_FIM2 = /^Este texto n[aã]o substitui/i;

const TIPOS_CAB = ["parte", "livro", "titulo", "subtitulo", "capitulo", "secao", "subsecao"] as const;
type TipoCab = typeof TIPOS_CAB[number];
const NOME_CAB: Record<TipoCab, string> = { parte: "Parte", livro: "Livro", titulo: "Título", subtitulo: "Subtítulo", capitulo: "Capítulo", secao: "Seção", subsecao: "Subseção" };
const SLUG_CAB: Record<TipoCab, string> = { parte: "p", livro: "l", titulo: "t", subtitulo: "st", capitulo: "c", secao: "s", subsecao: "ss" };
const RE_CAB = /^(PARTE|LIVRO|SUBT[ÍI]TULO|T[ÍI]TULO|CAP[ÍI]TULO|SUBSE[ÇC][ÃA]O|SE[ÇC][ÃA]O)\s+([IVXLCDM]+(?:\s*-\s*[A-Z])?|[ÚU]NIC[OA]|GERAL|ESPECIAL|PRELIMINAR|COMPLEMENTAR|PRIMEIR[OA]|SEGUND[OA]|TERCEIR[OA]|QUART[OA]|QUINT[OA])(?![A-Za-zÀ-ú])\s*[-–—.:]?\s*(.*)$/i;

function semAcento(t: string): string { return t.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function slug(t: string): string { return semAcento(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function emCaixaAlta(t: string): boolean { const l = t.replace(/[^A-Za-zÀ-ú]/g, ""); return l.length > 2 && l === l.toUpperCase(); }

/* "P A R T E   G E R A L" → "PARTE GERAL" */
function juntarEspacado(l: string): string {
  if (!/^(?:\S\s){3,}/.test(l)) return l;
  /* o HTML já chega com os espaços colapsados: "P A R T E G E R A L" — a
     fronteira entre as palavras se perdeu, e só as conhecidas voltam */
  if (/^(?:\S\s)+\S$/.test(l)) return l.replace(/\s/g, "").replace(/^(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO)(?=[A-ZÀ-Ú])/, "$1 ");
  return l.split(/\s{2,}/).map((p) => p.replace(/\s/g, "")).join(" ");
}

interface Cab { tipo: TipoCab; numero: string; nome: string }
function cabecalho(linha: string, centralizado: boolean): Cab | null {
  const l = juntarEspacado(linha.trim());
  const m = RE_CAB.exec(l);
  if (!m) return null;
  if (!centralizado && l.length > 90) return null;
  const palavra = semAcento(m[1]!).toUpperCase();
  const tipo: TipoCab = palavra === "PARTE" ? "parte" : palavra === "LIVRO" ? "livro" : palavra === "TITULO" ? "titulo" : palavra === "SUBTITULO" ? "subtitulo" : palavra === "CAPITULO" ? "capitulo" : palavra === "SECAO" ? "secao" : "subsecao";
  let numero = m[2]!.replace(/\s+/g, "");
  if (/^[ivxlcdm]+/.test(numero) && !/^[IVXLCDM]+/.test(numero)) return null;       // "título i" minúsculo não é cabeçalho
  if (!/^[IVXLCDM]+(-[A-Z])?$/.test(numero)) numero = numero.charAt(0).toUpperCase() + numero.slice(1).toLowerCase();
  const resto = separarNotas(m[3] ?? "").texto;
  /* "Capítulo I desta Lei aplica-se…" é frase, não cabeçalho. */
  if (!centralizado && resto && /^(dest[ea]|d[oa]s?|a que|deste)\b/i.test(resto) && resto.length > 40) return null;
  return { tipo, numero, nome: resto };
}

function rotuloArtigo(numero: number, sufixo: string): string {
  const n = numero >= 1000 ? `${Math.floor(numero / 1000)}.${String(numero % 1000).padStart(3, "0")}` : String(numero);
  return `Art. ${n}${numero < 10 ? "º" : ""}${sufixo ? "-" + sufixo : ""}`;
}

interface No { id: string; tipo: string; nivel: number; rotulo: string; nome: string; slug: string; filhos: No[]; pagina: Pagina | null; preliminar?: boolean }

export function analisar(meta: MetaObra, blocosDaPagina: Bloco[], origem: { url: string; baixadoEm: string }): { obra: Obra; relatorio: Relatorio } {
  const avisos: string[] = [];
  const B = blocosDaPagina;

  /* ---------- onde a lei começa e termina ---------- */
  const ehFim = (b: Bloco) => RE_FIM.test(b.texto) || RE_FIM2.test(b.texto);
  const primeiros: number[] = [];
  B.forEach((b, i) => { const m = RE_ARTIGO.exec(b.texto); if (m && m[1] === "1" && !m[2] && !RE_ARTIGOS.test(b.texto)) primeiros.push(i); });
  if (!primeiros.length) throw new Error("não encontrei o Art. 1º");
  /* Mais de um "Art. 1º" (o decreto que aprova a CLT, lei citada entre aspas):
     vale o que abre a corrida mais longa de artigos até a assinatura. */
  let inicio = primeiros[0]!, melhor = -1;
  for (const p of primeiros) {
    let n = 0;
    for (let i = p; i < B.length && !(i > p && ehFim(B[i]!)); i++) if (RE_ARTIGO.test(B[i]!.texto)) n += 1;
    if (n > melhor) { melhor = n; inicio = p; }
  }
  const artigo1 = inicio;
  while (inicio > 0) {
    const ant = B[inicio - 1]!;
    const ehCab = ant.linhas.some((l) => cabecalho(l, ant.centralizado));
    if (ehCab || (ant.centralizado && ant.texto.length < 160 && !/Presidente da Rep|Fa[cç]o saber|decreta/i.test(ant.texto))) inicio -= 1;
    else if (!ant.centralizado && ant.texto.length < 90 && !/[.;:,]$/.test(ant.texto) && !/Presidente da Rep|Fa[cç]o saber|decreta/i.test(ant.texto) && artigo1 - inicio < 2) inicio -= 1;   // rubrica do art. 1º
    else break;
    if (artigo1 - inicio > 12) break;
  }
  let fim = B.length;
  for (let i = artigo1 + 1; i < B.length; i++) {
    if (ehFim(B[i]!)) { fim = i; break; }
  }

  /* ementa: o bloco curto que descreve a lei, antes do preâmbulo */
  let ementa = "";
  for (let i = 0; i < artigo1; i++) {
    const t = B[i]!.texto;
    if (/^(Disp[oõ]e|Institui|Regula|Aprova|Altera|Define|Estabelece|Cria|Consolida|Mant[eé]m|Reprime|Coibe|Tipifica)/i.test(t) && t.length > 16 && t.length < 500) {
      /* "Regulamento (Vide Decreto…)" é link do cabeçalho, não a ementa */
      const limpa = separarNotas(t).texto;
      if (limpa.length > 16 && !/^Regulament/i.test(limpa)) { ementa = limpa; break; }
    }
  }

  /* tem cabeçalho formal? senão, bloco centralizado vira seção livre */
  const temCabecalho = B.slice(inicio, fim).some((b) => b.linhas.some((l) => cabecalho(l, b.centralizado)));

  /* ---------- montagem ---------- */
  const paginas: Pagina[] = [];
  const raiz: No[] = [];
  const pilha: No[] = [];
  const idsPagina = new Set<string>();
  const idsDisp = new Set<string>();
  const idsArt = new Set<string>();
  let artigo: Artigo | null = null;
  let disp: Dispositivo | null = null;
  let ctx = { par: "", inc: "", ali: "" };
  let aguardandoNome: No | null = null;
  let rubricaPendente = "";
  let livres = 0;
  let rubricasNoArtigo = 0;
  let ultimoNumero = 0;
  let maisRecente = { ano: 0, numero: 0, texto: "" };

  const unico = (conjunto: Set<string>, id: string, oQue: string): string => {
    if (!conjunto.has(id)) { conjunto.add(id); return id; }
    let n = 2;
    while (conjunto.has(`${id}-v${n}`)) n += 1;
    avisos.push(`${oQue} repetido: ${id} → ${id}-v${n}`);
    conjunto.add(`${id}-v${n}`);
    return `${id}-v${n}`;
  };

  const novaPagina = (no: No | null, id: string, rotulo: string, nome: string, trilha: Array<{ rotulo: string; nome: string }>): Pagina => {
    const p: Pagina = { id: unico(idsPagina, id, "página"), livro: meta.id, ordem: paginas.length + 1, trilha, rotulo, nome, artigos: [], palavras: 0, anterior: null, proxima: null };
    paginas.push(p);
    if (no) no.pagina = p;
    return p;
  };

  const abrirCabecalho = (tipo: string, nivel: number, rotulo: string, nome: string, s: string): No => {
    while (pilha.length && pilha[pilha.length - 1]!.nivel >= nivel) pilha.pop();
    const pai = pilha[pilha.length - 1];
    if (pai?.pagina && pai.pagina.artigos.length) pai.preliminar = true;
    const no: No = { id: "", tipo, nivel, rotulo, nome, slug: s, filhos: [], pagina: null };
    (pai ? pai.filhos : raiz).push(no);
    pilha.push(no);
    no.id = [meta.id, ...pilha.map((n) => n.slug)].join("-");
    artigo = null; disp = null;
    rubricaPendente = "";
    return no;
  };

  const paginaDoArtigo = (numero: number): Pagina => {
    const no = pilha[pilha.length - 1];
    if (no) {
      if (!no.pagina) novaPagina(no, [meta.id, ...pilha.map((n) => n.slug)].join("-"), no.rotulo, no.nome, []);
      return no.pagina!;
    }
    /* lei sem cabeçalho: faixas por número de artigo */
    const base = Math.floor((Math.max(1, numero) - 1) / ARTIGOS_POR_FAIXA) * ARTIGOS_POR_FAIXA + 1;
    const id = `${meta.id}-a${base}`;
    const existente = paginas.find((p) => p.id === id);
    if (existente) return existente;
    const rot = `Arts. ${base}${base < 10 ? "º" : ""} a ${base + ARTIGOS_POR_FAIXA - 1}`;
    const p = novaPagina(null, id, rot, "", []);
    raiz.push({ id, tipo: "bloco", nivel: 9, rotulo: rot, nome: "", slug: id, filhos: [], pagina: p });
    return p;
  };

  const novoDispositivo = (tipo: Dispositivo["tipo"], rotulo: string, bruto: string, idBase: string): Dispositivo => {
    const { texto, notas } = separarNotas(bruto);
    for (const n of notas) {
      const m = /(\d{4})\D*$/.exec(n);
      const ano = m ? Number(m[1]) : 0;
      /* no mesmo ano, vale a lei de MAIOR número (a mais recente); "Vide…" não é alteração */
      const numero = Number((/n[ºo°]\s*([\d.]+)/i.exec(n)?.[1] ?? "0").replace(/\./g, "")) || 0;
      const maisNova = ano > maisRecente.ano || (ano === maisRecente.ano && numero > maisRecente.numero);
      if (maisNova && ano <= new Date().getFullYear() && /^(?:Reda[cç][aã]o dada|Inclu[ií]d|Revogad|Acrescid|Renumerad|Alterad)/i.test(n) && /Lei|Emenda|Medida|Decreto/i.test(n)) {
        maisRecente = { ano, numero, texto: n.replace(/^.*?\b(?:pela|pelo)\s+/i, "") };
      }
    }
    const d: Dispositivo = { id: unico(idsDisp, idBase, "dispositivo"), tipo, rotulo, texto };
    if (notas.length) d.notas = notas;
    artigo!.dispositivos.push(d);
    disp = d;
    return d;
  };

  const soltarRubrica = (base: string) => {
    if (!rubricaPendente) return;
    rubricasNoArtigo += 1;
    novoDispositivo("rubrica", "", rubricaPendente, `${base}-r`);
    rubricaPendente = "";
  };

  const abreDispositivo = (t: string): boolean => RE_ARTIGO.test(t) || RE_PARAGRAFO.test(t) || RE_PAR_UNICO.test(t) || RE_INCISO.test(t);

  /* ---------- lei que altera outra: o texto CITADO não é artigo desta lei ----------
     "Art. 6º Os arts. 157 e 159 do Código Penal passam a vigorar com a
     seguinte redação: Art. 157. …" — o Planalto nem sempre põe as aspas.
     Um "Art. N" só é desta lei se continua a sequência dela; o resto é
     citação e fica dentro do artigo que a introduz. */
  const ocorrencias = new Map<number, number[]>();
  B.forEach((b, i) => {
    const m = RE_ARTIGO.exec(limpar(b.texto));
    if (m && !m[2] && i >= inicio && i < fim) { const n = Number(m[1]!.replace(".", "")); ocorrencias.set(n, [...(ocorrencias.get(n) ?? []), i]); }
  });
  const apareceDepois = (numero: number, i: number): boolean => (ocorrencias.get(numero) ?? []).some((x) => x > i);
  const RE_ALTERA = /(passam?|passar[áa]|passar[ãa]o) a (vigorar|ter)|seguintes? (reda[cç][aã]o|altera[cç][oõ]es|modifica[cç][oõ]es|acr[eé]scimos)|acrescid[oa]s? d[oea]s?|fica(m)? acrescid|acrescentad[oa]s? (os|as|o|a) seguinte|com as altera[cç][oõ]es seguintes|nova reda[cç][aã]o/i;
  let citando = false;
  let citacoes = 0;
  const alterando = (): boolean => !!artigo && RE_ALTERA.test(artigo.dispositivos.filter((d) => d.tipo !== "citacao").map((d) => d.texto).join(" "));
  const ehDestaLei = (numero: number, sufixo: string, i: number): boolean => {
    if (ultimoNumero === 0) return true;
    const emAlteracao = citando || alterando();
    if (sufixo) return numero === ultimoNumero || (numero === ultimoNumero + 1 && !emAlteracao);
    if (numero === ultimoNumero + 1) return !(emAlteracao && apareceDepois(numero, i));
    if (numero > ultimoNumero + 1) return !apareceDepois(ultimoNumero + 1, i) && !(emAlteracao && apareceDepois(numero, i));
    return !emAlteracao;      // número repetido ou menor: só é citação se o artigo atual está alterando outra lei
  };
  const citar = (t: string) => {
    if (!artigo) return;
    citando = true;
    citacoes += 1;
    const { texto, notas } = separarNotas(t);
    if (!texto) return;
    const d: Dispositivo = { id: unico(idsDisp, `${artigo.id}-q${artigo.dispositivos.filter((x) => x.tipo === "citacao").length + 1}`, "dispositivo"), tipo: "citacao", rotulo: "", texto };
    if (notas.length) d.notas = notas;
    artigo.dispositivos.push(d);
    disp = d;
  };

  for (let i = inicio; i < fim; i++) {
    const b = B[i]!;
    const t = limpar(b.texto);
    if (!t) continue;

    /* ----- cabeçalho formal: cada linha do bloco é cabeçalho novo ou o nome do último ----- */
    if (citando && cabecalho(b.linhas[0]!, b.centralizado)) { citar(t); continue; }
    if (cabecalho(b.linhas[0]!, b.centralizado)) {
      let ultimo: No | null = null;
      for (const l of b.linhas) {
        const c = cabecalho(l, b.centralizado);
        if (c) {
          ultimo = abrirCabecalho(c.tipo, TIPOS_CAB.indexOf(c.tipo), `${NOME_CAB[c.tipo]} ${c.numero}`, capitalizar(c.nome), `${SLUG_CAB[c.tipo]}${slug(c.numero)}`);
        } else if (ultimo) {
          const extra = separarNotas(l).texto;
          if (extra) ultimo.nome = limpar(`${ultimo.nome} ${capitalizar(extra)}`);
        }
      }
      aguardandoNome = ultimo && !ultimo.nome ? ultimo : null;
      continue;
    }

    /* ----- faixa de artigos ("Arts. 1.621 a 1.629. (Revogados)") ----- */
    const mf = RE_ARTIGOS.exec(t);
    if (mf && citando) { citar(t); continue; }
    if (mf) {
      aguardandoNome = null;
      const de = Number(mf[1]!.replace(".", "")), ate = Number(mf[2]!.replace(".", ""));
      if (ate > de && ate - de < 400) {
        ultimoNumero = Math.max(ultimoNumero, ate);
        const pagina = paginaDoArtigo(de);
        const idArt = unico(idsArt, `${meta.id}-art-${de}-${ate}`, "artigo");
        artigo = { id: idArt, rotulo: `Arts. ${rotuloArtigo(de, "").slice(5)} a ${rotuloArtigo(ate, "").slice(5)}`, numero: de, sufixo: "", dispositivos: [] };
        rubricaPendente = "";
        rubricasNoArtigo = 0;
        pagina.artigos.push(artigo);
        ctx = { par: "", inc: "", ali: "" };
        novoDispositivo("caput", "", mf[3] ?? "", `${idArt}-caput`);
        continue;
      }
    }

    /* ----- artigo ----- */
    const ma = RE_ARTIGO.exec(t);
    if (ma && artigo && !ehDestaLei(Number(ma[1]!.replace(".", "")), ma[2] ?? "", i)) {
      citar(t);
      continue;
    }
    if (ma) {
      citando = false;
      aguardandoNome = null;
      const numero = Number(ma[1]!.replace(".", ""));
      const sufixo = ma[2] ?? "";
      if (!sufixo && numero < ultimoNumero - 2 && numero !== 1) avisos.push(`artigo fora de ordem: ${numero} depois de ${ultimoNumero}`);
      if (!sufixo && numero > ultimoNumero + 1 && ultimoNumero > 0) avisos.push(`salto de artigos: ${ultimoNumero} → ${numero}`);
      if (!sufixo) ultimoNumero = Math.max(ultimoNumero, numero);
      const pagina = paginaDoArtigo(numero);
      const idArt = unico(idsArt, `${meta.id}-art-${numero}${sufixo ? "-" + sufixo.toLowerCase() : ""}`, "artigo");
      artigo = { id: idArt, rotulo: rotuloArtigo(numero, sufixo), numero, sufixo, dispositivos: [] };
      if (rubricaPendente) { artigo.rubrica = rubricaPendente; rubricaPendente = ""; }
      rubricasNoArtigo = 0;
      pagina.artigos.push(artigo);
      ctx = { par: "", inc: "", ali: "" };
      novoDispositivo("caput", "", ma[3] ?? "", `${idArt}-caput`);
      continue;
    }

    const semNotas = separarNotas(t).texto;

    /* dentro de uma citação, tudo é citação até o próximo artigo desta lei;
       e bloco que abre aspas num artigo que altera outra lei começa uma */
    if (citando || (/^["“”'‘«]/.test(t) && alterando())) { citar(t); continue; }

    /* ----- nome de cabeçalho que veio em bloco próprio (centralizado ou em caixa alta) ----- */
    if (aguardandoNome) {
      if (!semNotas) continue;                                   // só a nota "(Redação dada…)": o nome ainda vem
      if ((b.centralizado || emCaixaAlta(semNotas)) && !abreDispositivo(t) && semNotas.length < 240) {
        const alvo: No = aguardandoNome;
        alvo.nome = limpar(`${alvo.nome} ${capitalizar(semNotas)}`);
        aguardandoNome = null;
        continue;
      }
      aguardandoNome = null;
    }
    if (!semNotas) continue;

    /* ----- seção livre (lei sem cabeçalhos formais) ----- */
    if (b.centralizado && !temCabecalho && semNotas.length < 160 && !/[.;:]$/.test(semNotas) && !abreDispositivo(t)) {
      livres += 1;
      abrirCabecalho("secao", 4, capitalizar(semNotas), "", `g${livres}`);
      continue;
    }

    /* ----- rubrica: título curto logo antes de artigo, parágrafo ou inciso ----- */
    const prox = B.slice(i + 1, fim).find((x) => limpar(x.texto));
    const proxTexto = prox ? limpar(prox.texto) : "";
    if (semNotas.length <= 110 && !/[.;:,]$/.test(semNotas) && !abreDispositivo(t) && !RE_ALINEA.test(t) && !RE_PENA.test(t) && abreDispositivo(proxTexto)) {
      rubricaPendente = capitalizar(semNotas);
      continue;
    }

    if (!artigo) continue;
    const art: Artigo = artigo;

    const mp = RE_PARAGRAFO.exec(t);
    if (mp) {
      const n = Number(mp[1]), suf = mp[2] ?? "";
      ctx = { par: `${art.id}-p${n}${suf ? "-" + suf.toLowerCase() : ""}`, inc: "", ali: "" };
      soltarRubrica(ctx.par);
      novoDispositivo("paragrafo", `§ ${n}${n < 10 ? "º" : ""}${suf ? "-" + suf : ""}`, mp[3] ?? "", ctx.par);
      continue;
    }
    const mu = RE_PAR_UNICO.exec(t);
    if (mu) {
      ctx = { par: `${art.id}-pu`, inc: "", ali: "" };
      soltarRubrica(ctx.par);
      novoDispositivo("paragrafo", "Parágrafo único", mu[1] ?? "", ctx.par);
      continue;
    }
    const mpe = RE_PENA.exec(t);
    if (mpe) {
      const base = ctx.ali || ctx.inc || ctx.par || art.id;
      novoDispositivo("pena", mpe[1]!.charAt(0).toUpperCase() + mpe[1]!.slice(1).toLowerCase(), mpe[2] ?? "", `${base}-pena`);
      continue;
    }
    const mi = RE_INCISO.exec(t);
    if (mi) {
      const suf = mi[2] ?? "";
      ctx.inc = `${ctx.par || art.id}-i${romano(mi[1]!)}${suf ? "-" + suf.toLowerCase() : ""}`;
      ctx.ali = "";
      soltarRubrica(ctx.inc);
      novoDispositivo("inciso", `${mi[1]}${suf ? "-" + suf : ""}`, mi[3] ?? "", ctx.inc);
      continue;
    }
    const ml = RE_ALINEA.exec(t);
    if (ml) {
      ctx.ali = `${ctx.inc || ctx.par || art.id}-${ml[1]}`;
      novoDispositivo("alinea", `${ml[1]})`, ml[2] ?? "", ctx.ali);
      continue;
    }
    const mt = RE_ITEM.exec(t);
    if (mt && (ctx.ali || ctx.inc)) {
      novoDispositivo("item", `${mt[1]}.`, mt[2] ?? "", `${ctx.ali || ctx.inc}-n${mt[1]}`);
      continue;
    }

    /* ----- continuação do dispositivo anterior ----- */
    if (disp) {
      const d: Dispositivo = disp;
      const extra = separarNotas(t);
      d.texto = limpar(`${d.texto} ${extra.texto}`);
      if (extra.notas.length) d.notas = [...(d.notas ?? []), ...extra.notas];
    }
  }
  void rubricasNoArtigo;
  if (citacoes) avisos.push(`${citacoes} bloco(s) de texto citado de outras leis (ficam dentro do artigo que altera)`);

  /* ---------- sumário e encadeamento ---------- */
  const podar = (no: No): NoSumario => {
    const filhos = no.filhos.map(podar);
    const s: NoSumario = { id: no.id, tipo: no.tipo, rotulo: no.rotulo, nome: no.nome, filhos };
    if (no.pagina && no.pagina.artigos.length) {
      if (filhos.length && no.preliminar) {
        filhos.unshift({ id: no.pagina.id, tipo: "pagina", rotulo: no.rotulo, nome: "Disposições iniciais", pagina: no.pagina.id, filhos: [] });
      } else s.pagina = no.pagina.id;
    }
    return s;
  };
  const vazio = (n: NoSumario): boolean => !n.pagina && n.filhos.every(vazio);
  const semVazios = (lista: NoSumario[]): NoSumario[] => lista.filter((n) => !vazio(n)).map((n) => ({ ...n, filhos: semVazios(n.filhos) }));
  const sumario = semVazios(raiz.map(podar));

  const comArtigos = paginas.filter((p) => p.artigos.length > 0);
  comArtigos.forEach((p, i) => {
    p.ordem = i + 1;
    p.palavras = p.artigos.reduce((s, a) => s + a.dispositivos.reduce((x, d) => x + d.texto.split(/\s+/).filter(Boolean).length, 0), 0);
    p.anterior = i > 0 ? comArtigos[i - 1]!.id : null;
    p.proxima = i + 1 < comArtigos.length ? comArtigos[i + 1]!.id : null;
  });
  /* a trilha sai do sumário pronto: o nome de um cabeçalho pode chegar depois do primeiro artigo */
  const trilhas = new Map<string, Array<{ rotulo: string; nome: string }>>();
  const andar = (n: NoSumario, caminho: Array<{ rotulo: string; nome: string }>) => {
    const aqui = n.tipo === "pagina" ? caminho : [...caminho, { rotulo: n.rotulo, nome: n.nome }];
    if (n.pagina) trilhas.set(n.pagina, aqui);
    n.filhos.forEach((f) => andar(f, aqui));
  };
  sumario.forEach((n) => andar(n, []));
  for (const p of comArtigos) {
    const tr = trilhas.get(p.id) ?? [{ rotulo: p.rotulo, nome: p.nome }];
    p.trilha = tr;
    p.rotulo = tr[tr.length - 1]!.rotulo;
    p.nome = tr[tr.length - 1]!.nome;
  }

  const totalArt = comArtigos.reduce((s, p) => s + p.artigos.length, 0);
  const totalDisp = comArtigos.reduce((s, p) => s + p.artigos.reduce((x, a) => x + a.dispositivos.length, 0), 0);
  const vazios = comArtigos.flatMap((p) => p.artigos.flatMap((a) => a.dispositivos.filter((d) => !d.texto && d.tipo !== "caput").map((d) => d.id)));
  if (vazios.length) avisos.push(`${vazios.length} dispositivo(s) sem texto, ex.: ${vazios.slice(0, 3).join(", ")}`);

  const obra: Obra = {
    ...meta, ementa,
    fonte: "Presidência da República — Planalto, texto compilado",
    url: origem.url, baixado_em: origem.baixadoEm,
    atualizado_ate: maisRecente.texto,
    sumario, paginas: comArtigos,
  };
  return { obra, relatorio: { artigos: totalArt, dispositivos: totalDisp, paginas: comArtigos.length, ultimoArtigo: ultimoNumero, avisos } };
}
