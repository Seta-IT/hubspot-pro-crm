import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPublicProposalDto } from '../src/app/lib/proposal-public-dto';
import { isPublicStiHubPath } from '../src/middleware';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Sem opção Gov.br', () => {
  it('textos de cliente e PDF não prometem Gov.br, e o histórico GOV_BR_OURO abre como aceite eletrônico', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const contract = src('src/app/lib/contract-billing-utils.ts');
    const erp = src('src/app/components/ErpGestaoClickTab.tsx');
    const catalog = src('src/modules/erp/gestaoclick-schema-catalog.ts');
    for (const text of [page, contract, erp, catalog]) {
      assert.doesNotMatch(text, /Gov\.br/);
    }
    assert.doesNotMatch(page, /value="GOV_BR_OURO"/);
    assert.match(page, /modality === 'GOV_BR_OURO' \? 'Aceite eletrônico'/);
    assert.match(page, /Assinar ICP-Brasil & Aprovar/);
    assert.equal(isPublicStiHubPath('/api/govbr/sign/callback', 'GET'), false);
    assert.equal(isPublicStiHubPath('/api/govbr/sign/start', 'POST'), false);

    const proposal = {
      id: 'prop-antiga',
      code: '4700',
      title: 'Locação antiga',
      companyId: null,
      companyName: 'Via Itália',
      companyCnpj: '07.638.845/0001-56',
      contactId: null,
      contactName: '',
      dealId: null,
      sellerName: 'Marcelo Lopes Mira',
      status: 'CONVERTIDA_CONTRATO',
      contractMonths: 36,
      paymentCondition: '',
      validUntil: '2026-12-01',
      items: [],
      monthlyRecurringTotal: 1000,
      oneTimeSetupTotal: 0,
      totalContractValue: 36000,
      commercialNotes: '',
      technicalClauses: '',
      internalNotes: 'NOTA_INTERNA_ANTIGA',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      version: 1,
      digitalSignature: {
        signerName: 'Maria Silva',
        signerCpf: '529.982.247-25',
        signerRole: 'Diretora',
        modality: 'GOV_BR_OURO',
        certificateIssuer: 'Aceite eletrônico',
        certificateSerial: 'ICP-BR-ABC',
        signatureHashSha256: 'abc',
        timestampToken: 'ACT-ITI-2026-ABC',
        signedAt: '2026-01-02T00:00:00.000Z',
      },
    } as ErpCommercialProposal;
    const dto = toPublicProposalDto(proposal);
    assert.equal(dto.acceptance?.modality, 'GOV_BR_OURO');
    assert.equal(dto.acceptance?.signerName, 'Maria Silva');
    assert.doesNotMatch(JSON.stringify(dto), /NOTA_INTERNA_ANTIGA|internalNotes/);
  });
});
