import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROPOSAL_SHIPPING_CARRIER_OPTIONS,
  displayShippingCarrier,
  shippingCarrierSelectValue,
} from '../src/app/lib/proposal-shipping-carrier';
import { toPublicProposalDto } from '../src/app/lib/proposal-public-dto';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Transportadora do orçamento: três opções e mapeamento só na exibição', () => {
  it('o select tem exatamente Frota Próprio, Correios e Transportadora', () => {
    assert.deepEqual(
      PROPOSAL_SHIPPING_CARRIER_OPTIONS.map((o) => o.label),
      ['Frota Próprio', 'Correios', 'Transportadora']
    );
    assert.equal(PROPOSAL_SHIPPING_CARRIER_OPTIONS.length, 3);
    const modal = src('src/app/components/ErpEditModals.tsx');
    assert.ok(modal.includes('PROPOSAL_SHIPPING_CARRIER_OPTIONS'));
    assert.equal(modal.includes('Frota Própria Seta Telecom (Técnico)'), false);
    assert.equal(modal.includes('Correios / SEDEX Empresarial'), false);
    assert.equal(modal.includes('Transportadora Braspress'), false);
    assert.equal(modal.includes('Sem Frete (Ativação Remota / Cloud)'), false);
    assert.equal(modal.includes("draft.shippingCarrier || 'Frota Própria Seta Telecom'"), false);
  });

  it('valores antigos viram o rótulo novo; Sem Frete aparece vazio; o canônico gravado não muda', () => {
    assert.equal(displayShippingCarrier('Frota Própria Seta Telecom'), 'Frota Próprio');
    assert.equal(displayShippingCarrier('Frota Própria Seta Telecom (Técnico)'), 'Frota Próprio');
    assert.equal(displayShippingCarrier('Correios / SEDEX'), 'Correios');
    assert.equal(displayShippingCarrier('Correios / SEDEX Empresarial'), 'Correios');
    assert.equal(displayShippingCarrier('Transportadora Braspress'), 'Transportadora');
    assert.equal(displayShippingCarrier('Sem Frete (Digital/Remoto)'), '');
    assert.equal(displayShippingCarrier('Sem Frete (Ativação Remota / Cloud)'), '');
    assert.equal(displayShippingCarrier(''), '');
    assert.equal(displayShippingCarrier('Frota Próprio'), 'Frota Próprio');
    assert.equal(displayShippingCarrier('Correios'), 'Correios');
    assert.equal(displayShippingCarrier('Transportadora'), 'Transportadora');

    assert.equal(shippingCarrierSelectValue('Frota Própria Seta Telecom'), 'Frota Própria Seta Telecom');
    assert.equal(shippingCarrierSelectValue('Frota Próprio'), 'Frota Própria Seta Telecom');
    assert.equal(shippingCarrierSelectValue('Correios / SEDEX Empresarial'), 'Correios / SEDEX');
    assert.equal(shippingCarrierSelectValue('Transportadora Braspress'), 'Transportadora Braspress');
    assert.equal(shippingCarrierSelectValue('Sem Frete (Digital/Remoto)'), '');
  });

  it('a folha/PDF e o DTO público usam o rótulo novo e omitem Sem Frete, sem gravar no banco', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const repo = src('src/db/repository.ts');
    assert.ok(page.includes('displayShippingCarrier'));
    assert.equal(page.includes("proposal.shippingCarrier || \"Frota Própria Seta Telecom\""), false);
    assert.ok(repo.includes("input.shippingCarrier || 'Frota Própria Seta Telecom'"));

    const base = {
      id: 'prop-tr',
      code: '4801',
      title: 'Proposta',
      companyId: null,
      companyName: 'Cliente',
      companyCnpj: '',
      contactId: null,
      contactName: '',
      dealId: null,
      sellerName: 'Vendedor',
      status: 'ENVIADA',
      contractMonths: 12,
      paymentCondition: '',
      validUntil: '2026-12-31',
      items: [],
      monthlyRecurringTotal: 0,
      oneTimeSetupTotal: 0,
      totalContractValue: 0,
      commercialNotes: '',
      technicalClauses: '',
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      version: 1,
    } as ErpCommercialProposal;

    assert.equal(toPublicProposalDto({ ...base, shippingCarrier: 'Transportadora Braspress' }).shippingCarrier, 'Transportadora');
    assert.equal(toPublicProposalDto({ ...base, shippingCarrier: 'Frota Própria Seta Telecom' }).shippingCarrier, 'Frota Próprio');
    assert.equal(toPublicProposalDto({ ...base, shippingCarrier: 'Correios / SEDEX' }).shippingCarrier, 'Correios');
    assert.equal(toPublicProposalDto({ ...base, shippingCarrier: 'Sem Frete (Digital/Remoto)' }).shippingCarrier, null);
  });
});
