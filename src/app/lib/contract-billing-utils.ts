import { ErpContractVersionEntry, ErpFiscalInvoice, ErpRentalContract } from '../../db/types';

export interface CustomDueDateRulePreset {
  id: string;
  label: string;
  offsetDays: number;
  targetWeekday: 'NONE' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY';
}

export interface ContractAuxiliaryOptions {
  paymentMethods: string[];
  costCenters: string[];
  chartOfAccountsList: string[];
  emailAutomationOptions: string[];
  recurrenceOptions: Array<{
    id: 'MENSAL' | 'BIMESTRAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
    label: string;
  }>;
  invoiceAdvanceDaysOptions: number[];
  customDueDateRules: CustomDueDateRulePreset[];
}

export const CONTRACT_AUX_STORAGE_KEY = 'seta_erp_contract_aux_options_v1';

export const DEFAULT_CONTRACT_AUX_OPTIONS: ContractAuxiliaryOptions = {
  paymentMethods: [
    'Boleto Inter',
    'Boleto Itaú Seta',
    'Boleto + PIX QR Code',
    'PIX Automático Inter',
    'Transferência / TED Bancária',
    'Cartão de Crédito Recorrente',
  ],
  costCenters: [
    'LOCAÇÃO DE EQUIPAMENTO',
    'SERVIÇOS TÉCNICOS NOC',
    'INFRAESTRUTURA TELECOM / SD-WAN',
    'COMERCIAL / PROJETOS',
  ],
  chartOfAccountsList: [
    'Locação de equipamento',
    'Receita de Serviços de TI / Telecom',
    'Assinaturas Mensais SCM / SVA',
    'Reembolso de Frete / Logística',
  ],
  emailAutomationOptions: [
    'Não enviar e-mail',
    'Enviar lembrete de pagamento e boleto',
    'Enviar somente o lembrete de pagamento',
    'Enviar fatura, boleto, PIX e demonstrativo S/N',
  ],
  recurrenceOptions: [
    { id: 'MENSAL', label: 'A cada 1 mês' },
    { id: 'BIMESTRAL', label: 'A cada 2 meses' },
    { id: 'TRIMESTRAL', label: 'A cada 3 meses' },
    { id: 'SEMESTRAL', label: 'A cada 6 meses' },
    { id: 'ANUAL', label: 'A cada 1 ano' },
  ],
  invoiceAdvanceDaysOptions: [21, 15, 10, 7, 5, 0],
  customDueDateRules: [
    {
      id: 'rule-45-wed',
      label: '45 dias + próxima quarta-feira',
      offsetDays: 45,
      targetWeekday: 'WEDNESDAY',
    },
    {
      id: 'rule-30-thu',
      label: '30 dias + próxima quinta-feira',
      offsetDays: 30,
      targetWeekday: 'THURSDAY',
    },
    {
      id: 'rule-30-wed',
      label: '30 dias + próxima quarta-feira',
      offsetDays: 30,
      targetWeekday: 'WEDNESDAY',
    },
    {
      id: 'rule-30-fri',
      label: '30 dias + próxima sexta-feira',
      offsetDays: 30,
      targetWeekday: 'FRIDAY',
    },
    {
      id: 'rule-60-wed',
      label: '60 dias + próxima quarta-feira',
      offsetDays: 60,
      targetWeekday: 'WEDNESDAY',
    },
    {
      id: 'rule-15-none',
      label: '15 dias corridos',
      offsetDays: 15,
      targetWeekday: 'NONE',
    },
  ],
};

export function loadContractAuxiliaryOptions(): ContractAuxiliaryOptions {
  if (typeof window === 'undefined') return DEFAULT_CONTRACT_AUX_OPTIONS;
  try {
    const raw = window.localStorage.getItem(CONTRACT_AUX_STORAGE_KEY);
    if (!raw) return DEFAULT_CONTRACT_AUX_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<ContractAuxiliaryOptions>;
    return {
      paymentMethods:
        Array.isArray(parsed.paymentMethods) && parsed.paymentMethods.length > 0
          ? parsed.paymentMethods
          : DEFAULT_CONTRACT_AUX_OPTIONS.paymentMethods,
      costCenters:
        Array.isArray(parsed.costCenters) && parsed.costCenters.length > 0
          ? parsed.costCenters
          : DEFAULT_CONTRACT_AUX_OPTIONS.costCenters,
      chartOfAccountsList:
        Array.isArray(parsed.chartOfAccountsList) && parsed.chartOfAccountsList.length > 0
          ? parsed.chartOfAccountsList
          : DEFAULT_CONTRACT_AUX_OPTIONS.chartOfAccountsList,
      emailAutomationOptions:
        Array.isArray(parsed.emailAutomationOptions) && parsed.emailAutomationOptions.length > 0
          ? parsed.emailAutomationOptions
          : DEFAULT_CONTRACT_AUX_OPTIONS.emailAutomationOptions,
      recurrenceOptions:
        Array.isArray(parsed.recurrenceOptions) && parsed.recurrenceOptions.length > 0
          ? parsed.recurrenceOptions
          : DEFAULT_CONTRACT_AUX_OPTIONS.recurrenceOptions,
      invoiceAdvanceDaysOptions:
        Array.isArray(parsed.invoiceAdvanceDaysOptions) && parsed.invoiceAdvanceDaysOptions.length > 0
          ? parsed.invoiceAdvanceDaysOptions
          : DEFAULT_CONTRACT_AUX_OPTIONS.invoiceAdvanceDaysOptions,
      customDueDateRules:
        Array.isArray(parsed.customDueDateRules) && parsed.customDueDateRules.length > 0
          ? parsed.customDueDateRules
          : DEFAULT_CONTRACT_AUX_OPTIONS.customDueDateRules,
    };
  } catch {
    return DEFAULT_CONTRACT_AUX_OPTIONS;
  }
}

export function saveContractAuxiliaryOptions(options: ContractAuxiliaryOptions): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONTRACT_AUX_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // ignore storage errors
  }
}

export function computeCustomDueDateClient(params: {
  baseDate?: string;
  offsetDays: number;
  targetWeekday?: 'NONE' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | null;
  shiftWeekendToMonday?: boolean;
}): {
  baseDateIso: string;
  afterOffsetDateIso: string;
  dueDateIso: string;
  dueDateBr: string;
  weekdayLabelPt: string;
  ruleLabel: string;
} {
  let baseIso = new Date().toISOString().slice(0, 10);
  if (params.baseDate) {
    const raw = String(params.baseDate).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [dd, mm, yyyy] = raw.split('/');
      baseIso = `${yyyy}-${mm}-${dd}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      baseIso = raw.slice(0, 10);
    }
  }
  const parsedBase = new Date(`${baseIso}T12:00:00Z`);
  const safeBase = Number.isNaN(parsedBase.getTime()) ? new Date() : parsedBase;
  const offsetDays = Math.max(0, Math.round(Number(params.offsetDays) || 0));
  const afterOffset = new Date(safeBase.getTime() + offsetDays * 86400000);
  const afterOffsetDateIso = afterOffset.toISOString().slice(0, 10);

  const weekdayMap: Record<string, { dow: number; pt: string; ruleText: string }> = {
    MONDAY: { dow: 1, pt: 'Segunda-feira', ruleText: 'próxima segunda-feira' },
    TUESDAY: { dow: 2, pt: 'Terça-feira', ruleText: 'próxima terça-feira' },
    WEDNESDAY: { dow: 3, pt: 'Quarta-feira', ruleText: 'próxima quarta-feira' },
    THURSDAY: { dow: 4, pt: 'Quinta-feira', ruleText: 'próxima quinta-feira' },
    FRIDAY: { dow: 5, pt: 'Sexta-feira', ruleText: 'próxima sexta-feira' },
  };

  const targetKey =
    params.targetWeekday && params.targetWeekday !== 'NONE' ? params.targetWeekday : null;
  let finalDate = new Date(afterOffset.getTime());
  if (targetKey && weekdayMap[targetKey]) {
    const targetDow = weekdayMap[targetKey].dow;
    const currentDow = finalDate.getUTCDay();
    let delta = (targetDow - currentDow + 7) % 7;
    if (delta === 0 && offsetDays === 0) {
      delta = 7;
    }
    finalDate = new Date(finalDate.getTime() + delta * 86400000);
  } else if (params.shiftWeekendToMonday) {
    const dow = finalDate.getUTCDay();
    if (dow === 6) finalDate = new Date(finalDate.getTime() + 2 * 86400000);
    else if (dow === 0) finalDate = new Date(finalDate.getTime() + 1 * 86400000);
  }

  const dueDateIso = finalDate.toISOString().slice(0, 10);
  const [y, m, d] = dueDateIso.split('-');
  const dueDateBr = `${d}/${m}/${y}`;
  const ptWeekdays = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado',
  ];
  const weekdayLabelPt = ptWeekdays[finalDate.getUTCDay()] || 'Quarta-feira';
  const ruleLabel =
    targetKey && weekdayMap[targetKey]
      ? `${offsetDays} dias + ${weekdayMap[targetKey].ruleText}`
      : `${offsetDays} dias corridos`;

  return {
    baseDateIso: safeBase.toISOString().slice(0, 10),
    afterOffsetDateIso,
    dueDateIso,
    dueDateBr,
    weekdayLabelPt,
    ruleLabel,
  };
}

export function matchInvoicesForContract(
  contract: ErpRentalContract,
  allInvoices: ErpFiscalInvoice[]
): ErpFiscalInvoice[] {
  return allInvoices.filter((inv) => {
    if (inv.rentalContractId && (inv.rentalContractId === contract.id || inv.rentalContractId === contract.contractNumber)) {
      return true;
    }
    if (inv.contractNumber && (inv.contractNumber === contract.contractNumber || inv.contractNumber === contract.id)) {
      return true;
    }
    if (contract.proposalId && inv.proposalId && inv.proposalId === contract.proposalId) {
      return true;
    }
    const cleanInvCnpj = (inv.companyCnpj || '').replace(/\D+/g, '');
    const cleanCtrCnpj = (contract.companyCnpj || '').replace(/\D+/g, '');
    if (
      cleanInvCnpj.length >= 11 &&
      cleanInvCnpj === cleanCtrCnpj &&
      (inv.documentType === 'FATURA_LOCACAO' || inv.documentType === 'NFE_REMESSA_LOCACAO')
    ) {
      return true;
    }
    return false;
  });
}

export function computeUpcomingRecurringCycles(
  contract: ErpRentalContract,
  count = 6
): Array<{
  cycleIndex: number;
  competenceMonth: string;
  dueDateIso: string;
  dueDateBr: string;
  expectedAmountBrl: number;
  recurrenceLabel: string;
  ruleLabel: string | null;
}> {
  const stepMonths =
    contract.billingRecurrence === 'BIMESTRAL'
      ? 2
      : contract.billingRecurrence === 'TRIMESTRAL'
        ? 3
        : contract.billingRecurrence === 'SEMESTRAL'
          ? 6
          : contract.billingRecurrence === 'ANUAL'
            ? 12
            : 1;
  const recurrenceLabel =
    contract.billingRecurrence === 'BIMESTRAL'
      ? 'A cada 2 meses'
      : contract.billingRecurrence === 'TRIMESTRAL'
        ? 'A cada 3 meses'
        : contract.billingRecurrence === 'SEMESTRAL'
          ? 'A cada 6 meses'
          : contract.billingRecurrence === 'ANUAL'
            ? 'A cada 1 ano'
            : 'A cada 1 mês';

  const baseDateStr =
    contract.nextBillingDate ||
    contract.nextDueDate ||
    `2026-11-${String(contract.dueDay || 10).padStart(2, '0')}`;
  const parsed = new Date(`${baseDateStr.slice(0, 10)}T12:00:00Z`);
  const startBase = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const out: Array<{
    cycleIndex: number;
    competenceMonth: string;
    dueDateIso: string;
    dueDateBr: string;
    expectedAmountBrl: number;
    recurrenceLabel: string;
    ruleLabel: string | null;
  }> = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(startBase.getTime());
    d.setUTCMonth(d.getUTCMonth() + i * stepMonths);
    const comp = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    let dueDateIso = d.toISOString().slice(0, 10);
    let ruleLabel: string | null = null;
    if (contract.customDueRuleEnabled && contract.customDueOffsetDays !== undefined) {
      const issueRef = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
      const calc = computeCustomDueDateClient({
        baseDate: issueRef,
        offsetDays: contract.customDueOffsetDays,
        targetWeekday: contract.customDueTargetWeekday || 'WEDNESDAY',
      });
      dueDateIso = calc.dueDateIso;
      ruleLabel = contract.customDueRuleLabel || calc.ruleLabel;
    }
    const [yy, mm, dd] = dueDateIso.split('-');
    out.push({
      cycleIndex: (contract.billedInstallmentsCount || 0) + i + 1,
      competenceMonth: comp,
      dueDateIso,
      dueDateBr: `${dd}/${mm}/${yy}`,
      expectedAmountBrl: contract.monthlyValue,
      recurrenceLabel,
      ruleLabel,
    });
  }
  return out;
}

function formatMoneyBr(val: number | undefined | null): string {
  const n = Number(val || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildStandaloneInvoiceHtml(
  invoice: ErpFiscalInvoice,
  contract?: ErpRentalContract | null
): string {
  const ctrNum = invoice.contractNumber || contract?.contractNumber || 'LOC-SETA';
  const propNum = invoice.proposalNumber || contract?.proposalNumber || '—';
  const remNfe = invoice.remessaNfeNumber || contract?.remessaNfeNumber || '—';
  const termLabel =
    invoice.contractTermLabel ||
    contract?.contractTermLabel ||
    (contract?.contractMonths ? `${contract.contractMonths} meses` : '24 meses');
  const seller = invoice.sellerName || contract?.sellerName || 'Marcelo Mira';
  const costCenter = invoice.costCenter || contract?.costCenter || 'LOCAÇÃO DE EQUIPAMENTO';
  const chartOfAccounts =
    invoice.chartOfAccounts || contract?.chartOfAccounts || 'Locação de equipamento';
  const poNum =
    invoice.customerPurchaseOrderNumber || contract?.customerPurchaseOrderNumber || '—';
  const bmNum = invoice.measurementNumber || contract?.measurementNumber || '—';
  const bmPeriod =
    invoice.measurementPeriod || contract?.measurementPeriod || invoice.competenceMonth;
  const bmNotes = invoice.measurementNotes || contract?.measurementNotes || '';
  const paymentMethod =
    invoice.paymentMethodLabel || contract?.paymentMethod || invoice.paymentMethod || 'Boleto Inter';
  const dueRule =
    invoice.customDueRuleLabel ||
    contract?.customDueRuleLabel ||
    (contract?.dueDay ? `Dia ${contract.dueDay} de cada mês` : 'Vencimento contratual');
  const emails =
    (invoice.billingRecipientEmails && invoice.billingRecipientEmails.length > 0
      ? invoice.billingRecipientEmails
      : contract?.billingRecipientEmails) || [];

  const prodSubtotal =
    invoice.productsSubtotalBrl ?? contract?.productsSubtotalBrl ?? invoice.grossAmount;
  const additionBrl = invoice.additionValueBrl ?? contract?.additionValueBrl ?? 0;
  const discountBrl = invoice.discountAmount ?? contract?.discountValueBrl ?? 0;
  const discountPct = invoice.discountPercent ?? contract?.discountPercent ?? 0;
  const freightBrl = invoice.freightValueBrl ?? contract?.freightValueBrl ?? 0;
  const deliveryCity = invoice.deliveryCity || contract?.deliveryCity || 'São Paulo';
  const deliveryAddress =
    invoice.deliveryAddress || contract?.deliveryAddress || invoice.companyAddress;
  const deliveryCarrier =
    invoice.deliveryCarrier || contract?.deliveryCarrier || 'Frota / Transportadora Credenciada';
  const deliveryDate = invoice.deliveryDate || contract?.deliveryDate || '—';
  const pickupDate = invoice.pickupDate || contract?.pickupDate || '—';
  const notes = invoice.contractNotes || contract?.contractNotes || '';

  const rowsHtml = (invoice.itemsDescription || [])
    .map(
      (it) => `
      <tr>
        <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:10px;">${it.description}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:9.5px;">${it.serialNumber || '—'}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:10px;">${Number(it.quantity).toFixed(2).replace('.', ',')}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:10px;">${formatMoneyBr(it.unitValue)}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:10px;">${formatMoneyBr(it.totalValue)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Recibo / Fatura de Locação ${invoice.documentNumber} - 1 Página A4 Única</title>
  <style>
    @page { size: A4 portrait; margin: 7mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 8px; font-size: 10.5px; line-height: 1.28; background: #fff; }
    .page { width: 196mm; max-height: 282mm; margin: 0 auto; overflow: hidden; page-break-after: avoid; page-break-inside: avoid; break-inside: avoid; box-sizing: border-box; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0d2b4e; padding-bottom: 6px; margin-bottom: 7px; }
    .box { border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; background: #f8fafc; page-break-inside: avoid; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
    .grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .label { font-size: 8.5px; text-transform: uppercase; color: #64748b; font-weight: 700; display: block; }
    .val { font-size: 10.5px; font-weight: 700; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; page-break-inside: avoid; }
    th { background: #0d2b4e; color: #fff; text-transform: uppercase; font-size: 9px; padding: 5px 6px; text-align: left; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; margin: 0; }
      .page { width: 196mm; max-height: 282mm; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:196mm;margin:0 auto 8px auto;display:flex;justify-content:space-between;align-items:center;background:#0d2b4e;color:#fff;padding:7px 12px;border-radius:5px;">
    <span><strong>Recibo / Fatura de Locação ${invoice.documentNumber}</strong> — Formato Compacto: 1 Página A4 Única (0 MB em disco)</span>
    <button onclick="window.print()" style="background:#ff7a59;color:#fff;border:none;padding:5px 12px;border-radius:4px;font-weight:bold;cursor:pointer;">Imprimir em 1 Página A4 / Salvar PDF</button>
  </div>
  <div class="page">
    <div class="header">
      <div>
        <div style="font-size:14px;font-weight:900;color:#0d2b4e;">SETA TELECOM LTDA</div>
        <div style="font-size:9.5px;">CNPJ: 14.806.925/0001-32 • IE: 149.882.110.112 • IM: 4.112.890-1 • Regime: ${invoice.taxBreakdown?.taxRegime || 'LUCRO_PRESUMIDO'}</div>
      </div>
      <div style="text-align:right;background:#f1f5f9;padding:5px 9px;border-radius:4px;border:1px solid #cbd5e1;">
        <div style="font-size:8.5px;font-weight:800;color:#1e3a6e;">FATURA / RECIBO DE LOCAÇÃO DE BENS MÓVEIS (0% ISS — SV 31 STF) • 1 PÁGINA A4 ÚNICA</div>
        <div style="font-size:15px;font-weight:900;color:#0d2b4e;">Nº ${invoice.documentNumber}</div>
        <div style="font-size:9.5px;">Competência: <strong>${invoice.competenceMonth}</strong> • Emissão: <strong>${invoice.issueDate}</strong> • Vencimento: <strong>${invoice.dueDate}</strong></div>
        <div style="font-size:8.5px;color:#047857;font-weight:700;">Regra de Vencimento: ${dueRule}</div>
      </div>
    </div>

    <div class="box">
      <div style="font-weight:800;color:#0d2b4e;margin-bottom:4px;text-transform:uppercase;font-size:9.5px;">1. Locatário, Pedido do Cliente (PO) &amp; Boletim de Medição (BM)</div>
      <div class="grid-4">
        <div><span class="label">Locatário / Cliente</span><span class="val">${invoice.companyName}</span></div>
        <div><span class="label">CNPJ</span><span class="val">${invoice.companyCnpj}</span></div>
        <div><span class="label">Nº Pedido do Cliente (PO)</span><span class="val">${poNum}</span></div>
        <div><span class="label">Boletim de Medição (BM)</span><span class="val">${bmNum} (${bmPeriod})</span></div>
      </div>
      ${bmNotes ? `<div style="margin-top:3px;font-size:9.5px;color:#334155;"><strong>Obs. Medição:</strong> ${bmNotes}</div>` : ''}
      ${emails.length > 0 ? `<div style="margin-top:2px;font-size:9.5px;color:#1e3a6e;"><strong>Destinatários de E-mail (${emails.length}):</strong> ${emails.join(', ')}</div>` : ''}
    </div>

    <div class="box">
      <div style="font-weight:800;color:#0d2b4e;margin-bottom:4px;text-transform:uppercase;font-size:9.5px;">2. Dados do Contrato, Logística &amp; Classificação GestãoClick</div>
      <div class="grid-4">
        <div><span class="label">Contrato n.</span><span class="val">${ctrNum} (${contract?.versionLabel || 'v1.0'})</span></div>
        <div><span class="label">Proposta</span><span class="val">${propNum}</span></div>
        <div><span class="label">Nota Fiscal de Remessa</span><span class="val">${remNfe}</span></div>
        <div><span class="label">Prazo do Contrato</span><span class="val">${termLabel}</span></div>
        <div><span class="label">Vendedor</span><span class="val">${seller}</span></div>
        <div><span class="label">Centro de Custo</span><span class="val">${costCenter}</span></div>
        <div><span class="label">Plano de Contas</span><span class="val">${chartOfAccounts}</span></div>
        <div><span class="label">Forma de Pagamento</span><span class="val">${paymentMethod}</span></div>
        <div><span class="label">Cidade Entrega</span><span class="val">${deliveryCity}</span></div>
        <div><span class="label">Transportadora</span><span class="val">${deliveryCarrier}</span></div>
        <div><span class="label">Entrega / Retirada</span><span class="val">${deliveryDate} / ${pickupDate}</span></div>
        <div><span class="label">Endereço</span><span class="val">${deliveryAddress}</span></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Produto / Equipamento Locado</th>
          <th>Nº de Série (S/N)</th>
          <th style="text-align:right;">Quantidade</th>
          <th style="text-align:right;">Vr. Unitário</th>
          <th style="text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="box" style="background:#f0fdf4;border-color:#86efac;">
      <div style="font-weight:800;color:#065f46;margin-bottom:4px;text-transform:uppercase;font-size:9.5px;">3. Confira o Total da Locação (Produtos, Acréscimo, Desconto e Frete)</div>
      <div class="grid-5">
        <div><span class="label">Produtos (Soma)</span><span class="val">${formatMoneyBr(prodSubtotal)}</span></div>
        <div><span class="label">Acréscimo (R$)</span><span class="val">${formatMoneyBr(additionBrl)}</span></div>
        <div><span class="label">Desconto (R$ / %)</span><span class="val">${formatMoneyBr(discountBrl)} (${Number(discountPct).toFixed(2)}%)</span></div>
        <div><span class="label">Frete (${invoice.freightModality || contract?.freightModality || 'CIF'})</span><span class="val">${formatMoneyBr(freightBrl)}</span></div>
        <div><span class="label">Valor Total da Fatura</span><span class="val" style="font-size:12.5px;color:#065f46;">${formatMoneyBr(invoice.netAmount)}</span></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="box" style="margin-bottom:0;">
        <div style="font-weight:800;color:#065f46;margin-bottom:3px;text-transform:uppercase;font-size:9.5px;">4. Enquadramento Fiscal (0% ISS — SV 31 STF)</div>
        <div style="font-size:9.5px;color:#065f46;">
          ${invoice.taxBreakdown?.legalExemptionNotice || 'Locação pura de bens móveis sem incidência de ISSQN conforme Súmula Vinculante 31 do STF e Veto ao Item 3.01 da LC 116/2003.'}
        </div>
        <div style="margin-top:3px;font-size:9px;font-family:monospace;color:#334155;">
          ISS: R$ 0,00 (0%) • CFOP: ${invoice.cfop || 'N/A'} • CST ICMS: ${invoice.cstIcms || '41'}
        </div>
        ${notes ? `<div style="margin-top:3px;font-size:9px;color:#334155;"><strong>Obs.:</strong> ${notes}</div>` : ''}
      </div>
      <div class="box" style="background:#f1f5f9;margin-bottom:0;">
        <div style="font-weight:800;color:#0f172a;margin-bottom:3px;text-transform:uppercase;font-size:9.5px;">5. Liquidação Financeira (${paymentMethod})</div>
        <div style="font-family:monospace;font-size:9.5px;margin-bottom:3px;"><strong>Linha Digitável:</strong> ${invoice.boletoDigitableLine}</div>
        <div style="font-family:monospace;font-size:9px;word-break:break-all;"><strong>PIX Copia e Cola:</strong> ${invoice.pixCopyPaste}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export const buildPrintableRentalInvoiceHtml = buildStandaloneInvoiceHtml;
export function downloadInvoicePdfOnDemand(
  invoice: ErpFiscalInvoice,
  contract?: ErpRentalContract | null,
  mode: 'DOWNLOAD' | 'PRINT' = 'DOWNLOAD'
): void {
  if (typeof window === 'undefined') return;
  const html = buildStandaloneInvoiceHtml(invoice, contract);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  if (mode === 'PRINT') {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoice.documentNumber}-${(contract?.contractNumber || 'CONTRATO').replace(/[^a-zA-Z0-9-_]/g, '_')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadContractInvoicesCsvOnDemand(
  contract: ErpRentalContract,
  contractInvoices: ErpFiscalInvoice[]
): void {
  if (typeof window === 'undefined') return;
  const headers = [
    'Nº Fatura / Documento',
    'Tipo Fiscal',
    'Competência',
    'Data Emissão',
    'Data Vencimento',
    'Regra de Vencimento',
    'Contrato n.',
    'Proposta',
    'NF Remessa',
    'Prazo do Contrato',
    'Nº Pedido Cliente (PO)',
    'Nº Medição (BM)',
    'Período Medição',
    'Vendedor',
    'Centro de Custo',
    'Plano de Contas',
    'Forma de Pagamento',
    'Cidade Entrega',
    'Produtos (R$)',
    'Acréscimo (R$)',
    'Desconto (R$)',
    'Desconto (%)',
    'Frete (R$)',
    'Valor Bruto (R$)',
    'Valor Líquido (R$)',
    'Status',
    'Destinatários de E-mail',
  ];

  const escapeCsv = (val: unknown) => {
    const s = String(val ?? '').replace(/\r?\n/g, ' ').trim();
    if (s.includes(';') || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = contractInvoices.map((inv) => [
    inv.documentNumber,
    inv.documentType,
    inv.competenceMonth,
    inv.issueDate,
    inv.dueDate,
    inv.customDueRuleLabel || contract.customDueRuleLabel || `Dia ${contract.dueDay}`,
    inv.contractNumber || contract.contractNumber,
    inv.proposalNumber || contract.proposalNumber || '',
    inv.remessaNfeNumber || contract.remessaNfeNumber || '',
    inv.contractTermLabel || contract.contractTermLabel || `${contract.contractMonths} meses`,
    inv.customerPurchaseOrderNumber || contract.customerPurchaseOrderNumber || '',
    inv.measurementNumber || contract.measurementNumber || '',
    inv.measurementPeriod || contract.measurementPeriod || '',
    inv.sellerName || contract.sellerName || 'Marcelo Mira',
    inv.costCenter || contract.costCenter || 'LOCAÇÃO DE EQUIPAMENTO',
    inv.chartOfAccounts || contract.chartOfAccounts || 'Locação de equipamento',
    inv.paymentMethodLabel || contract.paymentMethod || 'Boleto Inter',
    inv.deliveryCity || contract.deliveryCity || 'São Paulo',
    Number(inv.productsSubtotalBrl ?? contract.productsSubtotalBrl ?? inv.grossAmount).toFixed(2).replace('.', ','),
    Number(inv.additionValueBrl ?? contract.additionValueBrl ?? 0).toFixed(2).replace('.', ','),
    Number(inv.discountAmount ?? contract.discountValueBrl ?? 0).toFixed(2).replace('.', ','),
    Number(inv.discountPercent ?? contract.discountPercent ?? 0).toFixed(2).replace('.', ','),
    Number(inv.freightValueBrl ?? contract.freightValueBrl ?? 0).toFixed(2).replace('.', ','),
    Number(inv.grossAmount || 0).toFixed(2).replace('.', ','),
    Number(inv.netAmount || 0).toFixed(2).replace('.', ','),
    inv.status,
    (inv.billingRecipientEmails || contract.billingRecipientEmails || []).join(', '),
  ]);

  const csvBody = [
    headers.map(escapeCsv).join(';'),
    ...rows.map((r) => r.map(escapeCsv).join(';')),
  ].join('\r\n');

  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Historico-Faturas-Contrato-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadContractBillingHistoryReportOnDemand(
  contract: ErpRentalContract,
  contractInvoices: ErpFiscalInvoice[],
  mode: 'DOWNLOAD' | 'PRINT' = 'DOWNLOAD'
): void {
  if (typeof window === 'undefined') return;
  const totalGross = contractInvoices.reduce((s, i) => s + Number(i.grossAmount || 0), 0);
  const totalNet = contractInvoices.reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const rowsHtml = contractInvoices
    .map(
      (inv) => `
      <tr>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-weight:700;">${inv.documentNumber}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${inv.documentType}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${inv.competenceMonth}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${inv.issueDate}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;">${inv.dueDate}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${inv.customerPurchaseOrderNumber || contract.customerPurchaseOrderNumber || '—'}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${inv.measurementNumber || contract.measurementNumber || '—'}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">${formatMoneyBr(inv.netAmount)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${inv.status}</td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Extrato de Faturamentos - Contrato ${contract.contractNumber}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 24px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #0d2b4e; color: #fff; text-transform: uppercase; font-size: 10px; padding: 8px; text-align: left; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;background:#0d2b4e;color:#fff;padding:10px 14px;border-radius:6px;">
    <span><strong>Histórico Completo de Faturas — Contrato ${contract.contractNumber}</strong> (Gerado sob demanda — 0 MB em disco)</span>
    <button onclick="window.print()" style="background:#ff7a59;color:#fff;border:none;padding:6px 14px;border-radius:4px;font-weight:bold;cursor:pointer;">Imprimir / Salvar PDF</button>
  </div>
  <h2 style="margin:0 0 4px 0;color:#0d2b4e;">Extrato de Faturamentos &amp; Notas do Contrato ${contract.contractNumber}</h2>
  <p style="margin:0 0 12px 0;color:#475569;">
    Cliente: <strong>${contract.companyName}</strong> (${contract.companyCnpj}) • Proposta: <strong>${contract.proposalNumber || '—'}</strong> • NF Remessa: <strong>${contract.remessaNfeNumber}</strong> • Vendedor: <strong>${contract.sellerName || 'Marcelo Mira'}</strong> • Centro de Custo: <strong>${contract.costCenter || 'LOCAÇÃO DE EQUIPAMENTO'}</strong> • Plano de Contas: <strong>${contract.chartOfAccounts || 'Locação de equipamento'}</strong>
  </p>
  <div style="display:flex;gap:16px;padding:10px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;">
    <div>Total de Documentos: <strong>${contractInvoices.length}</strong></div>
    <div>Total Bruto Acumulado: <strong>${formatMoneyBr(totalGross)}</strong></div>
    <div>Total Líquido Acumulado: <strong>${formatMoneyBr(totalNet)}</strong></div>
    <div>Mensalidade Atual: <strong>${formatMoneyBr(contract.monthlyValue)}</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Nº Documento</th>
        <th>Tipo</th>
        <th>Competência</th>
        <th>Emissão</th>
        <th>Vencimento</th>
        <th>Pedido Cliente (PO)</th>
        <th>Medição (BM)</th>
        <th style="text-align:right;">Valor Líquido</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  if (mode === 'PRINT') {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = `Relatorio-Faturas-Contrato-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ============================================================================
// Minutas de Contrato por Tipo (Locação vs. Serviços vs. Assinatura) + Impressão A4
// ============================================================================

export type ContractDocumentModality = 'LOCACAO' | 'SERVICO' | 'ASSINATURA' | 'HIBRIDO';

export interface ContractDocumentTemplate {
  key: 'LOCACAO' | 'SERVICO' | 'ASSINATURA';
  title: string;
  shortLabel: string;
  legalBasis: string;
  clauses: string[];
}

export const CONTRACT_DOCUMENT_TEMPLATES: Record<'LOCACAO' | 'SERVICO' | 'ASSINATURA', ContractDocumentTemplate> = {
  LOCACAO: {
    key: 'LOCACAO',
    title: 'Contrato de Locação de Bens Móveis / Equipamentos — Aluguel / HaaS',
    shortLabel: 'Aluguel',
    legalBasis: 'Arts. 565 a 578 do Código Civil (Lei 10.406/2002) e Súmula Vinculante 31 do STF',
    clauses: [
      'CLÁUSULA 1ª — DO OBJETO: Locação pura de bens móveis (equipamentos de TI e Telecom — Hardware as a Service/HaaS), nos termos dos Arts. 565 a 578 do Código Civil, sem prestação de serviço agregada ao valor locatício.',
      'CLÁUSULA 2ª — DA NATUREZA TRIBUTÁRIA: Por se tratar de locação de bens móveis, não há incidência de ISS, conforme Súmula Vinculante 31 do STF. A cobrança será realizada mediante Fatura Comercial de Locação.',
      'CLÁUSULA 3ª — DA REMESSA: Os equipamentos serão remetidos ao LOCATÁRIO acompanhados de NF-e de Remessa em Locação/Comodato, CFOP 5.908 (operação interna) ou 6.908 (operação interestadual), permanecendo de propriedade da LOCADORA.',
      'CLÁUSULA 4ª — DA GUARDA E CONSERVAÇÃO: O LOCATÁRIO obriga-se a servir-se dos equipamentos para o uso convencionado, guardá-los e conservá-los como se seus fossem (Art. 569 do CC), respondendo por danos decorrentes de mau uso, extravio ou sinistro.',
      'CLÁUSULA 5ª — DA DEVOLUÇÃO: Ao término da vigência ou rescisão, o LOCATÁRIO restituirá os equipamentos no estado em que os recebeu, salvo deteriorações naturais do uso regular, mediante NF-e de retorno e termo de devolução com conferência de números de série.',
      'CLÁUSULA 6ª — DO REAJUSTE: O valor locatício será reajustado anualmente pelo índice indicado neste instrumento.',
    ],
  },
  SERVICO: {
    key: 'SERVICO',
    title: 'Contrato de Prestação de Serviços Técnicos de TI & Telecomunicações',
    shortLabel: 'Serviço',
    legalBasis: 'Arts. 593 a 609 do Código Civil e Lei Complementar 116/2003 (ISS)',
    clauses: [
      'CLÁUSULA 1ª — DO OBJETO: Prestação de serviços técnicos especializados de TI e Telecomunicações, compreendendo Suporte Técnico, monitoramento NOC (Network Operations Center), Manutenção Preventiva e Corretiva.',
      'CLÁUSULA 2ª — DO SLA DE ATENDIMENTO: A CONTRATADA observará os níveis de serviço (SLA) de atendimento: chamados críticos em até 4h, altos em até 8h e normais em até 24h úteis, com registro de protocolo.',
      'CLÁUSULA 3ª — DA NATUREZA TRIBUTÁRIA: Os serviços serão faturados mediante emissão de NFS-e, com incidência de ISS conforme a Lei Complementar 116/2003 e a legislação do município competente.',
      'CLÁUSULA 4ª — DAS OBRIGAÇÕES DA CONTRATADA: Executar os serviços com técnicos qualificados, manter sigilo das informações, emitir relatórios de atendimento e cumprir o SLA pactuado.',
      'CLÁUSULA 5ª — DAS OBRIGAÇÕES DA CONTRATANTE: Permitir o acesso físico e remoto aos ambientes, indicar responsável técnico e efetuar os pagamentos nos vencimentos.',
      'CLÁUSULA 6ª — DO REAJUSTE: Os valores serão reajustados anualmente pelo índice indicado neste instrumento.',
    ],
  },
  ASSINATURA: {
    key: 'ASSINATURA',
    title: 'Termo de Assinatura Recorrente / Cloud, Licenciamento & Telecom SCM/SVA',
    shortLabel: 'Assinatura',
    legalBasis: 'Código Civil, Marco Civil da Internet (Lei 12.965/2014) e regulamentação ANATEL SCM/SVA',
    clauses: [
      'CLÁUSULA 1ª — DO OBJETO: Disponibilização contínua, em nuvem e por assinatura mensal, de plataformas, licenças de software e serviços de telecomunicações SCM/SVA.',
      'CLÁUSULA 2ª — DA RENOVAÇÃO AUTOMÁTICA: A assinatura renova-se automaticamente a cada ciclo de cobrança, salvo manifestação contrária com antecedência mínima de 30 dias.',
      'CLÁUSULA 3ª — DOS NÍVEIS DE DISPONIBILIDADE: A CONTRATADA envidará esforços para disponibilidade mínima de 99,5% mensal, excetuadas janelas de manutenção programada comunicadas previamente.',
      'CLÁUSULA 4ª — DA COBRANÇA RECORRENTE: O valor da assinatura será cobrado de forma recorrente por boleto, PIX ou cartão, no vencimento de cada ciclo, mediante link de cobrança.',
      'CLÁUSULA 5ª — DO CANCELAMENTO: O cancelamento produz efeitos ao final do ciclo vigente, sem reembolso proporcional, salvo disposição em contrário.',
    ],
  },
};

export function resolveContractDocumentTemplate(modality: ContractDocumentModality): ContractDocumentTemplate[] {
  if (modality === 'HIBRIDO') return [CONTRACT_DOCUMENT_TEMPLATES.LOCACAO, CONTRACT_DOCUMENT_TEMPLATES.SERVICO];
  return [CONTRACT_DOCUMENT_TEMPLATES[modality]];
}

function escHtml(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function brl(v: number): string {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildStandaloneContractA4Html(
  contract: ErpRentalContract,
  modality: ContractDocumentModality,
  customClauses?: string
): string {
  const templates = resolveContractDocumentTemplate(modality);
  const docTitle = templates.map((t) => t.title).join(' + ');
  const eqRows = (contract.equipments || [])
    .map(
      (e) =>
        `<tr><td>${escHtml(e.skuGestaoClick)}</td><td>${escHtml(e.description)}</td><td>${escHtml(e.serialNumber || '—')}</td><td style="text-align:right">${escHtml(e.quantity)}</td></tr>`
    )
    .join('');
  const clausesHtml = templates
    .map(
      (t) =>
        `<h2>${escHtml(t.title)}</h2><p class="basis">Fundamento legal: ${escHtml(t.legalBasis)}</p>${t.clauses.map((c) => `<p>${escHtml(c)}</p>`).join('')}`
    )
    .join('');
  const extra = (customClauses ?? contract.customClausesText ?? '').trim();
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escHtml(docTitle)} — Nº ${escHtml(contract.contractNumber)}</title>
<style>@page{size:A4;margin:18mm}body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:12px;line-height:1.5}h1{font-size:17px;color:#0d2b4e;border-bottom:3px solid #ff7a59;padding-bottom:6px}h2{font-size:13px;color:#1e3a6e;margin-top:18px}.basis{font-style:italic;color:#475569}table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#1e3a6e;color:#fff}.sig{display:flex;gap:40px;margin-top:50px}.sig div{flex:1;border-top:1px solid #0f172a;text-align:center;padding-top:4px}</style></head><body>
<h1>${escHtml(docTitle)}</h1>
<p><strong>Contrato Nº:</strong> ${escHtml(contract.contractNumber)} &nbsp; <strong>Tipo:</strong> ${escHtml(templates.map((t) => t.shortLabel).join(' / '))}</p>
<table><tr><th colspan="2">Partes</th></tr>
<tr><td><strong>CONTRATADA / LOCADORA</strong></td><td>SETA TELECOM</td></tr>
<tr><td><strong>CONTRATANTE / LOCATÁRIO</strong></td><td>${escHtml(contract.companyName)} — CNPJ ${escHtml(contract.companyCnpj || '—')}</td></tr></table>
<table><tr><th>Valor mensal</th><th>Vencimento</th><th>Vigência</th><th>Reajuste</th></tr>
<tr><td>${brl(contract.monthlyValue)}</td><td>Dia ${escHtml(contract.dueDay)}</td><td>${escHtml(contract.startDate)} a ${escHtml(contract.endDate)} (${escHtml(contract.contractMonths)} meses)</td><td>${escHtml(contract.readjustmentIndex)}</td></tr></table>
${eqRows ? `<table><tr><th>SKU</th><th>Descrição</th><th>S/N</th><th>Qtd</th></tr>${eqRows}</table>` : ''}
${clausesHtml}
${extra ? `<h2>Cláusulas Adicionais</h2><p>${escHtml(extra).replace(/\n/g, '<br/>')}</p>` : ''}
<p>E, por estarem justas e contratadas, as partes assinam o presente instrumento, podendo fazê-lo por assinatura digital ICP-Brasil / Gov.br.</p>
<div class="sig"><div>SETA TELECOM</div><div>${escHtml(contract.companyName)}</div></div>
</body></html>`;
}

export function printOrDownloadContractA4(
  contract: ErpRentalContract,
  modality: ContractDocumentModality,
  customClauses?: string
): void {
  if (typeof window === 'undefined') return;
  const html = buildStandaloneContractA4Html(contract, modality, customClauses);
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
    return;
  }
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contrato-${contract.contractNumber}-${modality.toLowerCase()}-A4.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadContractVersionPdfOnDemand(
  contract: ErpRentalContract,
  versionEntry: ErpContractVersionEntry,
  mode: 'DOWNLOAD' | 'PRINT' = 'PRINT'
): void {
  if (typeof window === 'undefined') return;
  const snapContract: ErpRentalContract = {
    ...contract,
    ...(versionEntry.snapshot || {}),
    version: versionEntry.versionNumber,
    versionLabel: versionEntry.versionLabel,
  };
  const modality = (snapContract.modality || 'LOCACAO') as ContractDocumentModality;
  const html = buildStandaloneContractA4Html(
    snapContract,
    modality,
    `Revisão Histórica ${versionEntry.versionLabel} (${versionEntry.savedAt}) — ${versionEntry.changeSummary}\n${snapContract.customClausesText || ''}`
  );
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  if (mode === 'PRINT') {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (w) {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = `Contrato-${snapContract.contractNumber}-${versionEntry.versionLabel}-SobDemanda.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
