import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildProposalDisplayCodeMap,
  formatProposalDisplayCode,
  migrateLegacyProposalCodes,
  nextGcProposalNumber,
} from '../src/app/lib/proposal-number';
import { formatProposalCode } from '../src/db/record-id-guard';
import { createInMemoryRepository } from '../src/db/repository';

describe('Numeracao de orcamentos no padrao GestaoClick', () => {
  it('converte GC-ORC-N e PROP-2026-00N para o numero GC e segue max+1', () => {
    assert.equal(formatProposalDisplayCode('GC-ORC-4696'), '4696');
    assert.equal(formatProposalDisplayCode('PROP-2026-001'), '4699');
    assert.equal(formatProposalDisplayCode('#4695'), '4695');
    assert.equal(formatProposalCode(4704), '4704');
    const list = [
      { id: 'prop-gc-4695', code: '4695', createdAt: '2026-10-26' },
      { id: 'prop-gc-408248511', code: 'GC-ORC-4695', createdAt: '2026-10-26' },
      { id: 'prop-gc-409056266', code: 'GC-ORC-4698', createdAt: '2026-10-29' },
      { id: 'prop-seta-001', code: 'PROP-2026-001', createdAt: '2026-10-08' },
      { id: 'prop-user-7', code: 'PROP-2026-007', createdAt: '2026-11-01' },
    ];
    const display = buildProposalDisplayCodeMap(list);
    assert.equal(display.get('prop-gc-408248511'), '4695');
    assert.equal(display.get('prop-seta-001'), '4699');
    assert.equal(display.get('prop-user-7'), '4700');
    migrateLegacyProposalCodes(list);
    assert.deepEqual(list.map((p) => p.code), ['4695', 'GC-ORC-4695', '4698', '4699', '4700']);
    assert.equal(nextGcProposalNumber(list.map((p) => p.code)), 4701);
  });

  it('repositorio: seeds com numero GC, ids de rota preservados e novo orcamento = max+1 sem PROP-AAAA', () => {
    const repo = createInMemoryRepository();
    const byId = new Map(repo.listProposals().map((p) => [p.id, p.code] as const));
    assert.equal(byId.get('prop-gc-4695'), '4695');
    assert.equal(byId.get('prop-seta-001'), '4699');
    assert.equal(byId.get('prop-seta-002'), '4700');
    assert.ok(!repo.listProposals().some((p) => /^PROP-\d{4}-/i.test(String(p.code))));
    const created = repo.createProposal({ title: 'Novo orcamento' });
    assert.match(created.code, /^\d+$/);
    const nums = repo.listProposals().filter((p) => p.id !== created.id).map((p) => Number(p.code)).filter(Number.isFinite);
    assert.equal(Number(created.code), Math.max(...nums) + 1);
  });

  it('proposta publica: Pilares sempre abertos (sem <details>) e codigo exibido no padrao GC', () => {
    const pageSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.equal(pageSrc.includes('<details'), false);
    assert.equal(pageSrc.includes('Ver Pilares'), false);
    assert.ok(pageSrc.includes('Pilares de Soluções &amp; Arquitetura Seta Telecom'));
    assert.ok(pageSrc.includes('data-testid="proposal-pillars"'));
    assert.ok(pageSrc.includes('{displayCode}'));
    assert.equal(pageSrc.includes('{proposal.code}'), false);
  });
});
