// ============================================================================
// Clique na empresa a partir da lista de orçamentos
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LEAN_COMPANY_MARKER } from '../src/modules/bootstrap/lean-payload';
import {
  ERP_CUSTOMER_NOT_FOUND_TOAST,
  findCompanyInList,
  planOpenErpCustomer,
} from '../src/app/lib/open-erp-customer';

const COMPANIES = [
  { id: 'comp-1', name: 'EVAMIND INTELIGENCIA ARTIFICIAL LTDA', cnpj: '12.345.678/0001-90' },
  { id: 'comp-2', name: 'SETA TELECOM LTDA', cnpj: '00.000.000/0001-00' },
];

describe('planOpenErpCustomer', () => {
  it('abre o cadastro para edição na mesma página quando a empresa está na lista', () => {
    const plan = planOpenErpCustomer(COMPANIES, {
      companyId: 'comp-1',
      companyName: 'EVAMIND INTELIGENCIA ARTIFICIAL LTDA',
      companyCnpj: '12345678000190',
    });
    assert.equal(plan.action, 'open-edit');
    if (plan.action !== 'open-edit') return;
    assert.equal(plan.stayOnPage, true);
    assert.equal(plan.readOnly, false);
    assert.equal(plan.company.id, 'comp-1');
  });

  it('também casa por CNPJ ou nome quando o id não confere', () => {
    assert.equal(
      findCompanyInList(COMPANIES, { companyId: 'comp-gc-inexistente', companyCnpj: '12.345.678/0001-90' })?.id,
      'comp-1'
    );
    assert.equal(
      findCompanyInList(COMPANIES, { companyName: 'seta telecom ltda' })?.id,
      'comp-2'
    );
  });

  it('se a empresa não está na lista local mas tem id, hidrata o cadastro sem sair da página', () => {
    const plan = planOpenErpCustomer(COMPANIES, {
      companyId: 'comp-99',
      companyName: 'Cliente Novo',
      companyCnpj: '11.111.111/0001-11',
    });
    assert.equal(plan.action, 'hydrate-edit');
    if (plan.action !== 'hydrate-edit') return;
    assert.equal(plan.stayOnPage, true);
    assert.equal(plan.readOnly, false);
    assert.equal(plan.stub.id, 'comp-99');
    assert.equal(plan.stub.name, 'Cliente Novo');
    assert.equal(plan.stub[LEAN_COMPANY_MARKER], true);
  });

  it('sem id e sem correspondência, permanece na página e avisa; não navega para cadastros', () => {
    const plan = planOpenErpCustomer(COMPANIES, { companyName: 'Empresa Fantasma' });
    assert.deepEqual(plan, {
      action: 'not-found',
      stayOnPage: true,
      toast: ERP_CUSTOMER_NOT_FOUND_TOAST,
    });
  });
});
