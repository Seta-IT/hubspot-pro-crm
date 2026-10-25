// ============================================================================
// Motor Fiscal Brasileiro para ERP Seta Telecom (Padrão GestãoClick)
// Aderente à LC 116/2003, Súmula Vinculante 31 STF, Lei 10.833/2003 e RICMS
// ============================================================================

import {
  ErpFiscalDocumentType,
  ErpTaxBreakdown,
  ErpTaxRegime,
} from '../../db/types';

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function calculateBrazilianTaxBreakdown(params: {
  grossAmount: number;
  discountAmount?: number;
  documentType: ErpFiscalDocumentType;
  taxRegime?: ErpTaxRegime;
  issRatePercent?: number;
}): ErpTaxBreakdown {
  const taxRegime: ErpTaxRegime = params.taxRegime || 'LUCRO_PRESUMIDO';
  const base = Math.max(0, Number(params.grossAmount || 0) - Number(params.discountAmount || 0));

  // 1. NFE_REMESSA_LOCACAO (CFOP 5.908 / 6.908 - Sem incidência tributária)
  if (params.documentType === 'NFE_REMESSA_LOCACAO') {
    return {
      taxRegime,
      issRatePercent: 0,
      issAmount: 0,
      issWithheld: false,
      pisRatePercent: 0,
      pisAmount: 0,
      cofinsRatePercent: 0,
      cofinsAmount: 0,
      irpjEstimatedAmount: 0,
      csllEstimatedAmount: 0,
      irrfWithheldRatePercent: 0,
      irrfWithheldAmount: 0,
      csrfWithheldRatePercent: 0,
      csrfWithheldAmount: 0,
      icmsRatePercent: 0,
      icmsAmount: 0,
      totalTaxesEstimated: 0,
      totalWithheld: 0,
      netReceivableAmount: round2(base),
      legalExemptionNotice:
        'NF-e Modelo 55 — Remessa de bem por conta de contrato de locação (CFOP 5.908 Estadual / 6.908 Interestadual). Não incidência de ICMS (CST 41), IPI (CST 53) e PIS/COFINS (CST 08) por tratar-se de movimentação patrimonial temporária de ativo locado.',
    };
  }

  // 2. FATURA_LOCACAO (Locação Pura de Bens Móveis — Súmula Vinculante 31 STF & Veto 3.01 LC 116/03)
  if (params.documentType === 'FATURA_LOCACAO') {
    const pisRate =
      taxRegime === 'LUCRO_REAL' ? 1.65 : taxRegime === 'SIMPLES_NACIONAL' ? 0.35 : 0.65;
    const cofinsRate =
      taxRegime === 'LUCRO_REAL' ? 7.6 : taxRegime === 'SIMPLES_NACIONAL' ? 1.6 : 3.0;
    const irpjRate =
      taxRegime === 'SIMPLES_NACIONAL' ? 0.8 : taxRegime === 'LUCRO_REAL' ? 3.5 : 4.8;
    const csllRate =
      taxRegime === 'SIMPLES_NACIONAL' ? 0.65 : taxRegime === 'LUCRO_REAL' ? 2.1 : 2.88;

    const pisAmount = round2((base * pisRate) / 100);
    const cofinsAmount = round2((base * cofinsRate) / 100);
    const irpjEstimatedAmount = round2((base * irpjRate) / 100);
    const csllEstimatedAmount = round2((base * csllRate) / 100);
    const totalTaxesEstimated = round2(
      pisAmount + cofinsAmount + irpjEstimatedAmount + csllEstimatedAmount
    );

    return {
      taxRegime,
      issRatePercent: 0,
      issAmount: 0,
      issWithheld: false,
      pisRatePercent: pisRate,
      pisAmount,
      cofinsRatePercent: cofinsRate,
      cofinsAmount,
      irpjEstimatedAmount,
      csllEstimatedAmount,
      irrfWithheldRatePercent: 0,
      irrfWithheldAmount: 0,
      csrfWithheldRatePercent: 0,
      csrfWithheldAmount: 0,
      icmsRatePercent: 0,
      icmsAmount: 0,
      totalTaxesEstimated,
      totalWithheld: 0,
      netReceivableAmount: round2(base),
      legalExemptionNotice:
        'Locação pura de bens móveis sem fornecimento de mão de obra. Não incidência de ISSQN conforme Veto Presidencial ao item 3.01 da Lei Complementar nº 116/2003 e Súmula Vinculante nº 31 do Supremo Tribunal Federal (STF). Dispensada a emissão de NFS-e municipal, servindo a presente Fatura/Recibo de Locação como documento hábil para cobrança e contabilização (Lei nº 8.846/1994, art. 1º). Sem retenção na fonte de IRRF nem de CSRF (PIS/COFINS/CSLL 4,65%) conforme IN RFB nº 1.234/2012.',
    };
  }

  // 3. NFCOM_TELECOM (Modelo 62 - Serviços de Comunicação SCM / SVA)
  if (params.documentType === 'NFCOM_TELECOM') {
    const pisRate = taxRegime === 'LUCRO_REAL' ? 1.65 : 0.65;
    const cofinsRate = taxRegime === 'LUCRO_REAL' ? 7.6 : 3.0;
    const icmsRate = taxRegime === 'SIMPLES_NACIONAL' ? 3.5 : 12.0;
    const pisAmount = round2((base * pisRate) / 100);
    const cofinsAmount = round2((base * cofinsRate) / 100);
    const icmsAmount = round2((base * icmsRate) / 100);
    const irpjEstimatedAmount = round2(base * 0.024);
    const csllEstimatedAmount = round2(base * 0.0144);
    const totalTaxesEstimated = round2(
      pisAmount + cofinsAmount + icmsAmount + irpjEstimatedAmount + csllEstimatedAmount
    );

    return {
      taxRegime,
      issRatePercent: 0,
      issAmount: 0,
      issWithheld: false,
      pisRatePercent: pisRate,
      pisAmount,
      cofinsRatePercent: cofinsRate,
      cofinsAmount,
      irpjEstimatedAmount,
      csllEstimatedAmount,
      irrfWithheldRatePercent: 0,
      irrfWithheldAmount: 0,
      csrfWithheldRatePercent: 0,
      csrfWithheldAmount: 0,
      icmsRatePercent: icmsRate,
      icmsAmount,
      totalTaxesEstimated,
      totalWithheld: 0,
      netReceivableAmount: round2(base),
      legalExemptionNotice:
        'NFCom Modelo 62 (Ajuste SINIEF 7/22) — Faturamento de Serviços de Comunicação Multimídia (SCM - Anatel) e SVA, CFOP 5.303.',
    };
  }

  // 4. NFSE_SERVICO (Serviços Técnicos TI/Telecom - LC 116/2003 Item 01.07 / 14.01)
  const issRate = params.issRatePercent ?? 2.9;
  const issAmount = round2((base * issRate) / 100);

  const pisRate =
    taxRegime === 'LUCRO_REAL' ? 1.65 : taxRegime === 'SIMPLES_NACIONAL' ? 0.35 : 0.65;
  const cofinsRate =
    taxRegime === 'LUCRO_REAL' ? 7.6 : taxRegime === 'SIMPLES_NACIONAL' ? 1.6 : 3.0;
  const pisAmount = round2((base * pisRate) / 100);
  const cofinsAmount = round2((base * cofinsRate) / 100);
  const irpjEstimatedAmount = round2(base * 0.048);
  const csllEstimatedAmount = round2(base * 0.0288);

  // Retenções federais na fonte (IRRF 1,5% + CSRF 4,65% quando aplicável)
  const rawIrrf = taxRegime === 'SIMPLES_NACIONAL' ? 0 : round2(base * 0.015);
  const irrfWithheldAmount = rawIrrf >= 10 ? rawIrrf : 0;
  const irrfWithheldRatePercent = irrfWithheldAmount > 0 ? 1.5 : 0;

  // Art. 31 da Lei 10.833/2003: CSRF 4,65% retida quando valor > R$ 215,05 (gerando retenção >= R$ 10,00)
  const csrfEligible = taxRegime !== 'SIMPLES_NACIONAL' && base > 215.05;
  const csrfWithheldRatePercent = csrfEligible ? 4.65 : 0;
  const csrfWithheldAmount = csrfEligible ? round2(base * 0.0465) : 0;

  const totalWithheld = round2(irrfWithheldAmount + csrfWithheldAmount);
  const totalTaxesEstimated = round2(
    issAmount + pisAmount + cofinsAmount + irpjEstimatedAmount + csllEstimatedAmount
  );

  return {
    taxRegime,
    issRatePercent: issRate,
    issAmount,
    issWithheld: false,
    pisRatePercent: pisRate,
    pisAmount,
    cofinsRatePercent: cofinsRate,
    cofinsAmount,
    irpjEstimatedAmount,
    csllEstimatedAmount,
    irrfWithheldRatePercent,
    irrfWithheldAmount,
    csrfWithheldRatePercent,
    csrfWithheldAmount,
    icmsRatePercent: 0,
    icmsAmount: 0,
    totalTaxesEstimated,
    totalWithheld,
    netReceivableAmount: round2(base - totalWithheld),
    legalExemptionNotice:
      'NFS-e Padrão Nacional (LC 116/2003 Item 01.07 - Suporte técnico em informática, instalação, configuração e manutenção). Retenções federais na fonte calculadas automaticamente: IRRF (1,5%) e CSRF 4,65% (PIS 0,65% + COFINS 3,00% + CSLL 1,00% conforme art. 30/31 da Lei nº 10.833/2003).',
  };
}
