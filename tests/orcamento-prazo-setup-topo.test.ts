import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposalEditorSource(): string {
  const form = src('src/app/components/ErpEditModals.tsx');
  const start = form.indexOf('export function ProposalEditModal');
  const end = form.indexOf('export function ContractEditModal');
  return form.slice(start, end);
}

describe('Prazo do contrato e Incluir setup ao lado do Tipo de orçamento', () => {
  it('os dois campos ficam na mesma linha do Tipo, no início do card, e saem da linha do CNPJ', () => {
    const editor = proposalEditorSource();
    const headerStart = editor.indexOf('Dados do orçamento');
    const bodyStart = editor.indexOf('LINHA 1 DO GESTÃOCLICK');
    const typeRowStart = editor.indexOf('data-testid="proposal-type-row"');
    assert.ok(headerStart > 0 && typeRowStart > headerStart && typeRowStart < bodyStart);

    const typeRow = editor.slice(typeRowStart, bodyStart);
    assert.match(typeRow, /ariaLabel="Tipo de orçamento"/);
    assert.match(typeRow, /Prazo do contrato \(meses\)/);
    assert.match(typeRow, /proposalSetupFeeLabel\(draft, 'include'\)/);
    assert.match(typeRow, /draft\.budgetType !== "PRODUTOS"/);
    assert.match(typeRow, /draft\.budgetType !== "PRODUTOS" && draft\.budgetType !== "SPARE_PARTS"/);
    assert.match(typeRow, /turningAvulso/);

    const line3 = editor.slice(editor.indexOf('LINHA 3:'), editor.indexOf('LINHA DE CONFIGURAÇÃO POR TIPO'));
    assert.doesNotMatch(line3, /Prazo do contrato/);
    assert.doesNotMatch(line3, /setupFee/);
    assert.match(line3, /CNPJ ou CPF/);
    assert.match(line3, /sm:col-span-8/);
    assert.equal([...editor.matchAll(/Prazo do contrato \(meses\)/g)].length, 1);
    assert.equal([...editor.matchAll(/proposalSetupFeeLabel\(draft, 'include'\)/g)].length, 1);
  });
});
