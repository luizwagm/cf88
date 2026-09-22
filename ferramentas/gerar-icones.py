# -*- coding: utf-8 -*-
"""
gerar-icones.py — os ícones do aplicativo (PNG) a partir do emblema em SVG,
usando o PyMuPDF que o projeto já tem (o mesmo do extrator).

  python ferramentas/gerar-icones.py

Gera publico/icones/icone-192.png, icone-512.png e icone-mascara-512.png
(maskable: o desenho fica dentro do círculo central de 80% — a zona segura
que o Android recorta).
"""
from pathlib import Path
import fitz

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "publico" / "icones"

def emblema(tamanho: int, mascara: bool) -> bytes:
    # cantos arredondados só no ícone comum; o maskable é quadrado cheio
    raio = 0 if mascara else tamanho * 0.22
    escala = 0.62 if mascara else 0.84          # o desenho ocupa esta fração do lado
    lado = tamanho * escala
    dx = (tamanho - lado) / 2
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {tamanho} {tamanho}">
  <rect width="{tamanho}" height="{tamanho}" rx="{raio}" fill="#1d6b4f"/>
  <g transform="translate({dx} {dx}) scale({lado / 32})">
    <path d="M7 9.5c3-1.6 6-1.6 9 0 3-1.6 6-1.6 9 0v13c-3-1.6-6-1.6-9 0-3-1.6-6-1.6-9 0z" fill="none" stroke="#f8f4ea" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M16 9.5v13" stroke="#f8f4ea" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M19 15.5l4.5-4.5" stroke="#e2b84a" stroke-width="2.2" stroke-linecap="round"/>
  </g>
</svg>""".encode("utf-8")

def gravar(nome: str, tamanho: int, mascara: bool) -> None:
    doc = fitz.open(stream=emblema(tamanho, mascara), filetype="svg")
    pagina = doc[0]
    fator = tamanho / pagina.rect.width
    pix = pagina.get_pixmap(matrix=fitz.Matrix(fator, fator), alpha=False)
    PASTA.mkdir(parents=True, exist_ok=True)
    pix.save(PASTA / nome)
    print(f"  {nome}: {pix.width}x{pix.height}")

if __name__ == "__main__":
    gravar("icone-192.png", 192, False)
    gravar("icone-512.png", 512, False)
    gravar("icone-mascara-512.png", 512, True)
