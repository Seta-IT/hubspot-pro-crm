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
  icmsRatePercent?: number;
}): ErpTaxBreakdown {
  const taxRegime: ErpTaxRegime = params.taxRegime || 'LUCRO_PRESUMIDO';
  const base = Math.max(0, Number(params.grossAmount || 0) - Number(params.discountAmount || 0));

  // 0. NFE_IMPORTACAO (NF-e Modelo 55 - Entrada de Importação Direta do Exterior CFOP 3.102 / 3.551 — Simples Nacional CSOSN 900 — Emissor Sebrae 4.01)
  if (params.documentType === 'NFE_IMPORTACAO') {
    const icmsRate = params.icmsRatePercent ?? 18.0;
    const pisRate = 2.1; // PIS-Importação (Lei 10.865/2004)
    const cofinsRate = 9.65; // COFINS-Importação (Lei 10.865/2004)
    const pisAmount = round2((base * pisRate) / 100);
    const cofinsAmount = round2((base * cofinsRate) / 100);
    const icmsAmount = round2((base * icmsRate) / 100);
    const totalTaxesEstimated = round2(icmsAmount + pisAmount + cofinsAmount);

    return {
      taxRegime: 'SIMPLES_NACIONAL',
      issRatePercent: 0,
      issAmount: 0,
      issWithheld: false,
      pisRatePercent: pisRate,
      pisAmount,
      cofinsRatePercent: cofinsRate,
      cofinsAmount,
      irpjEstimatedAmount: 0,
      csllEstimatedAmount: 0,
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
        'DANFE NF-e Modelo 55 (Layout 4.00 SEFAZ / Emissor Sebrae 4.01) — Nota Fiscal de Entrada de Importação Direta do Exterior (CFOP 3.102 Comercialização / 3.551 Ativo Imobilizado). Emitente optante pelo Simples Nacional (CRT=1, CSOSN 900 - Outros, Origem 1 - Estrangeira Importação Direta). Base de Cálculo do ICMS calculada "por dentro" conforme Art. 13, V da LC 87/1996, incluindo Valor Aduaneiro CIF, II, IPI, PIS-Importação (2,10%), COFINS-Importação (9,65%), Taxa SISCOMEX e Despesas Aduaneiras.',
    };
  }

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

  // 2. NFE_VENDA_PRODUTO (NF-e Modelo 55 - Venda de Mercadoria / Equipamento CFOP 5.102 / 6.102)
  if (params.documentType === 'NFE_VENDA_PRODUTO') {
    const icmsRate =
      params.icmsRatePercent ?? (taxRegime === 'SIMPLES_NACIONAL' ? 3.95 : 18.0);
    const pisRate =
      taxRegime === 'LUCRO_REAL' ? 1.65 : taxRegime === 'SIMPLES_NACIONAL' ? 0.35 : 0.65;
    const cofinsRate =
      taxRegime === 'LUCRO_REAL' ? 7.6 : taxRegime === 'SIMPLES_NACIONAL' ? 1.6 : 3.0;
    const irpjRate =
      taxRegime === 'SIMPLES_NACIONAL' ? 0.5 : taxRegime === 'LUCRO_REAL' ? 1.5 : 1.2; // 8% presunção comércio * 15%
    const csllRate =
      taxRegime === 'SIMPLES_NACIONAL' ? 0.35 : 1.08; // 12% presunção comércio * 9%

    const icmsAmount = round2((base * icmsRate) / 100);
    const pisAmount = round2((base * pisRate) / 100);
    const cofinsAmount = round2((base * cofinsRate) / 100);
    const irpjEstimatedAmount = round2((base * irpjRate) / 100);
    const csllEstimatedAmount = round2((base * csllRate) / 100);
    const totalTaxesEstimated = round2(
      icmsAmount + pisAmount + cofinsAmount + irpjEstimatedAmount + csllEstimatedAmount
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
        'DANFE NF-e Modelo 55 — Venda de Mercadoria/Equipamento de Telecomunicações e Informática (CFOP 5.102 Operação Interna / 6.102 Interestadual). Tributação comercial com destaque de ICMS (CST 00), PIS (0,65%) e COFINS (3,00%) CST 01, IRPJ presumido comércio (1,20%) e CSLL (1,08%). Sem retenção na fonte de IRRF/CSRF.',
    };
  }

  // 3. NFCE_CONSUMIDOR (NFC-e Modelo 65 - Nota Fiscal de Consumidor Eletrônica - Venda Balcão CFOP 5.102)
  if (params.documentType === 'NFCE_CONSUMIDOR') {
    const icmsRate =
      params.icmsRatePercent ?? (taxRegime === 'SIMPLES_NACIONAL' ? 3.95 : 18.0);
    const pisRate =
      taxRegime === 'LUCRO_REAL' ? 1.65 : taxRegime === 'SIMPLES_NACIONAL' ? 0.35 : 0.65;
    const cofinsRate =
      taxRegime === 'LUCRO_REAL' ? 7.6 : taxRegime === 'SIMPLES_NACIONAL' ? 1.6 : 3.0;
    const irpjRate = taxRegime === 'SIMPLES_NACIONAL' ? 0.5 : 1.2;
    const csllRate = taxRegime === 'SIMPLES_NACIONAL' ? 0.35 : 1.08;

    const icmsAmount = round2((base * icmsRate) / 100);
    const pisAmount = round2((base * pisRate) / 100);
    const cofinsAmount = round2((base * cofinsRate) / 100);
    const irpjEstimatedAmount = round2((base * irpjRate) / 100);
    const csllEstimatedAmount = round2((base * csllRate) / 100);
    const totalTaxesEstimated = round2(
      icmsAmount + pisAmount + cofinsAmount + irpjEstimatedAmount + csllEstimatedAmount
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
        'DANFE NFC-e Modelo 65 (Ajuste SINIEF 19/16) — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica para venda presencial/balcão a consumidor final (CFOP 5.102). Tributos aproximados conforme Lei Federal nº 12.741/2012 (De Olho no Imposto / IBPT).',
    };
  }

  // 4. FATURA_LOCACAO (Locação Pura de Bens Móveis — Súmula Vinculante 31 STF & Veto 3.01 LC 116/03)
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

  // 5. NFCOM_TELECOM (Modelo 62 - Serviços de Comunicação SCM / SVA)
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

  // 6. NFSE_SERVICO (Serviços Técnicos TI/Telecom - LC 116/2003 Item 01.07 / 14.01)
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
