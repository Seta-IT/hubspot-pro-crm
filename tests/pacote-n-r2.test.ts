// ============================================================================
// STI-hub — Pacote N (02/11/2026), commit 5 (R2): o editor interno nao grava ?d= na barra de endereco.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('Pacote N (R2): sem ?d= no editor interno', () => {
  it('page.tsx nao escreve "d" na URL e remove o ?d= que existir', () => {
    const s = src('src/app/proposta/[id]/page.tsx');
    assert.ok(!/searchParams\.set\(\s*["']d["']/.test(s));
    assert.ok(!s.includes('encodeProposalToQueryParam'));
    assert.equal((s.match(/url\.searchParams\.delete\("d"\)/g) || []).length, 5);
  });
  it('buildProposalVersionUrl removida de proposal-share.ts', () => {
    assert.ok(!src('src/app/lib/proposal-share.ts').includes('buildProposalVersionUrl'));
  });
});
