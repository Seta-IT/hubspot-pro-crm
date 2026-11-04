// t137u: endereco da emitente no cabecalho da Proposta Comercial. Sem rede.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatIssuerAddress } from '../src/app/lib/company-issuer-address';
import { DEFAULT_COMPANY_EMITTER_SETTINGS } from '../src/modules/erp/daily-sync-service';

describe('Proposta - endereco da emitente', () => {
  it('monta a linha completa', () => {
    assert.equal(
      formatIssuerAddress({ addressStreet: 'Rua Guapuruvu', addressNumber: '377', addressComplement: 'Sala 31', neighborhood: 'Loteamento Alphaville Campinas', city: 'Campinas', state: 'sp', cep: '13098322' }),
      'Rua Guapuruvu, 377, Sala 31 - Loteamento Alphaville Campinas - Campinas/SP - CEP 13098-322'
    );
  });
  it('omite campos vazios sem separadores soltos', () => {
    assert.equal(formatIssuerAddress({ addressStreet: 'Rua A', addressNumber: '', addressComplement: ' ', neighborhood: '', city: 'Campinas / São Paulo', state: 'SP', cep: '' }), 'Rua A - Campinas/SP');
    assert.equal(formatIssuerAddress({}), '');
    assert.equal(formatIssuerAddress(null), '');
  });
  it('so devolve endereco (nada de CNPJ, contas ou e-mail)', () => {
    const line = formatIssuerAddress(DEFAULT_COMPANY_EMITTER_SETTINGS);
    assert.ok(!/CNPJ|Banco|@|IE|149\.882/i.test(line.replace(/^.*CEP/, '')));
    assert.ok(!line.includes(DEFAULT_COMPANY_EMITTER_SETTINGS.cnpj));
  });
  it('rotas e cabecalho usam o cadastro', () => {
    const r = readFileSync(join(process.cwd(), 'src/api/router.ts'), 'utf8');
    assert.equal((r.match(/issuerAddress: formatIssuerAddress\(this\.companyEmitter\)/g) || []).length, 3);
    const p = readFileSync(join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.match(p, /data-testid="proposal-issuer-address"[\s\S]{0,120}\{issuerAddress \|\|/);
  });
});
