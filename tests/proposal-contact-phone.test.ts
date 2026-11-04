// Telefone/WhatsApp oficial da Seta Telecom na folha da proposta (04/11/2026): (11) 3958-4929,
// link wa.me/551139584929 e tel:+551139584929 clicaveis (o Chrome mantem <a href> no PDF).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETA_TELECOM_PHONE,
  proposalTelUrl,
  proposalWhatsAppUrl,
  resolveProposalSellerContact,
} from '../src/app/lib/proposal-share';

describe('proposta: telefone e WhatsApp da Seta Telecom', () => {
  it('numero oficial e links', () => {
    assert.equal(SETA_TELECOM_PHONE, '(11) 3958-4929');
    assert.equal(proposalWhatsAppUrl(SETA_TELECOM_PHONE), 'https://wa.me/551139584929');
    assert.equal(proposalTelUrl(SETA_TELECOM_PHONE), 'tel:+551139584929');
    assert.equal(proposalWhatsAppUrl(''), '');
  });
  it('Marcelo e o numero ficticio antigo exibem o oficial', () => {
    assert.equal(resolveProposalSellerContact({ sellerName: 'Marcelo Lopes Mira' }).phone, '(11) 3958-4929');
    assert.equal(resolveProposalSellerContact({ sellerName: 'Marcelo Lopes Mira', sellerPhone: '(11) 99999-4929' }).phone, '(11) 3958-4929');
  });
  it('a folha usa <a href> de wa.me e tel:', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.ok(src.includes('href={proposalWhatsAppUrl(sellerContact.phone)}'));
    assert.ok(src.includes('href={proposalTelUrl(sellerContact.phone)}'));
  });
});

describe('proposta de PRODUTOS: sem Setup, total sem dobrar e com centavos', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
  it('setup so fora de PRODUTOS', () => {
    assert.ok(src.includes('const hasSetupSelected = !isProductsOnly && isolatedSetupTotal > 0;'));
  });
  it('total de venda = itens - desconto global + frete (sem oneTimeSetupTotal)', () => {
    assert.ok(src.includes('Math.round((productsSubtotal + servicesSubtotal - globalDiscountVal + shippingCost) * 100) / 100'));
    assert.equal(src.includes('shippingCost + isolatedSetupTotal'), false);
  });
  it('moeda com centavos em PRODUTOS', () => {
    const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.equal(fmt.format(103454.75).replace(/\s/g, ' '), 'R$ 103.454,75');
    assert.ok(src.includes('minimumFractionDigits: 2, maximumFractionDigits: 2'));
  });
});
