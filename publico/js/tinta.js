/* ==========================================================================
   tinta.js — o motor de caneta sobre a folha.

   COMO A TINTA FICA NO LUGAR CERTO: cada traço é guardado em coordenadas
   RELATIVAS ao dispositivo (caput, inciso, parágrafo…) sobre o qual
   começou, junto com a largura e a altura desse dispositivo na hora. Ao
   redesenhar — noutro aparelho, noutra fonte, noutra largura — o traço é
   reescalado para a caixa atual do mesmo dispositivo. O texto reflui; a
   anotação continua ao lado do trecho certo.

   O canvas é FIXO sobre a área visível (não cobre a página inteira): uma
   página longa da Constituição teria milhares de pixels de altura, e um
   canvas desse tamanho estoura a memória do tablet. A cada rolagem, os
   traços visíveis são redesenhados com o deslocamento atual.

   Entrada: caneta desenha sempre; dedo rola a página (a menos que o
   estudante ligue "desenhar com o dedo"); mouse desenha (para a mesa).
   Botão lateral da S Pen (button 5 / buttons & 32) = borracha temporária.
   ========================================================================== */

const ALFA_MARCADOR = { clara: 0.85, escura: 0.32 };

export class Tinta {
  constructor({ folha, topo, aoGravar, aoApagar }) {
    this.folha = folha;
    this.topo = topo;               // altura do cabeçalho fixo (px)
    this.aoGravar = aoGravar;       // (tracos[]) => Promise<ids[]>
    this.aoApagar = aoApagar;       // (ids[]) => Promise
    this.tracos = [];               // modelo: { id, dispositivo_id, ferramenta, cor, largura, pontos, largura_ref, altura_ref }
    this.pendentes = [];            // traços ainda sem id no servidor
    this.desfazer = [];             // pilha desta sessão
    this.ferramenta = "mao";
    this.cor = "#1d2433";
    this.corMarcador = "#fff59a";
    this.largura = 2.2;
    this.dedoDesenha = false;
    this.atual = null;              // traço em andamento
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "tinta";
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext("2d", { desynchronized: true });

    this._aoRolar = () => this.redesenhar();
    this._aoRedimensionar = () => { this.ajustarCanvas(); this.redesenhar(); };
    window.addEventListener("scroll", this._aoRolar, { passive: true });
    window.addEventListener("resize", this._aoRedimensionar);
    this._observador = new ResizeObserver(() => this._aoRedimensionar());
    this._observador.observe(this.folha);

    this.canvas.addEventListener("pointerdown", (e) => this.iniciar(e));
    this.canvas.addEventListener("pointermove", (e) => this.mover(e));
    this.canvas.addEventListener("pointerup", (e) => this.terminar(e));
    this.canvas.addEventListener("pointercancel", (e) => this.terminar(e, true));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this._temporizador = null;
    this.ajustarCanvas();
  }

  destruir() {
    this.enviarPendentes(true);
    window.removeEventListener("scroll", this._aoRolar);
    window.removeEventListener("resize", this._aoRedimensionar);
    this._observador.disconnect();
    this.canvas.remove();
  }

  /* ---------- geometria ---------- */
  ajustarCanvas() {
    const r = this.folha.getBoundingClientRect();
    const topo = this.topo;
    const altura = Math.max(0, window.innerHeight - topo);
    this.canvasEsq = Math.max(0, r.left);
    this.canvasLarg = Math.min(r.width, window.innerWidth - this.canvasEsq);
    this.canvas.style.setProperty("left", `${this.canvasEsq}px`);
    this.canvas.style.setProperty("top", `${topo}px`);
    this.canvas.style.setProperty("width", `${this.canvasLarg}px`);
    this.canvas.style.setProperty("height", `${altura}px`);
    this.canvas.width = Math.round(this.canvasLarg * this.dpr);
    this.canvas.height = Math.round(altura * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /* Coordenadas da FOLHA (origem no canto superior esquerdo da folha). */
  paraFolha(clientX, clientY) {
    const r = this.folha.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  /* Da folha para o canvas visível. */
  paraCanvas(x, y) {
    const r = this.folha.getBoundingClientRect();
    return { x: x + r.left - this.canvasEsq, y: y + r.top - this.topo };
  }

  caixaDo(dispositivoId) {
    const elx = this.folha.querySelector(`[data-id="${CSS.escape(dispositivoId)}"]`);
    if (!elx) return null;
    const r = elx.getBoundingClientRect();
    const f = this.folha.getBoundingClientRect();
    return { x: r.left - f.left, y: r.top - f.top, largura: r.width, altura: r.height };
  }

  /* Dispositivo âncora de um ponto da folha: o que está sob o ponto, senão o
     mais próximo na vertical (traço na margem também tem dono). */
  ancoraEm(x, y) {
    const f = this.folha.getBoundingClientRect();
    const sob = document.elementsFromPoint(x + f.left, y + f.top).find((n) => n.classList?.contains("dispositivo"));
    if (sob) return sob;
    let melhor = null, dist = Infinity;
    for (const d of this.folha.querySelectorAll(".dispositivo")) {
      const r = d.getBoundingClientRect();
      const dy = y + f.top < r.top ? r.top - (y + f.top) : (y + f.top > r.bottom ? (y + f.top) - r.bottom : 0);
      if (dy < dist) { dist = dy; melhor = d; }
    }
    return melhor;
  }

  /* ---------- ferramentas ---------- */
  definirFerramenta(f) {
    this.ferramenta = f;
    const desenha = f === "caneta" || f === "marcador" || f === "borracha";
    this.canvas.classList.toggle("ativa", desenha);
    this.canvas.classList.toggle("borracha", f === "borracha");
    this.canvas.classList.toggle("dedo", desenha && this.dedoDesenha);
  }
  definirDedo(ligado) {
    this.dedoDesenha = Boolean(ligado);
    this.definirFerramenta(this.ferramenta);
  }

  /* ---------- modelo ---------- */
  carregar(tracos) {
    this.tracos = tracos.map((t) => ({ ...t }));
    this.redesenhar();
  }
  limparTudo() {
    this.tracos = [];
    this.pendentes = [];
    this.desfazer = [];
    this.redesenhar();
  }

  /* ---------- eventos ---------- */
  iniciar(e) {
    if (e.pointerType === "touch" && !this.dedoDesenha) return;      // dedo rola
    if (e.button !== 0 && !(e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32)))) return;
    const borracha = this.ferramenta === "borracha" || (e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32)));
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.paraFolha(e.clientX, e.clientY);
    if (borracha) {
      this.atual = { borracha: true, apagados: new Set() };
      this.apagarEm(p.x, p.y);
      return;
    }
    const ferramenta = this.ferramenta === "marcador" ? "marcador" : "caneta";
    const largura = ferramenta === "marcador" ? Math.max(14, this.largura * 7) : this.largura;
    this.atual = {
      ferramenta, cor: ferramenta === "marcador" ? this.corMarcador : this.cor, largura,
      pontos: [p.x, p.y, e.pressure || 0.5], inicio: p, pointerType: e.pointerType,
    };
    this.desenharSegmento(this.atual, 0);
  }

  mover(e) {
    if (!this.atual) return;
    const eventos = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
    if (!eventos.length) eventos.push(e);
    for (const ev of eventos) {
      const p = this.paraFolha(ev.clientX, ev.clientY);
      if (this.atual.borracha) { this.apagarEm(p.x, p.y); continue; }
      const n = this.atual.pontos.length;
      const dx = p.x - this.atual.pontos[n - 3], dy = p.y - this.atual.pontos[n - 2];
      if (dx * dx + dy * dy < 0.6) continue;          // filtro de tremor
      this.atual.pontos.push(p.x, p.y, ev.pressure || 0.5);
      this.desenharSegmento(this.atual, this.atual.pontos.length / 3 - 2);
    }
  }

  terminar(e, cancelado = false) {
    if (!this.atual) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    const t = this.atual;
    this.atual = null;
    if (t.borracha) {
      const ids = [...t.apagados].filter(Boolean);
      if (ids.length) void this.aoApagar(ids);
      return;
    }
    if (cancelado) { this.redesenhar(); return; }
    if (t.pontos.length < 6) {
      /* um toque: vira um ponto visível */
      t.pontos.push(t.pontos[0] + 0.6, t.pontos[1] + 0.6, t.pontos[2]);
    }
    const ancora = this.ancoraEm(t.inicio.x, t.inicio.y);
    if (!ancora) { this.redesenhar(); return; }
    const caixa = this.caixaDo(ancora.dataset.id);
    const relativo = [];
    for (let i = 0; i < t.pontos.length; i += 3) {
      relativo.push(Math.round((t.pontos[i] - caixa.x) * 100) / 100, Math.round((t.pontos[i + 1] - caixa.y) * 100) / 100, Math.round(t.pontos[i + 2] * 100) / 100);
    }
    const traco = {
      id: null, dispositivo_id: ancora.dataset.id, ferramenta: t.ferramenta, cor: t.cor, largura: t.largura,
      pontos: relativo, largura_ref: Math.round(caixa.largura * 100) / 100, altura_ref: Math.round(caixa.altura * 100) / 100,
    };
    this.tracos.push(traco);
    this.pendentes.push(traco);
    this.desfazer.push(traco);
    this.agendarEnvio();
  }

  agendarEnvio() {
    clearTimeout(this._temporizador);
    this._temporizador = setTimeout(() => this.enviarPendentes(), 700);
  }

  async enviarPendentes(final = false) {
    clearTimeout(this._temporizador);
    if (!this.pendentes.length) return;
    const lote = this.pendentes.splice(0, this.pendentes.length);
    try {
      const ids = await this.aoGravar(lote.map(({ id, ...resto }) => resto), final);
      lote.forEach((t, i) => { t.id = ids[i] ?? null; });
      /* Traço apagado enquanto estava a caminho: apaga agora que tem id. */
      const orfaos = lote.filter((t) => t.id && !this.tracos.includes(t)).map((t) => t.id);
      if (orfaos.length) void this.aoApagar(orfaos);
    } catch {
      this.pendentes.unshift(...lote);
      if (!final) this._temporizador = setTimeout(() => this.enviarPendentes(), 4000);
    }
  }

  desfazerUltimo() {
    const t = this.desfazer.pop();
    if (!t) return false;
    this.removerTraco(t);
    if (t.id) void this.aoApagar([t.id]);
    this.redesenhar();
    return true;
  }

  removerTraco(t) {
    const i = this.tracos.indexOf(t);
    if (i >= 0) this.tracos.splice(i, 1);
    const j = this.pendentes.indexOf(t);
    if (j >= 0) this.pendentes.splice(j, 1);
  }

  /* Borracha de traço: encosta, some o traço inteiro (como no Samsung Notes). */
  apagarEm(x, y) {
    const raio = 14;
    let mudou = false;
    for (const t of [...this.tracos]) {
      const abs = this.absolutos(t);
      if (!abs) continue;
      if (!this.tocaTraco(abs, x, y, raio + t.largura / 2)) continue;
      this.removerTraco(t);
      if (t.id) this.atual.apagados.add(t.id);
      mudou = true;
    }
    if (mudou) this.redesenhar();
  }

  tocaTraco(pts, x, y, raio) {
    const r2 = raio * raio;
    for (let i = 0; i + 3 < pts.length; i += 3) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 3], by = pts[i + 4];
      const vx = bx - ax, vy = by - ay;
      const l2 = vx * vx + vy * vy || 1e-6;
      let t = ((x - ax) * vx + (y - ay) * vy) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * vx - x, py = ay + t * vy - y;
      if (px * px + py * py <= r2) return true;
    }
    if (pts.length === 3) { const dx = pts[0] - x, dy = pts[1] - y; return dx * dx + dy * dy <= r2; }
    return false;
  }

  /* Pontos do traço em coordenadas da folha, já reescalados para a caixa atual. */
  absolutos(t) {
    const caixa = this.caixaDo(t.dispositivo_id);
    if (!caixa) return null;
    const sx = caixa.largura / (t.largura_ref || caixa.largura);
    const sy = caixa.altura / (t.altura_ref || caixa.altura);
    const saida = new Array(t.pontos.length);
    for (let i = 0; i < t.pontos.length; i += 3) {
      saida[i] = caixa.x + t.pontos[i] * sx;
      saida[i + 1] = caixa.y + t.pontos[i + 1] * sy;
      saida[i + 2] = t.pontos[i + 2];
    }
    return saida;
  }

  /* ---------- desenho ---------- */
  redesenhar() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvasLarg, this.canvas.height / this.dpr);
    const f = this.folha.getBoundingClientRect();
    const topoVisivel = this.topo - f.top;                     // y da folha no topo do canvas
    const baseVisivel = topoVisivel + this.canvas.height / this.dpr;
    for (const t of this.tracos) {
      const abs = this.absolutos(t);
      if (!abs) continue;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < abs.length; i += 3) { if (abs[i] < minY) minY = abs[i]; if (abs[i] > maxY) maxY = abs[i]; }
      if (maxY + t.largura < topoVisivel || minY - t.largura > baseVisivel) continue;
      this.tracar(abs, t, 0, abs.length / 3 - 1);
    }
    if (this.atual && !this.atual.borracha) this.tracar(this.atual.pontos, this.atual, 0, this.atual.pontos.length / 3 - 1);
  }

  desenharSegmento(t, desde) {
    this.tracar(t.pontos, t, Math.max(0, desde), t.pontos.length / 3 - 1);
  }

  estilo(ctx, t) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = t.cor;
    if (t.ferramenta === "marcador") {
      ctx.globalAlpha = ehClara(t.cor) ? ALFA_MARCADOR.clara : ALFA_MARCADOR.escura;
      ctx.lineCap = "butt";
    } else {
      ctx.globalAlpha = 1;
    }
  }

  /* Caneta: segmentos com largura por pressão, suavizados por pontos médios.
     Marcador: largura fixa, sem pressão — como a ponta chanfrada. */
  tracar(pts, t, de, ate) {
    const ctx = this.ctx;
    if (pts.length < 3) return;
    ctx.save();
    this.estilo(ctx, t);
    const n = pts.length / 3;
    if (n === 1 || de >= ate) {
      const p = this.paraCanvas(pts[0], pts[1]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.8, this.larguraEm(t, pts[2]) / 2), 0, Math.PI * 2);
      ctx.fillStyle = t.cor;
      ctx.fill();
      ctx.restore();
      return;
    }
    for (let i = Math.max(1, de); i <= ate; i++) {
      const a = this.paraCanvas(pts[(i - 1) * 3], pts[(i - 1) * 3 + 1]);
      const b = this.paraCanvas(pts[i * 3], pts[i * 3 + 1]);
      const pa = pts[(i - 1) * 3 + 2], pb = pts[i * 3 + 2];
      ctx.lineWidth = this.larguraEm(t, (pa + pb) / 2);
      ctx.beginPath();
      if (i >= 2) {
        const z = this.paraCanvas(pts[(i - 2) * 3], pts[(i - 2) * 3 + 1]);
        const m1 = { x: (z.x + a.x) / 2, y: (z.y + a.y) / 2 };
        const m2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.moveTo(m1.x, m1.y);
        ctx.quadraticCurveTo(a.x, a.y, m2.x, m2.y);
      } else {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  larguraEm(t, pressao) {
    if (t.ferramenta === "marcador") return t.largura;
    const p = Math.max(0.15, Math.min(1, pressao || 0.5));
    return t.largura * (0.55 + 0.9 * p);
  }
}

function ehClara(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
}
