/* ==========================================================================
   limitador.ts — trava de força bruta com DOIS baldes: por IP e por conta.

   Por que dois: o balde por IP sozinho cai para ataque distribuído, e o
   balde por conta sozinho permite trancar a conta da vítima de propósito.
   Juntos, um ataque cai de 60 para ~15 tentativas/hora úteis — o mesmo
   desenho que protege os logins do parque em produção.
   ========================================================================== */

interface Balde { tentativas: number[]; }

const JANELA_MS = 60 * 60 * 1000;
const MAX_POR_IP = 20;
const MAX_POR_CONTA = 6;

const porIp = new Map<string, Balde>();
const porConta = new Map<string, Balde>();

function limparELer(mapa: Map<string, Balde>, chave: string, agora: number): Balde {
  let b = mapa.get(chave);
  if (!b) { b = { tentativas: [] }; mapa.set(chave, b); }
  b.tentativas = b.tentativas.filter((t) => agora - t < JANELA_MS);
  if (b.tentativas.length === 0 && mapa.size > 10_000) mapa.delete(chave);
  return b;
}

export function podeTentar(ip: string, conta: string, agora = Date.now()): boolean {
  const bIp = limparELer(porIp, ip, agora);
  const bConta = limparELer(porConta, conta.toLowerCase(), agora);
  return bIp.tentativas.length < MAX_POR_IP && bConta.tentativas.length < MAX_POR_CONTA;
}

export function registrarFalha(ip: string, conta: string, agora = Date.now()): void {
  limparELer(porIp, ip, agora).tentativas.push(agora);
  limparELer(porConta, conta.toLowerCase(), agora).tentativas.push(agora);
}

/* Sucesso zera o balde da conta, mas NÃO o do IP. */
export function registrarSucesso(_ip: string, conta: string): void {
  porConta.delete(conta.toLowerCase());
}

export function zerarTudo(): void {
  porIp.clear();
  porConta.clear();
}
