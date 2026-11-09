// ============================================================================
// STI-hub ERP - Limpeza visual dos blocos de contrato, Financeiro e NF-e de importação.
// Padrão GestaoClick: cor única accent (#1e3a6e), botões em outline neutro, etiquetas em
// pílula cinza e nenhum texto técnico interno visível ao usuário. Sem rede: leitura das fontes.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanVersionSummary } from '../src/app/components/ContractBillingPanels';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const withoutCleaner = (s: string) => s.replace(/export function cleanVersionSummary[\s\S]*?\n}\n/, '');

const panels = withoutCleaner(src('src/app/components/ContractBillingPanels.tsx'));
const editModals = src('src/app/components/ErpEditModals.tsx');
const contractAndInvoiceModals = editModals.slice(editModals.indexOf('export function ContractEditModal('));
const files: Record<string, string> = {
  ContractBillingPanels: panels,
  'ErpEditModals (Contrato/Fatura)': contractAndInvoiceModals,
  SebraeImportNfeWorkspace: src('src/app/components/SebraeImportNfeWorkspace.tsx'),
  ErpFinanceiroAndBanksView: src('src/app/components/ErpFinanceiroAndBanksView.tsx'),
  GestaoClickEnrichedModals: src('src/app/components/GestaoClickEnrichedModals.tsx'),
  'contract-billing-utils': src('src/app/lib/contract-billing-utils.ts'),
};

describe('Limpeza visual - contratos, Financeiro e NF-e de importação', () => {
  it('sem laranja HubSpot (#ff7a59 / #e86646) nos componentes do ERP limpos', () => {
    for (const [name, s] of Object.entries(files)) {
      assert.doesNotMatch(s, /#ff7a59|#e86646/i, name);
    }
  });

  it('sem textos técnicos internos visíveis', () => {
    for (const [name, s] of Object.entries(files)) {
      assert.doesNotMatch(s, /MB em disco|MB PDF em disco|JSON leve|Metadados JSON|PDFs? gerados? sob demanda|desta versão sob demanda/i, name);
    }
  });

  it('títulos curtos e todas as ações por linha mantidas', () => {
    assert.match(panels, /Faturamentos do contrato/);
    assert.match(panels, /Versões anteriores|Versões do contrato/);
    for (const label of ['Visualizar', 'Baixar PDF', 'Editar', 'E-mail', 'Ver no Fiscal', 'Ver no Contas a Receber', 'Restaurar', '+ Faturar']) {
      assert.ok(panels.includes(label), label);
    }
    assert.doesNotMatch(panels, /bg-emerald-900|border-2 border-emerald|bg-indigo-700|bg-amber-500/);
    assert.match(panels, /bg-slate-50 text-slate-600 uppercase/);
  });

  it('resumo de versões antigas exibido sem trechos técnicos', () => {
    assert.equal(cleanVersionSummary('Versão inicial v1.0 do contrato LOC-1 (Metadados JSON leves — 0 MB PDF em disco)'), 'Versão inicial v1.0 do contrato LOC-1');
    assert.equal(cleanVersionSummary('Revisão v2.0: Valor Mensal (0 MB PDF em disco)'), 'Revisão v2.0: Valor Mensal');
  });
});
