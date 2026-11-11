// t137u/t142u/t143u/t146u: endereco da emitente no cabecalho dos documentos. Sem rede.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultIssuerAddressLine,
  formatIssuerAddress,
  SETA_ISSUER_ADDRESS_DEFAULT,
  SETA_PROPOSAL_HEADER_ADDRESS,
  stripTrailingCityFromNeighborhood,
} from '../src/app/lib/company-issuer-address';
import { DEFAULT_COMPANY_EMITTER_SETTINGS } from '../src/modules/erp/daily-sync-service';
import {
  COMPANY_EMITTER_KV_KEY,
  MemoryCompanyEmitterStore,
  mergeCompanyEmitter,
  loadCompanyEmitterSettings,
  parseCompanyEmitterPatch,
  saveCompanyEmitterSettings,
} from '../src/modules/erp/company-emitter-store';

const EXPECTED = 'Rua Guapuruvu, 242, Sala 31 - Loteamento Alphaville - Campinas/SP';

describe('Proposta e documentos - endereco da emitente', () => {
  it('cadastro padrao sem Campinas repetido no bairro', () => {
    assert.equal(formatIssuerAddress(SETA_ISSUER_ADDRESS_DEFAULT), EXPECTED);
    assert.equal(defaultIssuerAddressLine(), EXPECTED);
    assert.equal(formatIssuerAddress(DEFAULT_COMPANY_EMITTER_SETTINGS), EXPECTED);
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.neighborhood, 'Loteamento Alphaville');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.ibgeCode, '3509502');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.cep, '');
  });

  it('remove cidade repetida no final do bairro (valor antigo persistido)', () => {
    assert.equal(stripTrailingCityFromNeighborhood('Loteamento Alphaville Campinas', 'Campinas'), 'Loteamento Alphaville');
    assert.equal(
      formatIssuerAddress({
        ...SETA_ISSUER_ADDRESS_DEFAULT,
        neighborhood: 'Loteamento Alphaville Campinas',
      }),
      EXPECTED
    );
    assert.equal(stripTrailingCityFromNeighborhood('Centro', 'Campinas'), 'Centro');
  });

  it('omite campos vazios sem separadores soltos', () => {
    assert.equal(
      formatIssuerAddress({
        addressStreet: 'Rua A',
        addressNumber: '',
        addressComplement: ' ',
        neighborhood: '',
        city: 'Campinas / São Paulo',
        state: 'SP',
        cep: '',
      }),
      'Rua A - Campinas/SP'
    );
    assert.equal(formatIssuerAddress({}), '');
    assert.equal(formatIssuerAddress(null), '');
  });

  it('persiste Dados da Empresa no store (kv)', async () => {
    assert.equal(COMPANY_EMITTER_KV_KEY, 'erp_company_emitter_v1');
    const mem = new MemoryCompanyEmitterStore();
    await saveCompanyEmitterSettings(mergeCompanyEmitter(SETA_ISSUER_ADDRESS_DEFAULT as never), mem);
    const loaded = await loadCompanyEmitterSettings(mem);
    assert.equal(formatIssuerAddress(loaded), EXPECTED);
  });

  it('allowlist rejeita campos extras e valores invalidos', () => {
    // __proto__ may or may not appear in Object.keys depending on how object was created
    const withHack = parseCompanyEmitterPatch({ legalName: 'SETA', hackerField: 'nope' });
    assert.equal(withHack.ok, false);
    if (!withHack.ok) {
      assert.equal(withHack.code, 'COMPANY_EMITTER_UNKNOWN_FIELDS');
      assert.ok(withHack.fields.includes('hackerField'));
    }
    const tooLong = parseCompanyEmitterPatch({ legalName: 'x'.repeat(201) });
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.equal(tooLong.code, 'COMPANY_EMITTER_FIELD_INVALID');
    const badRegime = parseCompanyEmitterPatch({ taxRegime: 'MEI' });
    assert.equal(badRegime.ok, false);
    const ok = parseCompanyEmitterPatch({ neighborhood: 'Loteamento Alphaville', city: 'Campinas' });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.patch.neighborhood, 'Loteamento Alphaville');
      assert.equal(Object.keys(ok.patch).sort().join(','), 'city,neighborhood');
    }
  });

  it('rotas e CSS de contraste usam allowlist e accent escuro', () => {
    const root = process.cwd();
    const r = readFileSync(join(root, 'src/api/router.ts'), 'utf8');
    assert.equal((r.match(/issuerAddress: formatIssuerAddress\(this\.companyEmitter\)/g) || []).length, 4);
    assert.match(r, /saveCompanyEmitterSettings\(this\.companyEmitter\)/);
    assert.match(r, /ensureCompanyEmitterHydrated/);
    assert.match(r, /parseCompanyEmitterPatch\(body\.companyEmitter\)/);

    const p = readFileSync(join(root, 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.match(p, /SETA_PROPOSAL_HEADER_ADDRESS/);
    assert.doesNotMatch(p, /\{issuerAddress \|\| defaultIssuerAddressLine\(\)\}/);
    assert.equal(SETA_PROPOSAL_HEADER_ADDRESS, 'Rua Guapuruvu, 242 — 3º andar, Alphaville, Campinas/SP — CEP 13098-323');
    const issuerLib = readFileSync(join(root, 'src/app/lib/company-issuer-address.ts'), 'utf8');
    assert.match(issuerLib, /Rua Guapuruvu, 242 — 3º andar, Alphaville, Campinas\/SP — CEP 13098-323/);

    const receipt = readFileSync(join(root, 'src/app/lib/contract-billing-utils.ts'), 'utf8');
    assert.match(receipt, /companyAddress: htmlOptions\?\.issuerAddress \|\| defaultIssuerAddressLine\(\)/);
    assert.match(receipt, /data-testid="doc-issuer-address"/);

    const theme = readFileSync(join(root, 'src/app/lib/proposal-sheet-theme.ts'), 'utf8');
    assert.match(theme, /companyAddress\?: string/);

    const pdv = readFileSync(join(root, 'src/app/components/SetaErpTenPillarsAndPdv.tsx'), 'utf8');
    assert.match(pdv, /defaultIssuerAddressLine\(\)/);

    const sync = readFileSync(join(root, 'src/modules/erp/daily-sync-service.ts'), 'utf8');
    assert.doesNotMatch(sync, /José Bonifácio|Flamboyant|13091-140/);

    const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
    assert.match(css, /\[data-system="crm"\][\s\S]*?--sti-accent:\s*#D9541E/i);
    assert.match(css, /\[data-system="service"\][\s\S]*?--sti-accent:\s*#047857/);
    assert.doesNotMatch(css, /\[data-system="crm"\]\s*\{\s*--sti-accent:\s*#ea580c/);
  });
});
