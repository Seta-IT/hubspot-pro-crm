// ============================================================================
// STI-hub — DTO PUBLICO da Proposta Comercial (link assinado para o cliente).
// Modulo puro (sem crypto/Node): usado no servidor (montagem do DTO) e na pagina
// /proposta/[id] (conversao do DTO para o formato que a folha A4 renderiza).
//
// Regra: o cliente ve so o necessario para LER e APROVAR a proposta. Nada de CNPJ,
// e-mail/telefone do vendedor ou do contato, ids internos (proposta, empresa, contato,
// deal, contrato, fatura, itens), SKU/NCM, historico de versoes/status, notas internas,
// IP ou CPF completo do signatario.
// ============================================================================
import type {
  ErpCommercialProposal,
  ErpFiscalNature,
  ErpProposalStatus,
} from '../../db/types';

export interface PublicProposalItemDto {
  description: string;
  itemType: 'PRODUCT' | 'SERVICE';
  /** Natureza do item (locacao, servico, SCM/SVA, venda): define o texto/legenda da linha no documento. */
  fiscalNature: ErpFiscalNature;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  subtotal: number;
  totalMonthly: number;
  isRecurring: boolean;
}

export interface PublicProposalInstallmentDto {
  number: number;
  dueDate: string;
  amount: number;
  paymentMethod: string;
  notes: string | null;
}

export interface PublicProposalAcceptanceDto {
  signerName: string;
  signerRole: string;
  /** CPF mascarado (***.456.789-**): o bloco de assinatura mostra a evidencia sem expor o CPF. */
  signerCpfMasked: string;
  modality: 'ICP_BRASIL_A1' | 'ICP_BRASIL_A3' | 'GOV_BR_OURO';
  certificateIssuer: string;
  signatureHashSha256: string;
  timestampToken: string;
  signedAt: string;
}

export interface PublicProposalDto {
  code: string;
  title: string;
  version: number;
  status: ErpProposalStatus;
  proposalDate: string | null;
  validUntil: string;
  companyName: string;
  sellerName: string;
  // apresentacao do documento
  serviceType: string | null;
  budgetType: ErpCommercialProposal['budgetType'] | null;
  templateStyle: ErpCommercialProposal['templateStyle'] | null;
  modality: ErpCommercialProposal['modality'] | null;
  introductionText: string | null;
  // itens e valores
  items: PublicProposalItemDto[];
  installments: PublicProposalInstallmentDto[];
  productsSubtotal: number | null;
  servicesSubtotal: number | null;
  discountPercentGlobal: number;
  discountAmount: number;
  setupFee: number | null;
  shippingCost: number;
  monthlyRecurringTotal: number;
  oneTimeSetupTotal: number;
  totalContractValue: number;
  // condicoes
  contractMonths: number;
  paymentCondition: string;
  readjustmentIndex: ErpCommercialProposal['readjustmentIndex'] | null;
  deliveryLeadTime: string | null;
  deliveryForecast: string | null;
  deliveryDays: number | null;
  shippingCarrier: string | null;
  slaTier: string | null;
  slaResponseHours: number | null;
  slaAvailabilityPercent: string | null;
  warrantyTerms: string | null;
  technicalScopeNotes: string | null;
  commercialNotes: string;
  technicalClauses: string;
  // aceite (somente depois de aprovada)
  acceptance: PublicProposalAcceptanceDto | null;
}

/** Lista fechada de chaves do DTO (usada nos testes para garantir que nada extra vaza). */
export const PUBLIC_PROPOSAL_DTO_KEYS: ReadonlyArray<keyof PublicProposalDto> = [
  'code', 'title', 'version', 'status', 'proposalDate', 'validUntil', 'companyName', 'sellerName',
  'serviceType', 'budgetType', 'templateStyle', 'modality', 'introductionText',
  'items', 'installments', 'productsSubtotal', 'servicesSubtotal', 'discountPercentGlobal', 'discountAmount',
  'setupFee', 'shippingCost', 'monthlyRecurringTotal', 'oneTimeSetupTotal', 'totalContractValue',
  'contractMonths', 'paymentCondition', 'readjustmentIndex', 'deliveryLeadTime', 'deliveryForecast',
  'deliveryDays', 'shippingCarrier', 'slaTier', 'slaResponseHours', 'slaAvailabilityPercent',
  'warrantyTerms', 'technicalScopeNotes', 'commercialNotes', 'technicalClauses', 'acceptance',
];

const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const optNum = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : num(v));
const optStr = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  return s.trim() ? s : null;
};

export function maskCpf(raw: unknown): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

function inferItemType(it: { itemType?: string; fiscalNature?: string }): 'PRODUCT' | 'SERVICE' {
  if (it.itemType === 'PRODUCT' || it.itemType === 'SERVICE') return it.itemType;
  return it.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' || it.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
    ? 'SERVICE'
    : 'PRODUCT';
}

/** Monta o DTO publico a partir da proposta do servidor (lista branca, campo a campo). */
export function toPublicProposalDto(p: ErpCommercialProposal): PublicProposalDto {
  const sig = p.digitalSignature || null;
  const accepted = Boolean(sig && (p.status === 'APROVADA' || p.status === 'CONVERTIDA_CONTRATO'));
  return {
    code: String(p.code || ''),
    title: String(p.title || ''),
    version: Math.max(1, Math.floor(num(p.version, 1))),
    status: p.status,
    proposalDate: optStr(p.proposalDate),
    validUntil: String(p.validUntil || ''),
    companyName: String(p.companyName || ''),
    sellerName: String(p.sellerName || ''),
    serviceType: optStr(p.serviceType),
    budgetType: p.budgetType ?? null,
    templateStyle: p.templateStyle ?? null,
    modality: p.modality ?? null,
    introductionText: optStr(p.introductionText),
    items: (p.items || []).map((it) => ({
      description: String(it.description || ''),
      itemType: inferItemType(it),
      fiscalNature: it.fiscalNature,
      unit: optStr(it.unit),
      quantity: num(it.quantity, 1),
      unitPrice: num(it.unitPrice),
      discountPercent: num(it.discountPercent),
      discountAmount: num(it.discountAmount),
      subtotal: num(it.subtotal ?? it.totalMonthly),
      totalMonthly: num(it.totalMonthly),
      isRecurring: it.isRecurring !== false,
    })),
    installments: (p.installments || []).map((i) => ({
      number: num(i.number),
      dueDate: String(i.dueDate || ''),
      amount: num(i.amount),
      paymentMethod: String(i.paymentMethod || ''),
      notes: optStr(i.notes),
    })),
    productsSubtotal: optNum(p.productsSubtotal),
    servicesSubtotal: optNum(p.servicesSubtotal),
    discountPercentGlobal: num(p.discountPercentGlobal),
    discountAmount: num(p.discountAmount),
    setupFee: optNum(p.setupFee),
    shippingCost: num(p.shippingCost),
    monthlyRecurringTotal: num(p.monthlyRecurringTotal),
    oneTimeSetupTotal: num(p.oneTimeSetupTotal),
    totalContractValue: num(p.totalContractValue),
    contractMonths: Math.max(1, num(p.contractMonths, 1)),
    paymentCondition: String(p.paymentCondition || ''),
    readjustmentIndex: p.readjustmentIndex ?? null,
    deliveryLeadTime: optStr(p.deliveryLeadTime),
    deliveryForecast: optStr(p.deliveryForecast),
    deliveryDays: optNum(p.deliveryDays),
    shippingCarrier: optStr(p.shippingCarrier),
    slaTier: optStr(p.slaTier),
    slaResponseHours: optNum(p.slaResponseHours),
    slaAvailabilityPercent: optStr(p.slaAvailabilityPercent),
    warrantyTerms: optStr(p.warrantyTerms),
    technicalScopeNotes: optStr(p.technicalScopeNotes),
    commercialNotes: String(p.commercialNotes || ''),
    technicalClauses: String(p.technicalClauses || ''),
    acceptance:
      accepted && sig
        ? {
            signerName: String(sig.signerName || ''),
            signerRole: String(sig.signerRole || ''),
            signerCpfMasked: maskCpf(sig.signerCpf),
            modality: sig.modality,
            certificateIssuer: String(sig.certificateIssuer || ''),
            signatureHashSha256: String(sig.signatureHashSha256 || ''),
            timestampToken: String(sig.timestampToken || ''),
            signedAt: String(sig.signedAt || ''),
          }
        : null,
  };
}

/**
 * Pagina publica: converte o DTO no formato ErpCommercialProposal que a folha A4 ja sabe
 * renderizar. Campos fora do DTO ficam vazios/nulos (nada de CNPJ, contato, ids internos).
 * `routeId` e o identificador que ja esta na URL do link (nao vem do servidor).
 */
export function publicDtoToRenderableProposal(dto: PublicProposalDto, routeId: string): ErpCommercialProposal {
  const nowIso = new Date().toISOString();
  return {
    id: routeId,
    code: dto.code,
    title: dto.title,
    serviceType: dto.serviceType ?? undefined,
    budgetType: dto.budgetType ?? undefined,
    templateStyle: dto.templateStyle ?? undefined,
    modality: dto.modality ?? undefined,
    proposalDate: dto.proposalDate ?? undefined,
    introductionText: dto.introductionText ?? undefined,
    deliveryLeadTime: dto.deliveryLeadTime ?? undefined,
    deliveryForecast: dto.deliveryForecast ?? undefined,
    deliveryDays: dto.deliveryDays ?? undefined,
    shippingCarrier: dto.shippingCarrier ?? undefined,
    shippingCost: dto.shippingCost,
    discountPercentGlobal: dto.discountPercentGlobal,
    discountAmount: dto.discountAmount,
    productsSubtotal: dto.productsSubtotal ?? undefined,
    servicesSubtotal: dto.servicesSubtotal ?? undefined,
    setupFee: dto.setupFee ?? undefined,
    installments: dto.installments.map((i) => ({ ...i, notes: i.notes ?? undefined })),
    companyId: null,
    companyName: dto.companyName,
    companyCnpj: '',
    contactId: null,
    contactName: '',
    dealId: null,
    sellerName: dto.sellerName,
    status: dto.status,
    slaTier: dto.slaTier ?? undefined,
    slaResponseHours: dto.slaResponseHours ?? undefined,
    slaAvailabilityPercent: dto.slaAvailabilityPercent ?? undefined,
    warrantyTerms: dto.warrantyTerms ?? undefined,
    technicalScopeNotes: dto.technicalScopeNotes ?? undefined,
    readjustmentIndex: dto.readjustmentIndex ?? undefined,
    contractMonths: dto.contractMonths,
    paymentCondition: dto.paymentCondition,
    validUntil: dto.validUntil,
    items: dto.items.map((it, idx) => ({
      id: `item-${idx + 1}`,
      sku: '',
      description: it.description,
      itemType: it.itemType,
      unit: it.unit ?? undefined,
      fiscalNature: it.fiscalNature,
      ncmOrServiceCode: '',
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountPercent: it.discountPercent,
      discountAmount: it.discountAmount,
      subtotal: it.subtotal,
      isRecurring: it.isRecurring,
      totalMonthly: it.totalMonthly,
    })),
    monthlyRecurringTotal: dto.monthlyRecurringTotal,
    oneTimeSetupTotal: dto.oneTimeSetupTotal,
    totalContractValue: dto.totalContractValue,
    commercialNotes: dto.commercialNotes,
    technicalClauses: dto.technicalClauses,
    convertedContractId: null,
    digitalSignature: dto.acceptance
      ? {
          signerName: dto.acceptance.signerName,
          signerCpf: dto.acceptance.signerCpfMasked,
          signerRole: dto.acceptance.signerRole,
          modality: dto.acceptance.modality,
          certificateIssuer: dto.acceptance.certificateIssuer,
          certificateSerial: '',
          signatureHashSha256: dto.acceptance.signatureHashSha256,
          timestampToken: dto.acceptance.timestampToken,
          signedAt: dto.acceptance.signedAt,
        }
      : null,
    version: dto.version,
    versionHistory: [],
    createdAt: dto.proposalDate || nowIso,
    updatedAt: nowIso,
  };
}
