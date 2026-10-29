// ============================================================================
// STI-hub — Seguranca das rotas de Proposta, Empresas e Financeiro ERP
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStiHubRouteProtection,
  isAlwaysProtectedApiPath,
  isProposalMutationPath,
  isPublicStiHubPath,
  resolveErpAccountRoleFromClaims,
} from '../src/middleware';
import {
  signStiHubSessionToken,
  verifyStiHubSessionToken,
  StiHubSignedSessionClaims,
} from '../src/app/lib/auth';
import { isValidCpf, validateProposalApprovalInput } from '../src/modules/erp/proposal-approval';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';

function token(overrides: Partial<StiHubSignedSessionClaims> = {}): string {
  return signStiHubSessionToken({
    uid: 'usr-test-01',
    email: 'teste@setatelecom.com.br',
    name: 'Usuario Teste',
    roleId: 'SUPER_ADMIN',
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now(),
    exp: Date.now() + 60_000,
    ...overrides,
  });
}

const VALID_CPF = '529.982.247-25';

function guard(pathname: string, method: string, sessionToken: string | null, enforceStrictLock = false) {
  // enforceStrictLock=false simula o antigo fallback (referer de mesma origem / STI_HUB_STRICT_AUTH=false):
  // as rotas sempre protegidas devem continuar exigindo sessao mesmo assim.
  return evaluateStiHubRouteProtection({ pathname, method, sessionToken, enforceStrictLock });
}

describe('Seguranca: rotas publicas da proposta (cliente sem login)', () => {
  it('somente GET :id e POST :id/approve sao publicos; PATCH e restore-version nao', () => {
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-1', 'GET'), true);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-1/approve', 'POST'), true);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-1', 'PATCH'), false);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-1/restore-version', 'POST'), false);
    assert.equal(isProposalMutationPath('/api/erp/proposals/prop-1', 'PATCH'), true);
    assert.equal(isProposalMutationPath('/api/erp/proposals/prop-1/restore-version', 'POST'), true);
    assert.equal(isProposalMutationPath('/api/erp/proposals/prop-1', 'GET'), false);
  });

  it('PATCH e restore-version sem sessao => 401, mesmo com fallback relaxado', () => {
    for (const [p, m] of [
      ['/api/erp/proposals/prop-1', 'PATCH'],
      ['/api/erp/proposals/prop-1/restore-version', 'POST'],
    ]) {
      const relaxed = guard(p, m, null, false);
      assert.equal(relaxed.allowed, false, `${m} ${p} deve ser bloqueado`);
      assert.equal(relaxed.statusCode, 401);
      const strict = guard(p, m, null, true);
      assert.equal(strict.statusCode, 401);
    }
  });

  it('PATCH e restore-version com sessao sem perfil ERP_ADMIN/ERP_COMMERCIAL => 403', () => {
    const financeToken = token({ roleId: 'FINANCEIRO_FATURAMENTO', erpRole: 'ERP_FINANCE' });
    const stockToken = token({ roleId: 'GERENCIA_ESTOQUE' });
    const unknownRoleToken = token({ roleId: 'PERFIL_DESCONHECIDO' });
    for (const t of [financeToken, stockToken, unknownRoleToken]) {
      const patch = guard('/api/erp/proposals/prop-1', 'PATCH', t, true);
      assert.equal(patch.allowed, false);
      assert.equal(patch.statusCode, 403);
      assert.equal(patch.reason, 'ERP_PROPOSAL_ROLE_FORBIDDEN');
      const restore = guard('/api/erp/proposals/prop-1/restore-version', 'POST', t, true);
      assert.equal(restore.statusCode, 403);
    }
  });

  it('PATCH e restore-version com sessao sem modulo ERP => 403', () => {
    const noErp = token({ enabledModules: ['CRM'], moduleAccess: { crm: true, erp: false, chamados: false } });
    const patch = guard('/api/erp/proposals/prop-1', 'PATCH', noErp, true);
    assert.equal(patch.statusCode, 403);
  });

  it('PATCH e restore-version com perfil ERP_ADMIN ou ERP_COMMERCIAL => permitido', () => {
    const admin = token({ roleId: 'SUPER_ADMIN' });
    const commercialExplicit = token({ roleId: 'PERFIL_CUSTOM', erpRole: 'ERP_COMMERCIAL' });
    const salesRep = token({ roleId: 'VENDEDOR_SALES' });
    for (const t of [admin, commercialExplicit, salesRep]) {
      assert.equal(guard('/api/erp/proposals/prop-1', 'PATCH', t, true).allowed, true);
      assert.equal(guard('/api/erp/proposals/prop-1/restore-version', 'POST', t, true).allowed, true);
    }
    assert.equal(resolveErpAccountRoleFromClaims({ roleId: 'DIRETORIA' }), 'ERP_ADMIN');
    assert.equal(resolveErpAccountRoleFromClaims({ roleId: 'X', erpRole: 'ERP_COMMERCIAL' }), 'ERP_COMMERCIAL');
    assert.equal(resolveErpAccountRoleFromClaims({ roleId: 'X' }), 'ERP_NONE');
  });

  it('GET :id e POST approve sem sessao => permitidos (rota publica)', () => {
    const get = guard('/api/erp/proposals/prop-1', 'GET', null, true);
    assert.equal(get.allowed, true);
    assert.equal(get.isPublicRoute, true);
    const approve = guard('/api/erp/proposals/prop-1/approve', 'POST', null, true);
    assert.equal(approve.allowed, true);
    assert.equal(approve.isPublicRoute, true);
  });
});

describe('Seguranca: /api/companies e /api/erp/financial sempre exigem sessao', () => {
  it('sem token => 401 mesmo com fallback relaxado; com token valido => permitido', () => {
    for (const p of ['/api/companies', '/api/companies/comp-1', '/api/erp/financial', '/api/erp/financial/dre']) {
      assert.equal(isAlwaysProtectedApiPath(p, 'GET'), true);
      const blocked = guard(p, 'GET', null, false);
      assert.equal(blocked.allowed, false, `${p} deve exigir sessao`);
      assert.equal(blocked.statusCode, 401);
      const ok = guard(p, 'GET', token(), true);
      assert.equal(ok.allowed, true, `${p} deve ser permitido com sessao valida`);
    }
  });

  it('token sem assinatura HMAC (base64 JSON forjado) e rejeitado', () => {
    const forged = Buffer.from(
      JSON.stringify({ email: 'atacante@example.com', mfaVerified: true, roleId: 'SUPER_ADMIN' })
    ).toString('base64url');
    const v = verifyStiHubSessionToken(forged);
    assert.equal(v.valid, false);
    const decision = guard('/api/companies', 'GET', forged, true);
    assert.equal(decision.allowed, false);
    assert.equal(decision.statusCode, 401);
  });
});

describe('Seguranca: listagem de propostas e daily-sync exigem MFA + modulo ERP', () => {
  it('sem sessao => 401; sessao sem modulo ERP => 403; sessao com ERP => permitido', () => {
    const noErp = token({ enabledModules: ['CRM'], moduleAccess: { crm: true, erp: false, chamados: false } });
    for (const [p, m] of [
      ['/api/erp/proposals', 'GET'],
      ['/api/erp/daily-sync', 'GET'],
      ['/api/erp/daily-sync', 'POST'],
    ]) {
      assert.equal(guard(p, m, null, true).statusCode, 401);
      const forbidden = guard(p, m, noErp, true);
      assert.equal(forbidden.allowed, false);
      assert.equal(forbidden.statusCode, 403);
      assert.equal(forbidden.reason, 'MODULE_ERP_FORBIDDEN');
      assert.equal(guard(p, m, token(), true).allowed, true);
    }
  });
});

describe('Aceite publico da proposta (POST /approve)', () => {
  it('valida CPF', () => {
    assert.equal(isValidCpf(VALID_CPF), true);
    assert.equal(isValidCpf('111.111.111-11'), false);
    assert.equal(isValidCpf('123.456.789-00'), false);
  });

  it('corpo invalido => 400; status nao permitido => 409', () => {
    const empty = validateProposalApprovalInput({}, 'ENVIADA');
    assert.equal(empty.ok, false);
    assert.equal(empty.status, 400);
    const noTerms = validateProposalApprovalInput(
      { signerName: 'Carlos Almeida', signerCpf: VALID_CPF, signerRole: 'Diretor', modality: 'ICP_BRASIL_A1' },
      'ENVIADA'
    );
    assert.equal(noTerms.ok, false);
    if (!noTerms.ok) assert.deepEqual(noTerms.fields, ['acceptedTerms']);
    const valid = {
      signerName: 'Carlos Almeida',
      signerCpf: VALID_CPF,
      signerRole: 'Diretor',
      modality: 'GOV_BR_OURO',
      acceptedTerms: true,
    };
    assert.equal(validateProposalApprovalInput(valid, 'ENVIADA').ok, true);
    assert.equal(validateProposalApprovalInput(valid, 'RECUSADA').status, 409);
    assert.equal(validateProposalApprovalInput(valid, 'CONVERTIDA_CONTRATO').status, 409);
    assert.equal(validateProposalApprovalInput(valid, 'ENVIADA', 'ctr-1').status, 409);
  });

  it('roteador: approve com corpo invalido => 400 sem alterar a proposta; aceite valido persiste assinatura; segundo aceite => 409', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const created = repo.createProposal({
      title: 'Proposta Teste Aceite Publico',
      companyName: 'Cliente Teste Aceite',
      contractMonths: 12,
      items: [
        {
          id: 'it-1',
          sku: 'GC-EQ-001',
          description: 'Central PABX IP',
          fiscalNature: 'LOCACAO_BENS_MOVEIS',
          ncmOrServiceCode: 'NCM 8517.62.14',
          quantity: 1,
          unitPrice: 500,
          discountPercent: 0,
          isRecurring: true,
          totalMonthly: 500,
        },
      ],
    } as unknown as { title: string });
    const statusBefore = created.status;

    const bad = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${created.id}/approve`,
      body: { signerName: 'X', signerCpf: '000', modality: 'INVALIDA' },
    });
    assert.equal(bad.status, 400);
    const after = repo.listProposals().find((p) => p.id === created.id)!;
    assert.equal(after.status, statusBefore);
    assert.equal(after.digitalSignature ?? null, null);

    const ok = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${created.id}/approve`,
      body: {
        signerName: 'Carlos Almeida',
        signerCpf: VALID_CPF,
        signerRole: 'Diretor',
        modality: 'ICP_BRASIL_A3',
        acceptedTerms: true,
        // payload de proposta enviado pelo cliente NAO pode sobrescrever a proposta existente
        proposal: { ...created, monthlyRecurringTotal: 1 },
      },
    });
    assert.equal(ok.status, 200);
    const persisted = repo.listProposals().find((p) => p.id === created.id)!;
    assert.equal(persisted.status, 'CONVERTIDA_CONTRATO');
    assert.equal(persisted.digitalSignature?.signerCpf, VALID_CPF);
    assert.equal(persisted.digitalSignature?.modality, 'ICP_BRASIL_A3');
    assert.equal(persisted.monthlyRecurringTotal, created.monthlyRecurringTotal);

    const again = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${created.id}/approve`,
      body: {
        signerName: 'Carlos Almeida',
        signerCpf: VALID_CPF,
        signerRole: 'Diretor',
        modality: 'ICP_BRASIL_A3',
        acceptedTerms: true,
      },
    });
    assert.equal(again.status, 409);
  });
});
