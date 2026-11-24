/**
 * Classificação do tipo de orçamento importado do GestãoClick.
 * Usada pelo script de migração (import-proposals.ts) e pelo mapper do sync ao vivo.
 * A sincronização continua só GC → STI-hub; esta regra não regrava orçamentos já existentes.
 */
export type GcBudgetType = 'PRODUTOS' | 'SERVICOS' | 'LOCACAO';
export type GcBudgetConfidence = 'alta' | 'media' | 'baixa';

export interface GcOrcamentoHint {
  nome_centro_custo?: unknown;
  introducao?: unknown;
  observacoes?: unknown;
  observacoes_interna?: unknown;
  condicao_pagamento?: unknown;
  titulo?: unknown;
  produtos?: unknown[];
  servicos?: unknown[];
  atributos?: unknown;
}

export interface GcBudgetTypeResult {
  budgetType: GcBudgetType;
  confidence: GcBudgetConfidence;
  reason: string;
}

const DISCLAIMER = />>>|\*{3}|nota de confidencialidade|confidencialidade e condicoes gerais|as informacoes (constantes|contidas) (desta|nesta) proposta/i;

const BOILER_LOC =
  /vigencia da locacao|prazo e valor da locacao|prazo inicial da locacao|prazo da locacao|modalidade de comodato|propriedade da contratada durante toda a vigencia|enviados ao (contratante|cliente) na modalidade de comodato/i;

const PLACEHOLDER_LOC =
  /solucao de locacao de infraestrutura telecom/i;

export function foldGcText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactUpper(value: unknown): string {
  return foldGcText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function commercialHead(text: unknown): string {
  const folded = foldGcText(text);
  const m = folded.search(DISCLAIMER);
  if (m > 12) return folded.slice(0, m).trim();
  return folded;
}

function itemNames(o: GcOrcamentoHint): string {
  const names: string[] = [];
  for (const entry of o.produtos || []) {
    const p = (entry as { produto?: Record<string, unknown> })?.produto || (entry as Record<string, unknown>);
    names.push(String(p?.nome_produto || p?.description || ''));
  }
  for (const entry of o.servicos || []) {
    const s = (entry as { servico?: Record<string, unknown> })?.servico || (entry as Record<string, unknown>);
    names.push(String(s?.nome_servico || s?.description || ''));
  }
  return foldGcText(names.join(' '));
}

function countLines(o: GcOrcamentoHint): { products: number; services: number } {
  const products = (o.produtos || []).filter(Boolean).length;
  const services = (o.servicos || []).filter(Boolean).length;
  return { products, services };
}

function hasPropLoc(text: string): boolean {
  return (
    /proposta de locaca[op]|proposta locacao|contrato de locacao de \d+|periodo de locacao|locacao pura|locacao de \d+\s*meses|locacao [–-]?\s*\d+\s*meses|locacao de servidores|locacao de switch|locacao de access|locacao de roteador|locacao de firewall|valor locacao mensal|locacao mensal/.test(
      text
    )
  );
}

function hasValorMensal(text: string): boolean {
  return /valor\s+mensal|mensalidade|por\s+mes|\/ *mes\b|r\$\s*[\d.,]+\s*\/\s*mes|pagamento mensal|mensal de\s*r\$/.test(
    text
  );
}

function hasSpareContract(text: string): boolean {
  return /proposta de spare|proposta spare|contrato (de )?spare|spare parts?\s*-?\s*\d+\s*meses|spare part\s*-?\s*\d+\s*meses|abertura de chamado|rma\s*8x5|hard parts/.test(
    text
  );
}

function hasSpareSkuOnly(items: string, head: string): boolean {
  if (!/\bspare\b/.test(items + ' ' + head)) return false;
  if (hasSpareContract(head) || /proposta (de )?spare/.test(head)) return false;
  return /spare\s*\(\s*no acc|series spare|power supply spare|module spare|stacking cable spare|transceiver.?spare|fan spare|psu spare|chassis spare|acc kit|\bspare\b/.test(
    items
  );
}

function isServiceOffer(cc: string, head: string, items: string, onlyServices: boolean): boolean {
  const ccServ = /prestacao de servico|suporte tecnico|consultoria|\baws\b/.test(cc);
  const txt = /prestacao de servicos?|suporte tecnico|consultoria|implementacao aws|manutencao aws|consumo aws|creditos aws|migracao oracle|configuracao \+ instalacao|proposta comercial\s*-?\s*prestacao/.test(
    head + ' ' + items
  );
  const aws = /\baws\b/.test(head + ' ' + cc + ' ' + items);
  return ccServ || txt || aws || onlyServices;
}

/**
 * Ordem aprovada:
 * 1. Centro de custo com LOCA → Locação
 * 2. Texto comercial de proposta/valor mensal/aluguel/comodato (não alocação/colocação) → Locação
 * 3. Proposta de spare / RMA mensal / abertura de chamado → Serviço
 * 4. Prestação, suporte, consultoria ou AWS → Serviço (mesmo citando contrato de locação só como contexto)
 * 5. "Spare" só no SKU → Produtos
 * 6. Só itens de serviço → Serviço
 * 7. Produtos
 *
 * O item curinga "Solução de Locação de Infraestrutura…" do sync antigo não conta como sinal.
 * Cláusula padrão "Prazo inicial da Locação será de XX meses" sozinha não vira Locação (confiança baixa).
 */
export function inferGcProposalBudgetType(o: GcOrcamentoHint): GcBudgetTypeResult {
  const ccCompact = compactUpper(o.nome_centro_custo);
  const cc = foldGcText(o.nome_centro_custo);
  const head = commercialHead(o.introducao) + ' ' + commercialHead(o.titulo);
  const obs = foldGcText(o.observacoes);
  const obsInt = foldGcText(o.observacoes_interna);
  const itemsRaw = itemNames(o).replace(PLACEHOLDER_LOC, ' ');
  const obsSemBoiler = obs.replace(BOILER_LOC, ' ');
  const commercial = `${head} ${itemsRaw} ${obsInt} ${obsSemBoiler}`.replace(PLACEHOLDER_LOC, ' ');
  const { products, services } = countLines(o);
  const onlyServices = services > 0 && products === 0;

  if (ccCompact.includes('LOCA')) {
    return { budgetType: 'LOCACAO', confidence: 'alta', reason: 'centro_custo' };
  }

  if (hasSpareContract(head + ' ' + itemsRaw) || /proposta (de )?spare/.test(head)) {
    if (hasPropLoc(head)) {
      return { budgetType: 'LOCACAO', confidence: 'alta', reason: 'locacao_com_spare' };
    }
    return { budgetType: 'SERVICOS', confidence: 'alta', reason: 'spare_contrato' };
  }

  const servicoOferta = isServiceOffer(cc, head, itemsRaw, onlyServices);
  if (servicoOferta && !hasPropLoc(head)) {
    return { budgetType: 'SERVICOS', confidence: 'alta', reason: 'servico' };
  }

  if (hasPropLoc(head) || (hasPropLoc(commercial) && hasValorMensal(head))) {
    return { budgetType: 'LOCACAO', confidence: 'alta', reason: 'locacao_explicita' };
  }

  if (hasValorMensal(head) && !servicoOferta) {
    return { budgetType: 'LOCACAO', confidence: 'alta', reason: 'valor_mensal' };
  }

  if (hasSpareSkuOnly(itemsRaw, head) && !hasPropLoc(head) && !hasValorMensal(head)) {
    return { budgetType: 'PRODUTOS', confidence: 'alta', reason: 'spare_sku_venda' };
  }

  if (/\b(locacao|locacoes|aluguel|alugueis)\b/.test(head) && !servicoOferta) {
    return { budgetType: 'LOCACAO', confidence: 'media', reason: 'locacao_palavra' };
  }

  if (BOILER_LOC.test(obs) && !hasPropLoc(head) && !hasValorMensal(head)) {
    return { budgetType: 'PRODUTOS', confidence: 'media', reason: 'boilerplate_locacao' };
  }

  if (onlyServices || /prestacao de servico|suporte|consultoria/.test(cc)) {
    return { budgetType: 'SERVICOS', confidence: 'media', reason: 'servico_itens' };
  }

  return { budgetType: 'PRODUTOS', confidence: 'baixa', reason: 'padrao_produtos' };
}

function monthsFromText(text: string): number | null {
  const clean = text.replace(/\bxx\s*meses\b/gi, ' ');
  const patterns = [
    /(?:proposta|contrato|prazo|locacao|spare(?:\s*parts?)?)\s*(?:de\s*)?(?:locacao\s*)?[-–:]?\s*(\d{1,3})\s*meses/i,
    /(\d{1,3})\s*meses/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 1 && n <= 120) return n;
  }
  return null;
}

/** Prazo em meses: atributo "prazo", depois texto comercial. Ignora o "XX meses" do modelo. Padrão: 1. */
export function inferGcContractMonths(o: GcOrcamentoHint): number {
  const attrs = Array.isArray(o.atributos) ? o.atributos : [];
  for (const entry of attrs) {
    const a = (entry as { atributo?: { nome?: string; descricao?: string; conteudo?: string } })?.atributo;
    if (!a) continue;
    if (!/prazo/i.test(String(a.nome || a.descricao || ''))) continue;
    const m = String(a.conteudo || '').match(/(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 120) return n;
    }
  }
  const fromIntro = monthsFromText(commercialHead(o.introducao) + ' ' + commercialHead(o.titulo));
  if (fromIntro) return fromIntro;
  const fromObs = monthsFromText(foldGcText(o.observacoes).replace(BOILER_LOC, ' '));
  if (fromObs) return fromObs;
  return 1;
}

export function fiscalNatureForBudgetType(
  budgetType: GcBudgetType
): 'VENDA_EQUIPAMENTO' | 'LOCACAO_BENS_MOVEIS' | 'SERVICO_TECNICO_TI_TELECOM' {
  if (budgetType === 'LOCACAO') return 'LOCACAO_BENS_MOVEIS';
  if (budgetType === 'SERVICOS') return 'SERVICO_TECNICO_TI_TELECOM';
  return 'VENDA_EQUIPAMENTO';
}
