/* ==========================================================================
   catalogo.ts — o que entra no Vade Mecum.

   Para acrescentar uma lei: uma linha aqui e `npm run leis -- --so <id>`.
   O `id` é PREFIXO de todos os ids da obra (páginas, artigos, dispositivos)
   e não pode mudar depois que houver anotação nela.

   `ultimo` é o número do último artigo esperado: a conferência acusa se o
   extrator parar antes (página truncada, formato que ele não entendeu).
   `urls` só é preciso quando o endereço foge do padrão do Planalto.
   ========================================================================== */

export interface Entrada {
  id: string; sigla: string; nome: string; identificacao: string; categoria: string;
  tipo: "lei" | "decreto-lei" | "lcp"; numero: number; ano: number;
  ultimo?: number; urls?: string[];
}

export const CATEGORIAS = [
  "Constitucional", "Civil e Consumidor", "Processo Civil", "Penal", "Processo Penal", "Trabalho",
  "Tributário e Financeiro", "Administrativo", "Empresarial", "Eleitoral", "Previdenciário",
  "Ambiental e Urbanístico", "Estatutos e Direitos Humanos", "Carreiras Jurídicas",
] as const;

const L = (id: string, sigla: string, nome: string, numero: number, data: string, categoria: string, extra: Partial<Entrada> = {}): Entrada => ({
  id, sigla, nome, identificacao: `Lei nº ${numero.toLocaleString("pt-BR")}, de ${data}`, categoria, tipo: "lei", numero, ano: Number(data.slice(-4)), ...extra,
});
const DL = (id: string, sigla: string, nome: string, numero: number, data: string, categoria: string, extra: Partial<Entrada> = {}): Entrada => ({
  id, sigla, nome, identificacao: `Decreto-Lei nº ${numero.toLocaleString("pt-BR")}, de ${data}`, categoria, tipo: "decreto-lei", numero, ano: Number(data.slice(-4)), ...extra,
});
const LC = (id: string, sigla: string, nome: string, numero: number, data: string, categoria: string, extra: Partial<Entrada> = {}): Entrada => ({
  id, sigla, nome, identificacao: `Lei Complementar nº ${numero}, de ${data}`, categoria, tipo: "lcp", numero, ano: Number(data.slice(-4)), ...extra,
});

export const CATALOGO: Entrada[] = [
  /* ---------------- Constitucional ---------------- */
  L("lms", "LMS", "Mandado de Segurança", 12016, "7 de agosto de 2009", "Constitucional", { ultimo: 29 }),
  L("ladi", "ADI/ADC", "Ação Direta de Inconstitucionalidade e Ação Declaratória", 9868, "10 de novembro de 1999", "Constitucional", { ultimo: 31 }),
  L("adpf", "ADPF", "Arguição de Descumprimento de Preceito Fundamental", 9882, "3 de dezembro de 1999", "Constitucional", { ultimo: 14 }),
  L("lmi", "LMI", "Mandado de Injunção", 13300, "23 de junho de 2016", "Constitucional", { ultimo: 15 }),
  L("lhd", "LHD", "Habeas Data", 9507, "12 de novembro de 1997", "Constitucional", { ultimo: 23 }),
  L("lap", "LAP", "Ação Popular", 4717, "29 de junho de 1965", "Constitucional", { ultimo: 22 }),
  L("lacp", "LACP", "Ação Civil Pública", 7347, "24 de julho de 1985", "Constitucional", { ultimo: 23 }),
  L("lai", "LAI", "Lei de Acesso à Informação", 12527, "18 de novembro de 2011", "Constitucional", { ultimo: 47 }),

  /* ---------------- Civil e Consumidor ---------------- */
  DL("lindb", "LINDB", "Lei de Introdução às Normas do Direito Brasileiro", 4657, "4 de setembro de 1942", "Civil e Consumidor", { ultimo: 30 }),
  L("cc", "CC", "Código Civil", 10406, "10 de janeiro de 2002", "Civil e Consumidor", { ultimo: 2046 }),
  L("cdc", "CDC", "Código de Defesa do Consumidor", 8078, "11 de setembro de 1990", "Civil e Consumidor", { ultimo: 119 }),
  L("inq", "Inquilinato", "Lei do Inquilinato (Locações)", 8245, "18 de outubro de 1991", "Civil e Consumidor", { ultimo: 90 }),
  L("lrp", "LRP", "Lei de Registros Públicos", 6015, "31 de dezembro de 1973", "Civil e Consumidor", { ultimo: 299 }),
  L("alim", "Alimentos", "Lei de Alimentos", 5478, "25 de julho de 1968", "Civil e Consumidor", { ultimo: 29 }),
  L("lgpd", "LGPD", "Lei Geral de Proteção de Dados Pessoais", 13709, "14 de agosto de 2018", "Civil e Consumidor", { ultimo: 65 }),
  L("mci", "MCI", "Marco Civil da Internet", 12965, "23 de abril de 2014", "Civil e Consumidor", { ultimo: 32 }),
  L("lda", "LDA", "Direitos Autorais", 9610, "19 de fevereiro de 1998", "Civil e Consumidor", { ultimo: 115 }),

  /* ---------------- Processo Civil ---------------- */
  L("cpc", "CPC", "Código de Processo Civil", 13105, "16 de março de 2015", "Processo Civil", { ultimo: 1072 }),
  L("jec", "JEC", "Juizados Especiais Cíveis e Criminais", 9099, "26 de setembro de 1995", "Processo Civil", { ultimo: 97 }),
  L("jef", "JEF", "Juizados Especiais Federais", 10259, "12 de julho de 2001", "Processo Civil", { ultimo: 27 }),
  L("jefp", "JEFP", "Juizados Especiais da Fazenda Pública", 12153, "22 de dezembro de 2009", "Processo Civil", { ultimo: 28 }),
  L("arb", "Arbitragem", "Lei de Arbitragem", 9307, "23 de setembro de 1996", "Processo Civil", { ultimo: 44 }),
  L("med", "Mediação", "Lei de Mediação", 13140, "26 de junho de 2015", "Processo Civil", { ultimo: 48 }),
  L("lef", "LEF", "Lei de Execução Fiscal", 6830, "22 de setembro de 1980", "Processo Civil", { ultimo: 42 }),
  L("pje", "Proc. Eletrônico", "Informatização do Processo Judicial", 11419, "19 de dezembro de 2006", "Processo Civil", { ultimo: 22 }),
  L("laj", "LAJ", "Assistência Judiciária", 1060, "5 de fevereiro de 1950", "Processo Civil", { ultimo: 19 }),

  /* ---------------- Penal ---------------- */
  DL("cp", "CP", "Código Penal", 2848, "7 de dezembro de 1940", "Penal", { ultimo: 361 }),
  DL("lcp", "LCP", "Lei das Contravenções Penais", 3688, "3 de outubro de 1941", "Penal", { ultimo: 72 }),
  L("drogas", "Drogas", "Lei de Drogas", 11343, "23 de agosto de 2006", "Penal", { ultimo: 75 }),
  L("lmp", "Maria da Penha", "Lei Maria da Penha", 11340, "7 de agosto de 2006", "Penal", { ultimo: 46 }),
  L("hed", "Hediondos", "Crimes Hediondos", 8072, "25 de julho de 1990", "Penal", { ultimo: 13 }),
  L("desarm", "Desarmamento", "Estatuto do Desarmamento", 10826, "22 de dezembro de 2003", "Penal", { ultimo: 37 }),
  L("abuso", "Abuso de Autoridade", "Lei de Abuso de Autoridade", 13869, "5 de setembro de 2019", "Penal", { ultimo: 45 }),
  L("orcrim", "ORCRIM", "Organizações Criminosas", 12850, "2 de agosto de 2013", "Penal", { ultimo: 27 }),
  L("lavagem", "Lavagem", "Lavagem de Dinheiro", 9613, "3 de março de 1998", "Penal", { ultimo: 18 }),
  L("tortura", "Tortura", "Crimes de Tortura", 9455, "7 de abril de 1997", "Penal", { ultimo: 4 }),
  L("racismo", "Racismo", "Crimes de Preconceito de Raça ou de Cor", 7716, "5 de janeiro de 1989", "Penal", { ultimo: 22 }),
  L("lca", "LCA", "Crimes Ambientais", 9605, "12 de fevereiro de 1998", "Penal", { ultimo: 82 }),
  L("ctb", "CTB", "Código de Trânsito Brasileiro", 9503, "23 de setembro de 1997", "Penal", { ultimo: 341 }),
  L("ordtrib", "Crimes Tributários", "Crimes contra a Ordem Tributária, Econômica e Relações de Consumo", 8137, "27 de dezembro de 1990", "Penal", { ultimo: 23 }),

  /* ---------------- Processo Penal ---------------- */
  DL("cpp", "CPP", "Código de Processo Penal", 3689, "3 de outubro de 1941", "Processo Penal", { ultimo: 811 }),
  L("lep", "LEP", "Lei de Execução Penal", 7210, "11 de julho de 1984", "Processo Penal", { ultimo: 204 }),
  L("temp", "Prisão Temporária", "Prisão Temporária", 7960, "21 de dezembro de 1989", "Processo Penal", { ultimo: 7 }),
  L("intercep", "Interceptação", "Interceptação Telefônica", 9296, "24 de julho de 1996", "Processo Penal", { ultimo: 12 }),
  L("l8038", "Lei 8.038", "Processos perante o STJ e o STF", 8038, "28 de maio de 1990", "Processo Penal", { ultimo: 44 }),

  /* ---------------- Trabalho ---------------- */
  DL("clt", "CLT", "Consolidação das Leis do Trabalho", 5452, "1º de maio de 1943", "Trabalho", { ultimo: 922 }),
  L("fgts", "FGTS", "Fundo de Garantia do Tempo de Serviço", 8036, "11 de maio de 1990", "Trabalho", { ultimo: 32 }),

  /* ---------------- Tributário e Financeiro ---------------- */
  L("ctn", "CTN", "Código Tributário Nacional", 5172, "25 de outubro de 1966", "Tributário e Financeiro", { ultimo: 218 }),
  LC("lrf", "LRF", "Lei de Responsabilidade Fiscal", 101, "4 de maio de 2000", "Tributário e Financeiro", { ultimo: 75 }),
  L("l4320", "Lei 4.320", "Normas Gerais de Direito Financeiro", 4320, "17 de março de 1964", "Tributário e Financeiro", { ultimo: 115 }),

  /* ---------------- Administrativo ---------------- */
  L("l8112", "Lei 8.112", "Regime Jurídico dos Servidores Públicos Federais", 8112, "11 de dezembro de 1990", "Administrativo", { ultimo: 253 }),
  L("nll", "NLL", "Lei de Licitações e Contratos Administrativos", 14133, "1º de abril de 2021", "Administrativo", { ultimo: 194 }),
  L("lia", "LIA", "Lei de Improbidade Administrativa", 8429, "2 de junho de 1992", "Administrativo", { ultimo: 25 }),
  L("lpa", "LPA", "Processo Administrativo Federal", 9784, "29 de janeiro de 1999", "Administrativo", { ultimo: 70 }),
  L("conc", "Concessões", "Concessão e Permissão de Serviços Públicos", 8987, "13 de fevereiro de 1995", "Administrativo", { ultimo: 47 }),
  L("ppp", "PPP", "Parcerias Público-Privadas", 11079, "30 de dezembro de 2004", "Administrativo", { ultimo: 30 }),
  L("lac", "LAC", "Lei Anticorrupção", 12846, "1º de agosto de 2013", "Administrativo", { ultimo: 31 }),
  L("estatais", "Estatais", "Estatuto das Empresas Estatais", 13303, "30 de junho de 2016", "Administrativo", { ultimo: 97 }),
  DL("desap", "Desapropriação", "Desapropriação por Utilidade Pública", 3365, "21 de junho de 1941", "Administrativo", { ultimo: 43 }),

  /* ---------------- Empresarial ---------------- */
  L("lfr", "LFR", "Recuperação Judicial, Extrajudicial e Falência", 11101, "9 de fevereiro de 2005", "Empresarial", { ultimo: 201 }),
  L("lsa", "LSA", "Lei das Sociedades por Ações", 6404, "15 de dezembro de 1976", "Empresarial", { ultimo: 300 }),
  L("lpi", "LPI", "Propriedade Industrial", 9279, "14 de maio de 1996", "Empresarial", { ultimo: 244 }),
  L("cheque", "Cheque", "Lei do Cheque", 7357, "2 de setembro de 1985", "Empresarial", { ultimo: 71 }),

  /* ---------------- Eleitoral ---------------- */
  L("ce", "CE", "Código Eleitoral", 4737, "15 de julho de 1965", "Eleitoral", { ultimo: 383 }),
  L("le", "Eleições", "Lei das Eleições", 9504, "30 de setembro de 1997", "Eleitoral", { ultimo: 107 }),
  L("lpp", "Partidos", "Lei dos Partidos Políticos", 9096, "19 de setembro de 1995", "Eleitoral", { ultimo: 63 }),
  LC("inel", "Inelegibilidades", "Lei das Inelegibilidades", 64, "18 de maio de 1990", "Eleitoral", { ultimo: 28 }),

  /* ---------------- Previdenciário ---------------- */
  L("custeio", "Custeio", "Organização e Custeio da Seguridade Social", 8212, "24 de julho de 1991", "Previdenciário", { ultimo: 105 }),
  L("benef", "Benefícios", "Planos de Benefícios da Previdência Social", 8213, "24 de julho de 1991", "Previdenciário", { ultimo: 156 }),

  /* ---------------- Ambiental e Urbanístico ---------------- */
  L("pnma", "PNMA", "Política Nacional do Meio Ambiente", 6938, "31 de agosto de 1981", "Ambiental e Urbanístico", { ultimo: 21 }),
  L("cflo", "Código Florestal", "Código Florestal", 12651, "25 de maio de 2012", "Ambiental e Urbanístico", { ultimo: 84 }),
  L("snuc", "SNUC", "Sistema Nacional de Unidades de Conservação", 9985, "18 de julho de 2000", "Ambiental e Urbanístico", { ultimo: 60 }),
  L("cidade", "Estatuto da Cidade", "Estatuto da Cidade", 10257, "10 de julho de 2001", "Ambiental e Urbanístico", { ultimo: 58 }),

  /* ---------------- Estatutos e Direitos Humanos ---------------- */
  L("eca", "ECA", "Estatuto da Criança e do Adolescente", 8069, "13 de julho de 1990", "Estatutos e Direitos Humanos", { ultimo: 267 }),
  L("idoso", "Pessoa Idosa", "Estatuto da Pessoa Idosa", 10741, "1º de outubro de 2003", "Estatutos e Direitos Humanos", { ultimo: 118 }),
  L("epd", "EPD", "Estatuto da Pessoa com Deficiência", 13146, "6 de julho de 2015", "Estatutos e Direitos Humanos", { ultimo: 127 }),
  L("eir", "Igualdade Racial", "Estatuto da Igualdade Racial", 12288, "20 de julho de 2010", "Estatutos e Direitos Humanos", { ultimo: 65 }),
  L("juv", "Juventude", "Estatuto da Juventude", 12852, "5 de agosto de 2013", "Estatutos e Direitos Humanos", { ultimo: 48 }),
  L("migr", "Migração", "Lei de Migração", 13445, "24 de maio de 2017", "Estatutos e Direitos Humanos", { ultimo: 125 }),

  /* ---------------- Carreiras Jurídicas ---------------- */
  L("eoab", "EOAB", "Estatuto da Advocacia e da OAB", 8906, "4 de julho de 1994", "Carreiras Jurídicas", { ultimo: 87 }),
  L("lonmp", "LONMP", "Lei Orgânica Nacional do Ministério Público", 8625, "12 de fevereiro de 1993", "Carreiras Jurídicas", { ultimo: 84 }),
  LC("ldp", "Defensoria", "Lei Orgânica da Defensoria Pública", 80, "12 de janeiro de 1994", "Carreiras Jurídicas", { ultimo: 149 }),
  LC("loman", "LOMAN", "Lei Orgânica da Magistratura Nacional", 35, "14 de março de 1979", "Carreiras Jurídicas", { ultimo: 147 }),
];

const BASE = "https://www.planalto.gov.br/ccivil_03/";

function faixaDoAto(ano: number): string {
  if (ano <= 2006) return "_ato2004-2006";
  if (ano <= 2010) return "_ato2007-2010";
  if (ano <= 2014) return "_ato2011-2014";
  if (ano <= 2018) return "_ato2015-2018";
  if (ano <= 2022) return "_ato2019-2022";
  return "_ato2023-2026";
}

/* Endereços a tentar, do melhor (texto compilado, sem redação riscada) ao pior. */
export function candidatos(e: Entrada): string[] {
  if (e.urls?.length) return e.urls.map((u) => (u.startsWith("http") ? u : BASE + u));
  const n = String(e.numero);
  const comPonto = n.length > 3 ? `${n.slice(0, -3)}.${n.slice(-3)}` : n;
  const sufixos = ["compilado", "compilada", "consol", "cons", ""];
  const lista: string[] = [];
  const por = (pasta: string, prefixo: string, numeros: string[]) => {
    for (const s of sufixos) for (const num of numeros) lista.push(`${BASE}${pasta}${prefixo}${num}${s}.htm`);
  };
  if (e.tipo === "decreto-lei") {
    por("decreto-lei/", "Del", [n]);
    por("decreto-lei/1937-1946/", "Del", [n]);
    por("decreto-lei/1965-1988/", "Del", [n]);
  } else if (e.tipo === "lcp") {
    por("leis/lcp/", "Lcp", [n]);
  } else if (e.ano >= 2004) {
    por(`${faixaDoAto(e.ano)}/${e.ano}/lei/`, "L", [n]);
  } else if (e.ano >= 2002) {
    por(`leis/${e.ano}/`, "L", [n, comPonto]);
    por("leis/", "L", [n]);
  } else {
    por("leis/", "L", [n]);
    por(`leis/leis_${e.ano}/`, "L", [n]);
    por("leis/1950-1969/", "L", [n]);
    por("leis/1970-1979/", "L", [n]);
    por("leis/1980-1988/", "L", [n]);
    por("leis/1989_1994/", "L", [n]);
  }
  return lista;
}
