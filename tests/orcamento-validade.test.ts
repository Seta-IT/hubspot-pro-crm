import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addCalendarDays, calendarDaysBetween, localIsoDate, parseIsoDate } from '../src/app/lib/br-date';
import { buildProposalCopyDraft, recalculateProposalValidity } from '../src/app/lib/proposal-copy';
import {
  DEFAULT_PROPOSAL_VALIDITY_DAYS,
  formatValidityDaysLabel,
  parseValidityDays,
  resolveProposalValidity,
} from '../src/app/lib/proposal-validity';
import { createInMemoryRepository } from '../src/db/repository';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposalEditorSource(): string {
  const form = src('src/app/components/ErpEditModals.tsx');
  const start = form.indexOf('export function ProposalEditModal');
  const end = form.indexOf('export function ContractEditModal');
  return form.slice(start, end);
}

describe('Validade do orçamento = Data + dias (calendário civil)', () => {
  it('soma e conta dias sem deslocar por fuso (UTC ms)', () => {
    assert.equal(parseIsoDate('2026-11-25T20:36:10.035Z'), '2026-11-25');
    assert.equal(parseIsoDate('30/10/2026'), null);
    assert.equal(addCalendarDays('2026-11-25', 15), '2026-12-10');
    assert.equal(addCalendarDays('2026-12-20', 15), '2027-01-04');
    assert.equal(calendarDaysBetween('2026-11-25', '2026-12-10'), 15);
    assert.equal(calendarDaysBetween('2026-11-25', '2026-10-30'), -26);
    assert.equal(parseValidityDays('15 dias'), 15);
    assert.equal(parseValidityDays('1 dia'), 1);
    assert.equal(parseValidityDays('abc'), null);
    assert.equal(formatValidityDaysLabel(1), '1 dia');
    assert.equal(formatValidityDaysLabel(15), '15 dias');
    assert.equal(DEFAULT_PROPOSAL_VALIDITY_DAYS, 15);
  });

  it('resolve Até a partir da Data + dias e corrige validade anterior à Data', () => {
    assert.deepEqual(resolveProposalValidity({ proposalDate: '2026-11-25', validUntil: '2026-12-10' }), {
      proposalDate: '2026-11-25',
      validUntil: '2026-12-10',
      days: 15,
    });
    assert.deepEqual(resolveProposalValidity({ proposalDate: '2026-11-25', validUntil: '2026-10-30' }), {
      proposalDate: '2026-11-25',
      validUntil: '2026-12-10',
      days: 15,
    });
    assert.deepEqual(
      resolveProposalValidity({ proposalDate: '2026-11-25', validUntil: '2026-10-30', validityDays: 20 }),
      { proposalDate: '2026-11-25', validUntil: '2026-12-15', days: 20 }
    );
    assert.deepEqual(resolveProposalValidity({ proposalDate: '2026-11-01', validUntil: '2026-11-11' }), {
      proposalDate: '2026-11-01',
      validUntil: '2026-11-11',
      days: 10,
    });
    const today = localIsoDate(new Date('2026-11-25T18:00:00.000Z'));
    assert.equal(today, '2026-11-25');
    assert.deepEqual(resolveProposalValidity({}, today), {
      proposalDate: '2026-11-25',
      validUntil: '2026-12-10',
      days: 15,
    });
  });

  it('cópia de origem com proposalDate nula e validUntil = createdAt usa hoje + 15 dias', () => {
    const now = new Date('2026-11-25T18:00:00.000Z');
    const evamindLike: Partial<ErpCommercialProposal> = {
      id: 'prop-4699',
      code: '4699',
      title: 'Orçamento #4699 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA',
      budgetType: 'LOCACAO',
      companyName: 'EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA',
      status: 'ENVIADA',
      proposalDate: undefined,
      createdAt: '2026-10-30T12:00:00.000Z',
      validUntil: '2026-10-30',
      items: [],
    };
    assert.equal(recalculateProposalValidity(evamindLike, now), '2026-12-10');
    const copy = buildProposalCopyDraft(evamindLike as ErpCommercialProposal, {
      nextCode: '4727',
      now,
      newId: 'prop-copy-4727',
    });
    assert.equal(copy.proposalDate, '2026-11-25');
    assert.equal(copy.validUntil, '2026-12-10');
    assert.equal(copy.status, 'RASCUNHO');
    assert.equal(copy.version, 1);
  });

  it('formulário recalcula Até ao mudar Data ou dias e não usa Date.now() + ms', () => {
    const editor = proposalEditorSource();
    assert.match(editor, /resolveProposalValidity\(cloned\)/);
    assert.match(editor, /validUntil: resolved\.validUntil/);
    assert.match(editor, /formatValidityDaysLabel\(resolveProposalValidity\(proposal\)\.days\)/);
    assert.match(editor, /onChange=\{\(iso\) => \{/);
    assert.match(editor, /validUntil: addCalendarDays\(iso, days\)/);
    assert.match(editor, /parseValidityDays\(val\)/);
    assert.match(editor, /updateDraft\(\{ validUntil: addCalendarDays\(start, numDays\) \}\)/);
    assert.doesNotMatch(editor, /Date\.now\(\) \+ numDays \* 86400000/);
    assert.doesNotMatch(editor, /validUntil: new Date\(Date\.now\(\)/);
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(tab, /validUntil: addCalendarDays\(localIsoDate\(\), DEFAULT_PROPOSAL_VALIDITY_DAYS\)/);
    assert.match(tab, /proposalDate: localIsoDate\(\)/);
  });

  it('criação e edição no backend recalculam validade incoerente', () => {
    const repo = createInMemoryRepository();
    const created = repo.createProposal({
      title: 'Cópia evamind',
      companyName: 'EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA',
      budgetType: 'LOCACAO',
      status: 'RASCUNHO',
      proposalDate: '2026-11-25',
      validUntil: '2026-10-30',
      items: [],
    } as never);
    assert.equal(created.proposalDate, '2026-11-25');
    assert.equal(created.validUntil, '2026-12-10');

    const kept = repo.createProposal({
      title: 'Janela de 10 dias',
      companyName: 'CLIENTE',
      status: 'RASCUNHO',
      proposalDate: '2026-11-01',
      validUntil: '2026-11-11',
      items: [],
    } as never);
    assert.equal(kept.validUntil, '2026-11-11');

    const updated = repo.updateProposal(kept.id, {
      proposalDate: '2026-11-25',
      validUntil: '2026-10-30',
    });
    assert.ok(updated);
    assert.equal(updated!.proposalDate, '2026-11-25');
    assert.equal(updated!.validUntil, '2026-12-10');

    const repoSrc = src('src/db/repository.ts');
    assert.match(repoSrc, /resolveProposalValidityForSave/);
    assert.match(repoSrc, /candidate\.validUntil = resolvedValidity\.validUntil/);

    const expiredKept = repo.createProposal({
      title: 'Já vencida',
      companyName: 'ARKLOK',
      status: 'ENVIADA',
      validUntil: '2026-11-11',
      items: [],
    } as never);
    assert.equal(expiredKept.validUntil, '2026-11-11');
  });

  it('campos removidos no PR #47 não voltaram no formulário de orçamento', () => {
    const editor = proposalEditorSource();
    assert.doesNotMatch(editor, /Nome da proposta/);
    assert.doesNotMatch(editor, /SLA contratado/);
    assert.doesNotMatch(editor, /Vigência \/ Contrato/);
    assert.match(editor, /proposalSetupFeeLabel\(draft, 'include'\)/);
    assert.match(
      editor,
      /draft\.budgetType !== "PRODUTOS" && draft\.budgetType !== "SPARE_PARTS"/
    );
  });
});
