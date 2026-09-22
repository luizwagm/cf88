# -*- coding: utf-8 -*-
"""
extrair-cf88.py — transforma o PDF da edição administrativa do Senado
(CF88 compilada até a EC 139/2026) no JSON estruturado que o LA Carta lê.

Como o PDF é lido: por SPANS do PyMuPDF, não por texto corrido. É a fonte
que diz o que cada linha é —

  · MinionPro-Bold 11pt "TÍTULO / CAPÍTULO / SEÇÃO / SUBSEÇÃO" → cabeçalho
  · MinionPro-Bold 11pt "Art. N" no início da linha            → artigo
  · sobrescrito 6.4pt "o" logo depois de número                → "º"
  · sobrescrito "*"                                            → marca de nota
  · 9pt no rodapé                                              → nota do editor
  · 8pt itálico a y<40                                         → cabeço da página (descartado)

Novo dispositivo = linha que começa RECUADA em relação à margem da página
(o recuo de parágrafo do livro), ou linha que abre com "Art." em negrito.
Linha na margem é continuação do dispositivo anterior.

Uso:  python ferramentas/extrair-cf88.py <caminho do PDF> [saida.json]
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import fitz  # PyMuPDF

PRIMEIRA_PAGINA = 10      # índice 0-based: página do Preâmbulo
PAGINA_ADCT = 145         # início do Ato das Disposições Constitucionais Transitórias
ULTIMA_PAGINA = 187       # última página do ADCT (antes das Emendas de Revisão)
ARTIGOS_POR_PAGINA_ADCT = 10

ROMANO = r"(?:X{0,3})(?:IX|IV|V?I{0,3}|L?X{0,3})"
RE_INCISO = re.compile(r"^([IVXLC]+)\s*[–\-]\s+(.*)$", re.S)
RE_ALINEA = re.compile(r"^([a-z])\)\s*(.*)$", re.S)
RE_ITEM = re.compile(r"^(\d{1,2})\.\s+(.*)$", re.S)
RE_PARAGRAFO = re.compile(r"^§\s*(\d+)\s*(º|\.)?\s*(.*)$", re.S)
RE_PAR_UNICO = re.compile(r"^Parágrafo único\.?\s*(.*)$", re.S)
RE_ARTIGO = re.compile(r"^Art\.\s*(\d+)\s*(º|\.|-[A-Z])?\s*(.*)$", re.S)
RE_ARTIGOS = re.compile(r"^Arts\.\s*(\d+)\s*a\s*(\d+)\.?\s*(.*)$", re.S)
RE_CABECALHO = re.compile(r"^(TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+([IVXLC]+(?:-[A-Z])?)\s*$")

# Prefixos cujo hífen é de verdade (não de quebra de linha): "Vice-" + "Presidente".
PREFIXOS_COM_HIFEN = {
    "vice", "ex", "pró", "pré", "pós", "sub", "auto", "anti", "sócio", "socio", "recém",
    "além", "aquém", "bem", "mal", "sem", "inter", "extra", "infra", "intra", "semi",
    "ultra", "super", "contra", "co", "não", "micro", "macro", "multi", "pluri",
}

ESPACOS = {" ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
           " ": "", "\xa0": " ", "‑": "-", "­": ""}


def limpar(texto: str) -> str:
    for de, para in ESPACOS.items():
        texto = texto.replace(de, para)
    texto = re.sub(r"[ \t]+", " ", texto)
    return texto.strip()


def romano_para_int(r: str) -> int:
    valores = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
    total, anterior = 0, 0
    for ch in reversed(r):
        v = valores.get(ch, 0)
        total = total - v if v < anterior else total + v
        anterior = max(anterior, v)
    return total


def slug(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return t


class Linha:
    __slots__ = ("y", "x0", "x1", "texto", "negrito_inicio", "italico_inicio", "tamanho", "nota_marcador", "pagina")

    def __init__(self, pagina, y, x0, x1, texto, negrito_inicio, italico_inicio, tamanho, nota_marcador):
        self.pagina = pagina
        self.y, self.x0, self.x1 = y, x0, x1
        self.texto = texto
        self.negrito_inicio = negrito_inicio
        self.italico_inicio = italico_inicio
        self.tamanho = tamanho
        self.nota_marcador = nota_marcador


def ler_linhas(doc, pno):
    """Linhas do corpo (11pt), notas do editor (9pt) e cabeçalhos grandes."""
    corpo, notas = [], []
    page = doc[pno]
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            spans = l["spans"]
            if not spans:
                continue
            y, x0, x1 = l["bbox"][1], l["bbox"][0], l["bbox"][2]
            tamanhos = [round(s["size"], 1) for s in spans]
            maior = max(tamanhos)
            # cabeço da página: 8pt itálico no topo
            if y < 40 and maior <= 8.5:
                continue
            zona_notas = maior <= 9.5 and y > 600
            partes, marcador = [], False
            for s in spans:
                t = s["text"]
                tam = round(s["size"], 1)
                if tam <= 6.6:  # sobrescrito
                    if t.strip() == "o":
                        partes.append("º")
                    elif re.fullmatch(r"\*+", t.strip()):
                        if zona_notas:
                            partes.append(t.strip() + " ")
                        else:
                            marcador = True
                    elif t.strip() == "":
                        continue
                    else:
                        partes.append(t)
                else:
                    partes.append(t)
            texto = limpar("".join(partes))
            if not texto:
                continue
            primeiro = next((s for s in spans if s["text"].strip()), spans[0])
            negrito = "Bold" in primeiro["font"]
            italico = primeiro["font"].endswith("-It")
            if zona_notas:
                notas.append(Linha(pno, y, x0, x1, texto, negrito, italico, maior, marcador))
            else:
                corpo.append(Linha(pno, y, x0, x1, texto, negrito, italico, maior, marcador))
    corpo.sort(key=lambda L: (round(L.y), L.x0))
    notas.sort(key=lambda L: (round(L.y), L.x0))
    return corpo, notas


def juntar(anterior: str, proxima: str) -> str:
    """Une linha quebrada, tratando o hífen de fim de linha."""
    if not anterior:
        return proxima
    if anterior.endswith("-"):
        if proxima.startswith("-"):
            return anterior + proxima[1:]
        palavra = re.split(r"[\s(]", anterior[:-1])[-1].lower()
        if proxima[:1].islower() and palavra not in PREFIXOS_COM_HIFEN:
            return anterior[:-1] + proxima
        return anterior + proxima
    return anterior + " " + proxima


class Extrator:
    def __init__(self, doc):
        self.doc = doc
        self.paginas = []          # páginas do LA Carta
        self.sumario = []          # árvore
        self.avisos = []
        self._pilha = []           # nós de cabeçalho abertos (título > capítulo > seção > subseção)
        self._artigo = None
        self._dispositivo = None
        self._notas_pendentes = [] # dispositivos com marcador "*" aguardando a nota do rodapé
        self._livro = "cf"
        self._seq_disp = 0
        self._ultimo_num_art = {"cf": 0, "adct": 0}

    # ---------- estrutura ----------
    def _pagina_atual(self):
        if not self._pilha:
            raise RuntimeError("artigo sem cabeçalho")
        no = self._pilha[-1]
        if no.get("pagina") is None:
            no["pagina"] = self._nova_pagina(no)
        return no["pagina"]

    def _nova_pagina(self, no):
        trilha = [{"rotulo": n["rotulo"], "nome": n["nome"]} for n in self._pilha]
        pid = "-".join([self._livro] + [n["slug"] for n in self._pilha])
        pagina = {
            "id": pid,
            "livro": self._livro,
            "ordem": len(self.paginas) + 1,
            "trilha": trilha,
            "rotulo": no["rotulo"],
            "nome": no["nome"],
            "artigos": [],
        }
        self.paginas.append(pagina)
        return pagina

    def abrir_cabecalho(self, tipo, rotulo_romano, nome):
        nivel = {"titulo": 0, "capitulo": 1, "secao": 2, "subsecao": 3}[tipo]
        # fecha o que estiver no mesmo nível ou abaixo
        while self._pilha and self._pilha[-1]["nivel"] >= nivel:
            self._pilha.pop()
        prefixo = {"titulo": "Título", "capitulo": "Capítulo", "secao": "Seção", "subsecao": "Subseção"}[tipo]
        abrev = {"titulo": "t", "capitulo": "c", "secao": "s", "subsecao": "ss"}[tipo]
        no = {
            "id": None, "tipo": tipo, "nivel": nivel,
            "rotulo": f"{prefixo} {rotulo_romano}", "nome": nome,
            "slug": f"{abrev}{rotulo_romano.lower()}",
            "filhos": [], "pagina": None,
        }
        if self._pilha:
            pai = self._pilha[-1]
            if pai.get("pagina") is not None and pai["pagina"]["artigos"]:
                # o pai tinha artigos antes do primeiro filho: vira uma página-irmã
                pai["pagina"]["nome"] = pai["nome"]
                pai["pagina"]["rotulo"] = pai["rotulo"]
                pai["pagina"]["preliminar"] = True
            pai["filhos"].append(no)
        else:
            self.sumario.append(no)
        no["id"] = "-".join([self._livro] + [n["slug"] for n in self._pilha] + [no["slug"]])
        self._pilha.append(no)
        self._artigo = None
        self._dispositivo = None

    def abrir_preambulo(self):
        no = {"id": "cf-preambulo", "tipo": "preambulo", "nivel": 0, "rotulo": "Preâmbulo", "nome": "",
              "slug": "preambulo", "filhos": [], "pagina": None}
        self.sumario.append(no)
        self._pilha = [no]
        pagina = self._pagina_atual()
        self._artigo = {"id": "cf-preambulo-texto", "rotulo": "Preâmbulo", "numero": 0, "dispositivos": []}
        pagina["artigos"].append(self._artigo)
        self._seq_disp = 0
        self._novo_dispositivo("caput", "", "")

    def abrir_adct(self):
        self._livro = "adct"
        self._pilha = []
        self._artigo = None
        self._dispositivo = None
        no = {"id": "adct", "tipo": "livro", "nivel": 0, "rotulo": "ADCT",
              "nome": "Ato das Disposições Constitucionais Transitórias", "slug": "adct", "filhos": [], "pagina": None}
        self.sumario.append(no)
        self._adct_no = no

    def _pagina_adct(self, numero):
        bloco = (numero - 1) // ARTIGOS_POR_PAGINA_ADCT
        inicio = bloco * ARTIGOS_POR_PAGINA_ADCT + 1
        fim = inicio + ARTIGOS_POR_PAGINA_ADCT - 1
        pid = f"adct-{inicio}-{fim}"
        for p in self.paginas:
            if p["id"] == pid:
                return p
        rot = f"Arts. {inicio}º a {fim}" if inicio < 10 else f"Arts. {inicio} a {fim}"
        no = {"id": pid, "tipo": "bloco", "nivel": 1, "rotulo": rot, "nome": "", "slug": pid, "filhos": [], "pagina": None}
        self._adct_no["filhos"].append(no)
        pagina = {
            "id": pid, "livro": "adct", "ordem": len(self.paginas) + 1,
            "trilha": [{"rotulo": "ADCT", "nome": "Ato das Disposições Constitucionais Transitórias"}, {"rotulo": rot, "nome": ""}],
            "rotulo": rot, "nome": "", "artigos": [],
        }
        no["pagina"] = pagina
        self.paginas.append(pagina)
        return pagina

    def abrir_artigo(self, numero, sufixo, resto, ate=None):
        rotulo = f"Art. {numero}{'º' if numero < 10 else ''}{sufixo or ''}"
        ident = f"{self._livro}-art-{numero}{(sufixo or '').lower()}"
        if ate:
            rotulo = f"Arts. {numero} a {ate}"
            ident = f"{self._livro}-art-{numero}-{ate}"
        esperado = self._ultimo_num_art[self._livro]
        if not sufixo and numero not in (esperado, esperado + 1):
            self.avisos.append(f"p{self._pno + 1}: sequência de artigos {esperado} → {numero} ({self._livro})")
        if not sufixo:
            self._ultimo_num_art[self._livro] = max(esperado, ate or numero)
        pagina = self._pagina_adct(numero) if self._livro == "adct" else self._pagina_atual()
        self._artigo = {"id": ident, "rotulo": rotulo, "numero": numero, "sufixo": sufixo or "", "dispositivos": []}
        pagina["artigos"].append(self._artigo)
        self._seq_disp = 0
        self._novo_dispositivo("caput", "", resto)

    def _novo_dispositivo(self, tipo, rotulo, texto):
        self._seq_disp += 1
        d = {"id": f"{self._artigo['id']}-d{self._seq_disp}", "tipo": tipo, "rotulo": rotulo, "texto": texto}
        self._artigo["dispositivos"].append(d)
        self._dispositivo = d
        return d

    # ---------- linhas ----------
    def processar(self):
        for pno in range(PRIMEIRA_PAGINA, ULTIMA_PAGINA + 1):
            self._pno = pno
            corpo, notas = ler_linhas(self.doc, pno)
            if pno == PRIMEIRA_PAGINA:
                self._preambulo(corpo)
                continue
            if pno == PAGINA_ADCT:
                self.abrir_adct()
            margem = min((L.x0 for L in corpo if L.tamanho >= 10.5 and L.tamanho <= 11.5), default=43)
            aguardando_nome = None  # cabeçalho aberto esperando o nome nas linhas seguintes
            for L in corpo:
                t = L.texto
                if L.tamanho >= 12:  # "ATO DAS DISPOSIÇÕES..." e afins
                    if "DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS" in t.upper():
                        continue
                    self.avisos.append(f"p{pno + 1}: linha grande ignorada: {t[:60]}")
                    continue
                if t.upper() in ("ATO DAS DISPOSIÇÕES", "CONSTITUCIONAIS TRANSITÓRIAS", "ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS"):
                    continue
                m = RE_CABECALHO.match(t)
                if m and L.negrito_inicio:
                    tipo = {"TÍTULO": "titulo", "CAPÍTULO": "capitulo", "SEÇÃO": "secao", "SUBSEÇÃO": "subsecao"}[m.group(1)]
                    self.abrir_cabecalho(tipo, m.group(2), "")
                    aguardando_nome = self._pilha[-1]
                    continue
                if aguardando_nome is not None and not (L.negrito_inicio and t.startswith("Art.")) and L.x0 > margem + 30:
                    aguardando_nome["nome"] = (aguardando_nome["nome"] + " " + t).strip()
                    continue
                aguardando_nome = None

                mas = RE_ARTIGOS.match(t)
                if mas and L.negrito_inicio:
                    self.abrir_artigo(int(mas.group(1)), "", mas.group(3).strip(), ate=int(mas.group(2)))
                    continue
                ma = RE_ARTIGO.match(t)
                if ma and L.negrito_inicio:
                    numero = int(ma.group(1))
                    suf = ma.group(2) or ""
                    if suf in ("º", "."):
                        suf = ""
                    resto = ma.group(3).strip()
                    self.abrir_artigo(numero, suf, resto)
                    if L.nota_marcador:
                        self._notas_pendentes.append(self._dispositivo)
                    continue

                recuado = L.x0 > margem + 8
                if recuado and self._artigo is not None:
                    self._classificar_novo(t)
                elif self._dispositivo is not None:
                    self._dispositivo["texto"] = juntar(self._dispositivo["texto"], t)
                else:
                    self.avisos.append(f"p{pno + 1}: linha solta: {t[:70]}")
                if L.nota_marcador and self._dispositivo is not None:
                    self._notas_pendentes.append(self._dispositivo)

            self._anexar_notas(notas)

    def _classificar_novo(self, t):
        mp = RE_PARAGRAFO.match(t)
        if mp:
            n = int(mp.group(1))
            self._novo_dispositivo("paragrafo", f"§ {n}{'º' if n < 10 else ''}", mp.group(3).strip())
            return
        mu = RE_PAR_UNICO.match(t)
        if mu:
            self._novo_dispositivo("paragrafo", "Parágrafo único", mu.group(1).strip())
            return
        mi = RE_INCISO.match(t)
        if mi and re.fullmatch(r"[IVXLC]+", mi.group(1)):
            self._novo_dispositivo("inciso", mi.group(1), mi.group(2).strip())
            return
        ma = RE_ALINEA.match(t)
        if ma:
            self._novo_dispositivo("alinea", f"{ma.group(1)})", ma.group(2).strip())
            return
        mt = RE_ITEM.match(t)
        if mt:
            self._novo_dispositivo("item", f"{mt.group(1)}.", mt.group(2).strip())
            return
        # recuado mas sem marcador conhecido: continuação (parágrafo tipográfico)
        if self._dispositivo is not None:
            self._dispositivo["texto"] = juntar(self._dispositivo["texto"], t)

    def _anexar_notas(self, notas):
        if not notas:
            return
        textos, atual = [], ""
        for L in notas:
            t = L.texto
            if t.startswith("*") or t.startswith("NE:"):
                if atual:
                    textos.append(atual)
                atual = t.lstrip("* ").strip()
            else:
                atual = juntar(atual, t)
        if atual:
            textos.append(atual)
        for texto in textos:
            if self._notas_pendentes:
                d = self._notas_pendentes.pop(0)
                d.setdefault("notas", []).append(texto)
            else:
                self.avisos.append(f"p{self._pno + 1}: nota sem dispositivo: {texto[:60]}")

    def _preambulo(self, corpo):
        self.abrir_preambulo()
        texto = ""
        for L in corpo:
            if L.texto.isupper():
                continue
            texto = juntar(texto, L.texto)
        self._dispositivo["texto"] = texto

    # ---------- saída ----------
    def montar(self):
        def podar(no):
            filhos = [podar(f) for f in no["filhos"]]
            pagina = no.get("pagina")
            saida = {"id": no["id"], "tipo": no["tipo"], "rotulo": no["rotulo"], "nome": no["nome"]}
            if pagina is not None and pagina["artigos"]:
                if filhos and pagina.get("preliminar"):
                    prelim = {"id": pagina["id"], "tipo": "pagina", "rotulo": pagina["rotulo"], "nome": "Disposições iniciais", "pagina": pagina["id"], "filhos": []}
                    pagina["nome"] = pagina["nome"] or no["nome"]
                    filhos.insert(0, prelim)
                else:
                    saida["pagina"] = pagina["id"]
            saida["filhos"] = filhos
            return saida

        sumario = [podar(n) for n in self.sumario]
        for p in self.paginas:
            p["palavras"] = sum(len(d["texto"].split()) for a in p["artigos"] for d in a["dispositivos"])
            p.pop("preliminar", None)
        # navegação linear
        for i, p in enumerate(self.paginas):
            p["anterior"] = self.paginas[i - 1]["id"] if i > 0 else None
            p["proxima"] = self.paginas[i + 1]["id"] if i + 1 < len(self.paginas) else None
        return {
            "fonte": "Senado Federal — Edição administrativa do texto constitucional promulgado em 5 de outubro de 1988, compilado até a Emenda Constitucional nº 139/2026",
            "atualizado_ate": "EC 139/2026",
            "livros": [
                {"id": "cf", "nome": "Constituição da República Federativa do Brasil", "curto": "CF/88"},
                {"id": "adct", "nome": "Ato das Disposições Constitucionais Transitórias", "curto": "ADCT"},
            ],
            "sumario": sumario,
            "paginas": self.paginas,
        }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    pdf = sys.argv[1]
    saida = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "conteudo" / "cf88.json"
    doc = fitz.open(pdf)
    ex = Extrator(doc)
    ex.processar()
    dados = ex.montar()
    saida.parent.mkdir(parents=True, exist_ok=True)
    with open(saida, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dados, f, ensure_ascii=False, indent=None, separators=(",", ":"))
    total_art = sum(len(p["artigos"]) for p in dados["paginas"])
    total_disp = sum(len(a["dispositivos"]) for p in dados["paginas"] for a in p["artigos"])
    print(f"páginas: {len(dados['paginas'])}  artigos: {total_art}  dispositivos: {total_disp}")
    print(f"último artigo CF: {ex._ultimo_num_art['cf']}  ADCT: {ex._ultimo_num_art['adct']}")
    for a in ex.avisos:
        print("  aviso:", a)
    print("gravado em", saida)


if __name__ == "__main__":
    main()
