// ============================================================================
// t126u: saudação do STI-HUB MAILER sem nome da empresa no "Olá,".
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClientEmailGreeting } from '../src/app/lib/client-email-greeting';

describe('t126u: saudação do ClientEmailComposerModal sem empresa', () => {
  it('com nome de pessoa => "Olá, Nome," (sem empresa entre parênteses)', () => {
    assert.equal(
      buildClientEmailGreeting({ recipientName: 'Pedro Castro', companyName: 'GOLDEN LAND LTDA' }),
      'Olá, Pedro Castro,'
    );
    assert.doesNotMatch(
      buildClientEmailGreeting({ recipientName: 'Pedro Castro', companyName: 'GOLDEN LAND LTDA' }),
      /GOLDEN|\(/
    );
  });

  it('sem nome, ou nome igual à empresa => só "Olá,"', () => {
    assert.equal(buildClientEmailGreeting({ recipientName: '', companyName: 'GOLDEN LAND LTDA' }), 'Olá,');
    assert.equal(buildClientEmailGreeting({ recipientName: undefined, companyName: 'GOLDEN LAND LTDA' }), 'Olá,');
    assert.equal(
      buildClientEmailGreeting({ recipientName: 'GOLDEN LAND LTDA', companyName: 'GOLDEN LAND LTDA' }),
      'Olá,'
    );
    assert.equal(
      buildClientEmailGreeting({ recipientName: 'golden land ltda', companyName: 'GOLDEN LAND LTDA' }),
      'Olá,'
    );
  });

  it('PROPOSAL e TICKET_REPLY usam buildClientEmailGreeting; boleto/fatura/NF mantêm dept + empresa', () => {
    const s = readFileSync(join(process.cwd(), 'src/app/components/ClientEmailComposerModal.tsx'), 'utf8');
    assert.match(s, /const greeting = buildClientEmailGreeting\(p\);/);
    assert.doesNotMatch(s, /Olá, \$\{contact\} \(\$\{comp\}\),/);
    assert.match(s, /Olá, \$\{contact\} — Departamento Financeiro \(\$\{comp\}\),/);
    assert.match(s, /Olá, \$\{contact\} — Fiscal & Financeiro \(\$\{comp\}\),/);
    assert.match(s, /Olá, \$\{contact\} — Departamento Fiscal \(\$\{comp\}\),/);
    assert.match(s, /• Empresa: \$\{comp\}/);
  });
});
