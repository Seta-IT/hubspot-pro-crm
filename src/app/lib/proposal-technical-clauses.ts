/**
 * Textos padrão do bloco "Condições Técnicas de Execução" para propostas
 * de suporte técnico (budgetType SERVICOS cujo tipo inclui "Suporte Técnico").
 *
 * Duas variantes, escolhidas pela vigência gravada:
 * - mensal/contrato: SERVICOS com contractMonths !== 1
 * - único/pontual (avulso): SERVICOS com contractMonths === 1 (isAvulsoServiceProposal)
 *
 * Outros tipos de proposta não usam estes textos.
 */
import type { ErpCommercialProposal } from '../../db/types';
import {
  cleanProposalTechnicalClauses,
  isAvulsoServiceProposal,
  resolveProposalCommercialFigures,
  resolveProposalDeliveryLeadTime,
  resolveProposalServiceType,
  serviceTypeIncludesTechnicalSupport,
} from './proposal-share';

type SupportProposalInput = Partial<
  Pick<
    ErpCommercialProposal,
    | 'budgetType'
    | 'serviceType'
    | 'contractMonths'
    | 'monthlyRecurringTotal'
    | 'totalContractValue'
    | 'deliveryLeadTime'
    | 'deliveryForecast'
    | 'items'
    | 'modality'
    | 'commercialNotes'
    | 'introductionText'
    | 'title'
    | 'paymentCondition'
  >
>;

export function isTechnicalSupportProposal(
  proposal: Pick<SupportProposalInput, 'budgetType' | 'serviceType'>
): boolean {
  if (String(proposal.budgetType || '').toUpperCase() !== 'SERVICOS') return false;
  return serviceTypeIncludesTechnicalSupport(
    resolveProposalServiceType({
      budgetType: 'SERVICOS',
      serviceType: proposal.serviceType || undefined,
    })
  );
}

export const TECHNICAL_SUPPORT_CONFIDENTIALITY =
  'As informações contidas nesta proposta comercial são de caráter sigiloso, com intuito de evitar a divulgação a terceiros de qualquer informação trocada entre as partes, que estejam diretamente relacionadas ao serviço prestado ao cliente. Este termo de confidencialidade é firmado com o intuito de proibir a divulgação e utilização não autorizada das informações confidenciais trocadas entre as PARTES por ocasião da realização do Serviço contratado pelo CLIENTE, mediante proposta assinada pelo mesmo.';

export const TECHNICAL_SUPPORT_ITEM_1 =
  '1. O objeto desta proposta é a prestação de serviços de suporte técnico, nas modalidades remota e/ou presencial, conforme escopo, horas e níveis de atendimento (SLA) descritos nesta proposta.';

export const TECHNICAL_SUPPORT_ITEM_3 =
  '3. Os atendimentos serão abertos pelos canais oficiais da Seta Telecom (portal de chamados, e-mail ou telefone) e registrados em chamado, com acompanhamento até o encerramento.';

export const TECHNICAL_SUPPORT_ITEM_4 =
  '4. Não estão inclusos nesta proposta o fornecimento de equipamentos, peças, licenças de software ou serviços fora do escopo descrito, que, se necessários, serão orçados à parte.';

export const TECHNICAL_SUPPORT_ITEM_5_MONTHLY =
  '5. Será concedido o prazo de 10 dias úteis para assinatura do Contrato de Prestação de Serviços pela Contratante, a contar do aceite desta proposta.';

export const TECHNICAL_SUPPORT_ITEM_5_AVULSO =
  '5. A execução do serviço será iniciada após o aceite formal desta proposta pela Contratante.';

function formatClauseAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'XXXXXXX';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function monthsPlaceholder(months: number): string {
  return Number.isFinite(months) && months > 1 ? String(Math.trunc(months)) : 'XX';
}

function daysPlaceholder(deliveryLeadTime: string): string {
  const match = String(deliveryLeadTime || '').match(/(\d+)\s*dias?/i);
  return match ? match[1] : 'XX';
}

function item2Monthly(months: string, amount: string): string {
  return `2. O prazo inicial da prestação de serviços será de ${months} meses, podendo ser prorrogado, caso haja interesse das partes. O valor mensal do suporte técnico é de R$ ${amount}.`;
}

function item2Avulso(days: string, amount: string): string {
  return `2. O serviço será executado em atendimento único, no prazo de ${days} dias úteis a contar do aceite desta proposta, pelo valor total de R$ ${amount}.`;
}

function supportAmount(proposal: SupportProposalInput, avulso: boolean, figuresMonthly: number): string {
  if (avulso) {
    const total = Number(proposal.totalContractValue || 0);
    return formatClauseAmount(total > 0 ? total : figuresMonthly);
  }
  return formatClauseAmount(figuresMonthly);
}

export function buildDefaultTechnicalSupportItem2(proposal: SupportProposalInput): string {
  const avulso = isAvulsoServiceProposal(proposal);
  const figures = resolveProposalCommercialFigures(proposal);
  const amount = supportAmount(proposal, avulso, figures.monthly);
  if (avulso) {
    return item2Avulso(daysPlaceholder(resolveProposalDeliveryLeadTime(proposal)), amount);
  }
  const months = figures.months > 0 ? figures.months : Number(proposal.contractMonths || 0);
  return item2Monthly(monthsPlaceholder(months), amount);
}

export function buildDefaultTechnicalSupportItem5(proposal: SupportProposalInput): string {
  return isAvulsoServiceProposal(proposal)
    ? TECHNICAL_SUPPORT_ITEM_5_AVULSO
    : TECHNICAL_SUPPORT_ITEM_5_MONTHLY;
}

export function buildDefaultTechnicalSupportClauseParts(proposal: SupportProposalInput): {
  confidentiality: string;
  clauses: Array<{ title: string; body: string }>;
} {
  const item2 = buildDefaultTechnicalSupportItem2(proposal);
  const item5 = buildDefaultTechnicalSupportItem5(proposal);
  const split = (text: string) => {
    const idx = text.indexOf(' ');
    return {
      title: idx === -1 ? text : text.slice(0, idx).replace(/\.$/, ''),
      body: idx === -1 ? text : text.slice(idx + 1),
    };
  };
  return {
    confidentiality: TECHNICAL_SUPPORT_CONFIDENTIALITY,
    clauses: [
      split(TECHNICAL_SUPPORT_ITEM_1),
      split(item2),
      split(TECHNICAL_SUPPORT_ITEM_3),
      split(TECHNICAL_SUPPORT_ITEM_4),
      split(item5),
    ],
  };
}

export function buildDefaultTechnicalSupportClauses(proposal: SupportProposalInput): string {
  return [
    TECHNICAL_SUPPORT_CONFIDENTIALITY,
    TECHNICAL_SUPPORT_ITEM_1,
    buildDefaultTechnicalSupportItem2(proposal),
    TECHNICAL_SUPPORT_ITEM_3,
    TECHNICAL_SUPPORT_ITEM_4,
    buildDefaultTechnicalSupportItem5(proposal),
  ].join(' ');
}

function normalizeSupportClauseText(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/R\$\s*[\d.]+,\d{2}/g, 'R$ XXXXXXX')
    .replace(/de \d+ meses/g, 'de XX meses')
    .replace(/prazo de \d+ dias úteis/gi, 'prazo de XX dias úteis')
    .trim();
}

export function isDefaultTechnicalSupportClauses(text: string | undefined): boolean {
  const normalized = normalizeSupportClauseText(text || '');
  if (!normalized) return false;
  const monthly = normalizeSupportClauseText(
    buildDefaultTechnicalSupportClauses({
      budgetType: 'SERVICOS',
      serviceType: 'Suporte Técnico',
      contractMonths: 24,
    })
  );
  const avulso = normalizeSupportClauseText(
    buildDefaultTechnicalSupportClauses({
      budgetType: 'SERVICOS',
      serviceType: 'Suporte Técnico',
      contractMonths: 1,
    })
  );
  return normalized === monthly || normalized === avulso;
}

/** Texto antigo de locação/equipamentos copiado nas observações de suporte técnico. */
export function looksLikeLegacyEquipmentTechnicalClauses(text: string | undefined): boolean {
  const raw = String(text || '').toLowerCase();
  if (!raw.trim()) return false;
  const markers = [
    /comodato/,
    /nf-?e?\s+de\s+remessa/,
    /cfop\s*5\.?908/,
    /contrato de loca[cç][aã]o/,
    /prazo inicial da loca[cç][aã]o/,
    /remessa dos equipamentos/,
    /faturamento para aquisi[cç][aã]o/,
    /faturar(?:\s+os)?\s+equipamentos/,
    /processos de importa[cç][aã]o/,
  ];
  return markers.filter((re) => re.test(raw)).length >= 2;
}

/**
 * Atualiza o texto padrão só quando o campo está vazio ou ainda é o template.
 * Texto digitado ou copiado (inclusive o antigo de locação) permanece intacto.
 * Se o patch trouxer technicalClauses, vale o que o usuário digitou.
 */
export function resolveTechnicalClausesOnEdit(
  previous: SupportProposalInput & { technicalClauses?: string },
  next: SupportProposalInput & { technicalClauses?: string },
  patch: Partial<SupportProposalInput & { technicalClauses?: string }>
): string {
  if (Object.prototype.hasOwnProperty.call(patch, 'technicalClauses')) {
    return String(next.technicalClauses || '');
  }
  const current = String(next.technicalClauses || '');
  const currentIsDefault = !current.trim() || isDefaultTechnicalSupportClauses(current);
  if (isTechnicalSupportProposal(next) && currentIsDefault) {
    return buildDefaultTechnicalSupportClauses(next);
  }
  if (!isTechnicalSupportProposal(next) && isDefaultTechnicalSupportClauses(current)) {
    return '';
  }
  return current;
}

/** Texto exibido na proposta: o gravado, ou o padrão de suporte quando o campo está vazio. */
export function displayProposalTechnicalClauses(
  proposal: SupportProposalInput & { technicalClauses?: string }
): string {
  const stored = cleanProposalTechnicalClauses(proposal.technicalClauses);
  if (stored) return stored;
  if (isTechnicalSupportProposal(proposal)) {
    return buildDefaultTechnicalSupportClauses(proposal);
  }
  return '';
}
