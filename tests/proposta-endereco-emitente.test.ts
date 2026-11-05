// t137u/t142u/t143u: endereco da emitente no cabecalho dos documentos. Sem rede.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultIssuerAddressLine,
  formatIssuerAddress,
  SETA_ISSUER_ADDRESS_DEFAULT,
} from '../src/app/lib/company-issuer-address';
import { DEFAULT_COMPANY_EMITTER_SETTINGS } from '../src/modules/erp/daily-sync-service';
import {
  COMPANY_EMITTER_KV_KEY,
  MemoryCompanyEmitterStore,
  mergeCompanyEmitter,
  loadCompanyEmitterSettings,
  saveCompanyEmitterSettings,
} from '../src/modules/erp/company-emitter-store';

const EXPECTED =
  'Rua Guapuruvu, 242, Sala 31 - Loteamento Alphaville Campinas - Campinas/SP';

describe('Proposta e documentos - endereco da emitente', () => {
  it('cadastro padrao e helper batem com o endereco confirmado (sem CEP)', () => {
    assert.equal(formatIssuerAddress(SETA_ISSUER_ADDRESS_DEFAULT), EXPECTED);
    assert.equal(defaultIssuerAddressLine(), EXPECTED);
    assert.equal(formatIssuerAddress(DEFAULT_COMPANY_EMITTER_SETTINGS), EXPECTED);
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.addressStreet, 'Rua Guapuruvu');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.addressNumber, '242');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.addressComplement, 'Sala 31');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.neighborhood, 'Loteamento Alphaville Campinas');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.city, 'Campinas');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.state, 'SP');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.ibgeCode, '3509502');
    assert.equal(DEFAULT_COMPANY_EMITTER_SETTINGS.cep, '');
    assert.ok(!/José Bonifácio|Flamboyant|13091-140|3550308|Sede Administrativa/i.test(JSON.stringify(DEFAULT_COMPANY_EMITTER_SETTINGS)));
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
    const edited = mergeCompanyEmitter({
      addressStreet: 'Rua Guapuruvu',
      addressNumber: '242',
      addressComplement: 'Sala 31',
      neighborhood: 'Loteamento Alphaville Campinas',
      city: 'Campinas',
      state: 'SP',
      ibgeCode: '3509502',
      cep: '',
    });
    await saveCompanyEmitterSettings(edited, mem);
    const loaded = await loadCompanyEmitterSettings(mem);
    assert.equal(formatIssuerAddress(loaded), EXPECTED);
    assert.equal(loaded.legalName, 'SETA TELECOM LTDA');
  });

  it('rotas, cabecalhos e documentos usam o endereco', () => {
    const root = process.cwd();
    const r = readFileSync(join(root, 'src/api/router.ts'), 'utf8');
    assert.equal((r.match(/issuerAddress: formatIssuerAddress\(this\.companyEmitter\)/g) || []).length, 4);
    assert.match(r, /saveCompanyEmitterSettings\(this\.companyEmitter\)/);
    assert.match(r, /ensureCompanyEmitterHydrated/);

    const p = readFileSync(join(root, 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.match(p, /defaultIssuerAddressLine\(\)/);
    assert.doesNotMatch(p, /Alphaville, Campinas\/SP/);

    const receipt = readFileSync(join(root, 'src/app/lib/contract-billing-utils.ts'), 'utf8');
    assert.match(receipt, /companyAddress: htmlOptions\?\.issuerAddress \|\| defaultIssuerAddressLine\(\)/);
    assert.match(receipt, /data-testid="doc-issuer-address"/);

    const theme = readFileSync(join(root, 'src/app/lib/proposal-sheet-theme.ts'), 'utf8');
    assert.match(theme, /companyAddress\?: string/);

    const pdv = readFileSync(join(root, 'src/app/components/SetaErpTenPillarsAndPdv.tsx'), 'utf8');
    assert.match(pdv, /defaultIssuerAddressLine\(\)/);

    const sync = readFileSync(join(root, 'src/modules/erp/daily-sync-service.ts'), 'utf8');
    assert.doesNotMatch(sync, /José Bonifácio|Flamboyant|13091-140/);
  });
});
