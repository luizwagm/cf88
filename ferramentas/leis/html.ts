/* ==========================================================================
   html.ts — lê o HTML do Planalto e devolve BLOCOS de texto.

   O HTML de lá é FrontPage dos anos 2000: tags que não fecham, `</body>`
   no meio do documento, cp1252, `<sup><u>o</u></sup>` no lugar de "º" e
   texto revogado dentro de `<strike>`. Um parser de DOM "correto" desiste
   no primeiro `</html>`; por isso aqui é um tokenizador tolerante, que só
   se importa com o que a lei precisa:

     · onde começa e termina um parágrafo (bloco);
     · se ele está centralizado (cabeçalho) e/ou em negrito (rubrica);
     · o que está RISCADO (redação antiga) — descartado;
     · sobrescrito "o"/"a" → º / ª;
     · quebra de linha dentro do bloco (TÍTULO I <br> DAS PESSOAS).

   Sem dependências: roda em qualquer Node 24.
   ========================================================================== */

export interface Bloco {
  linhas: string[];        // o bloco, uma entrada por <br>
  texto: string;           // linhas unidas por espaço
  centralizado: boolean;
  negrito: boolean;
}

export function decodificar(bytes: Uint8Array): string {
  /* Algumas páginas (Lei Maria da Penha) foram salvas em UTF-16: sem isto,
     o texto sai com um byte nulo entre cada letra e nenhum "Art." é achado. */
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes.length > 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  let nulos = 0;
  for (let i = 1; i < Math.min(bytes.length, 2000); i += 2) if (bytes[i] === 0) nulos += 1;
  if (nulos > 400) return new TextDecoder("utf-16le").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", ordm: "º", ordf: "ª", sect: "§", deg: "°", para: "¶",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", Agrave: "À", egrave: "è", ograve: "ò", acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô", atilde: "ã", otilde: "õ", Atilde: "Ã", Otilde: "Õ", ntilde: "ñ",
  ccedil: "ç", Ccedil: "Ç", uuml: "ü", Uuml: "Ü", iuml: "ï", ouml: "ö",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·",
  frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³", times: "×", laquo: "«", raquo: "»", copy: "©", reg: "®",
  shy: "", zwnj: "", euro: "€", cent: "¢", pound: "£",
};

export function entidades(t: string): string {
  return t.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (tudo, nome: string) => {
    if (nome[0] === "#") {
      const n = nome[1] === "x" || nome[1] === "X" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0) return "";
      /* &#150; e afins são cp1252 disfarçado de número. */
      if (n >= 128 && n <= 159) return new TextDecoder("windows-1252").decode(new Uint8Array([n]));
      try { return String.fromCodePoint(n); } catch { return ""; }
    }
    return nome in ENTIDADES ? ENTIDADES[nome]! : tudo;
  });
}

const DE_BLOCO = new Set(["p", "div", "table", "tr", "td", "th", "center", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "blockquote", "body", "hr", "dl", "dt", "dd", "pre"]);
const RISCADO = new Set(["strike", "s", "del"]);
const NEGRITO = new Set(["b", "strong"]);
const MUDO = new Set(["script", "style", "title", "head", "select", "noscript"]);

function atributo(attrs: string, nome: string): string {
  const m = new RegExp(`\\b${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
}
function centraliza(tag: string, attrs: string): boolean {
  if (tag === "center") return true;
  if (/^center$/i.test(atributo(attrs, "align"))) return true;
  return /text-align\s*:\s*center/i.test(atributo(attrs, "style"));
}
function risca(attrs: string): boolean {
  return /text-decoration\s*:\s*line-through/i.test(atributo(attrs, "style"));
}

export function blocos(html: string): Bloco[] {
  const saida: Bloco[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;

  let linhas: string[] = [""];
  let total = 0, emNegrito = 0;
  let riscado = 0, negrito = 0, mudo = 0;
  const centros: string[] = [];           // tags abertas que centralizam
  const riscos: string[] = [];            // tags abertas que riscam por style
  let centroDoBloco = false;
  let sup: string | null = null;

  const fechar = () => {
    const limpas = linhas.map((l) => l.replace(/[  \t\r\n]+/g, " ").trim()).filter((l) => l.length > 0);
    if (limpas.length) {
      saida.push({ linhas: limpas, texto: limpas.join(" "), centralizado: centroDoBloco, negrito: total > 0 && emNegrito >= total * 0.9 });
    }
    linhas = [""];
    total = 0; emNegrito = 0;
    centroDoBloco = centros.length > 0;
  };
  const escrever = (t: string) => {
    if (!t) return;
    linhas[linhas.length - 1] += t;
    const n = t.replace(/\s+/g, "").length;
    total += n;
    if (negrito > 0) emNegrito += n;
  };

  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {                     // texto
      if (mudo > 0 || riscado > 0 || riscos.length > 0) continue;
      const t = entidades(m[4]).replace(/[\r\n\t]+/g, " ");
      if (sup !== null) sup += t; else escrever(t);
      continue;
    }
    if (m[2] === undefined) continue;             // comentário ou "<" solto
    const fecha = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";

    if (MUDO.has(tag)) { mudo = Math.max(0, mudo + (fecha ? -1 : 1)); continue; }
    if (mudo > 0) continue;

    if (RISCADO.has(tag)) { riscado = Math.max(0, riscado + (fecha ? -1 : 1)); continue; }
    if (NEGRITO.has(tag)) { negrito = Math.max(0, negrito + (fecha ? -1 : 1)); continue; }

    if (tag === "sup") {
      if (!fecha) { sup = ""; }
      else if (sup !== null) {
        const s = sup.replace(/\s+/g, "");
        sup = null;
        if (/^[oOº°]$/.test(s)) escrever("º");
        else if (/^[aAª]$/.test(s)) escrever("ª");
        else if (s) escrever(s);
      }
      continue;
    }
    if (tag === "br") { if (riscado === 0 && riscos.length === 0) linhas.push(""); continue; }

    if (DE_BLOCO.has(tag)) {
      fechar();
      if (!fecha) {
        if (centraliza(tag, attrs)) { centros.push(tag); }
        centroDoBloco = centros.length > 0;
        if (risca(attrs)) riscos.push(tag);
      } else {
        const i = centros.lastIndexOf(tag);
        if (i >= 0) centros.splice(i, 1);
        const j = riscos.lastIndexOf(tag);
        if (j >= 0) riscos.splice(j, 1);
        centroDoBloco = centros.length > 0;
      }
      continue;
    }
    /* inline (font, span, a, u, i…): só interessa se risca ou centraliza por style */
    if (!fecha) {
      if (risca(attrs)) riscos.push(tag);
    } else {
      const j = riscos.lastIndexOf(tag);
      if (j >= 0) riscos.splice(j, 1);
    }
  }
  fechar();
  return saida;
}

/* Rubrica e artigo no mesmo parágrafo, separados por <br> ("Lei excepcional
   <br> Art. 3º - …"), ou vários incisos num <p> só: cada linha que ABRE um
   dispositivo vira bloco próprio. Linha comum continua colada à anterior. */
const ABRE = /^(?:Arts?[\s.\-–]*\d|§\s*\d|§\s*[uú]nico|Par[aá]grafo\s+[uú]nico|[IVXLCDM]+(?:-[A-Z])?\s*[-–—]\s|[a-z]{1,2}\)\s|Penas?\s*[-–—:])/;
/* Dois artigos na MESMA linha (revogados em série: "Art. 190. (Revogado…)
   Art. 191. (Revogado…) Rubrica do seguinte"): corta depois de cada nota. */
const EMENDADO = /(?<=\))\s+(?=Arts?[\s.]*\d)/;
export function partirPorMarcador(lista: Bloco[]): Bloco[] {
  const saida: Bloco[] = [];
  for (const b0 of lista) {
    const linhas = b0.linhas.flatMap((l) => (EMENDADO.test(l) ? l.split(EMENDADO) : [l]))
      /* "…(Revogado pela Lei nº 9.279, de 14.5.1996) Falsa atribuição" → a rubrica solta vira linha */
      .flatMap((l) => { const m = /^(Arts?[\s.]*\d[^()]*\((?:Revogad)[^()]*\))\s+([A-ZÀ-Ú][^()]{3,90})$/.exec(l); return m ? [m[1]!, m[2]!] : [l]; });
    const b: Bloco = linhas.length === b0.linhas.length ? b0 : { ...b0, linhas, texto: linhas.join(" ") };
    if (b.linhas.length < 2 || !b.linhas.slice(1).some((l) => ABRE.test(l))) { saida.push(b); continue; }
    let atual: string[] = [];
    const soltar = () => { if (atual.length) saida.push({ linhas: atual, texto: atual.join(" "), centralizado: b.centralizado, negrito: b.negrito }); atual = []; };
    b.linhas.forEach((l, i) => {
      /* abre bloco novo a linha que é marcador — e também a que vem logo
         DEPOIS de um artigo revogado (é a rubrica do artigo seguinte) */
      const anterior = i > 0 ? b.linhas[i - 1]! : "";
      if (i > 0 && (ABRE.test(l) || /\(Revogad[^()]*\)\s*$/.test(anterior))) soltar();
      atual.push(l);
    });
    soltar();
  }
  return saida;
}
