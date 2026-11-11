// ============================================================================
// STI-hub — validade vencida no "Enviar por e-mail":
//  - o botão "Atualizar validade" só aparece com code PROPOSAL_EXPIRED (não pelo texto);
//  - o clique leva à edição com foco no campo Validade e um retorno na URL;
//  - salvar essa proposta volta ao modal de envio do mesmo contrato/proposta;
//  - outros erros continuam em "Tentar de novo";
//  - a emissão do link não muda (MFA, 409 sem URL, RASCUNHO só vira ENVIADA se válida).
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import {
  assignInternalFlowHref,
  buildReturnToSendHref,
  buildUpdateValidityHref,
  focusProposalValidityField,
  hrefAfterProposalSave,
  isInternalFlowHref,
  parseProposalFlowIntent,
  proposalFlowNavigation,
  PROPOSAL_VALIDITY_EXPIRED_CODE,
  readProposalLinkErrorCode,
  signedLinkRecovery,
  stripConsumedSendParams,
} from '../src/app/lib/proposal-validity-return';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const savedSecret = process.env.STI_HUB_PROPOSAL_LINK_SECRET;

afterEach(() => {
  if (savedSecret === undefined) delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
  else process.env.STI_HUB_PROPOSAL_LINK_SECRET = savedSecret;
});

const searchOf = (href: string) => (href.startsWith('/?') ? href.slice(1) : href);

describe('Atualizar validade: código estruturado, não o texto', () => {
  it('PROPOSAL_EXPIRED com proposta e contrato abre a edição com foco e retorno', () => {
    const recovery = signedLinkRecovery({
      code: PROPOSAL_VALIDITY_EXPIRED_CODE,
      proposalId: 'prop-gc-4695',
      contractId: 'ctr-loc-124',
    });
    assert.equal(recovery.kind, 'update-validity');
    if (recovery.kind !== 'update-validity') return;
    assert.equal(recovery.href.includes('#t='), false);
    assert.equal(recovery.href.includes('token'), false);
    assert.match(recovery.href, /acao=atualizar-validade/);
    assert.match(recovery.href, /foco=validade/);
    assert.match(recovery.href, /proposta=prop-gc-4695/);
    assert.match(recovery.href, /voltar=contrato%3Actr-loc-124|voltar=contrato:ctr-loc-124/);
    assert.equal(isInternalFlowHref(recovery.href), true);

    const intent = parseProposalFlowIntent(searchOf(recovery.href));
    assert.deepEqual(intent, {
      kind: 'edit-validity',
      proposalId: 'prop-gc-4695',
      returnTo: { kind: 'contrato', id: 'ctr-loc-124' },
    });
    const nav = proposalFlowNavigation(searchOf(recovery.href));
    assert.deepEqual(nav, {
      section: 'ORCAMENTOS',
      target: { type: 'PROPOSAL', id: 'prop-gc-4695', query: 'validade' },
    });
  });

  it('outros erros, texto parecido e id inseguro não mostram o botão', () => {
    const expiredText = 'A validade desta proposta já venceu. Atualize a data de validade antes de gerar o link para o cliente.';
    assert.equal(readProposalLinkErrorCode({ error: expiredText }), undefined);
    assert.equal(readProposalLinkErrorCode({ code: 'PROPOSAL_EXPIRED', error: expiredText }), 'PROPOSAL_EXPIRED');
    assert.equal(readProposalLinkErrorCode({ code: 'proposal_expired' }), undefined);
    assert.equal(readProposalLinkErrorCode({ code: 'javascript:alert(1)' }), undefined);
    assert.equal(readProposalLinkErrorCode(null), undefined);

    const cases = [
      { code: 'PROPOSAL_LINK_FORBIDDEN', proposalId: 'prop-gc-4695', contractId: 'ctr-loc-124' },
      { code: 'PROPOSAL_LINK_SECRET_MISSING', proposalId: 'prop-gc-4695', contractId: 'ctr-loc-124' },
      { code: 'MFA_AUTH_REQUIRED', proposalId: 'prop-gc-4695', contractId: 'ctr-loc-124' },
      { code: undefined, proposalId: 'prop-gc-4695', contractId: 'ctr-loc-124' },
      { code: expiredText, proposalId: 'prop-gc-4695', contractId: 'ctr-loc-124' },
      { code: 'PROPOSAL_EXPIRED', proposalId: '', contractId: 'ctr-loc-124' },
      { code: 'PROPOSAL_EXPIRED', proposalId: 'eyJhbGciOi.sig', contractId: 'nao-e-id-seguro/../x' },
    ];
    for (const input of cases) {
      assert.equal(signedLinkRecovery(input).kind, 'retry', JSON.stringify({ code: input.code, proposalId: input.proposalId }));
    }
    const ignoredBadContract = signedLinkRecovery({
      code: 'PROPOSAL_EXPIRED',
      proposalId: 'prop-gc-4695',
      contractId: 'https://evil.example',
    });
    assert.equal(ignoredBadContract.kind, 'update-validity');
    if (ignoredBadContract.kind === 'update-validity') {
      const intent = parseProposalFlowIntent(searchOf(ignoredBadContract.href));
      assert.equal(intent?.kind, 'edit-validity');
      if (intent?.kind === 'edit-validity') {
        assert.deepEqual(intent.returnTo, { kind: 'proposta', id: 'prop-gc-4695' });
      }
    }
  });

  it('sem contrato, o retorno é a própria proposta', () => {
    const recovery = signedLinkRecovery({ code: 'PROPOSAL_EXPIRED', proposalId: 'prop-gc-4695' });
    assert.equal(recovery.kind, 'update-validity');
    if (recovery.kind !== 'update-validity') return;
    const intent = parseProposalFlowIntent(searchOf(recovery.href));
    assert.equal(intent?.kind, 'edit-validity');
    if (intent?.kind !== 'edit-validity') return;
    assert.deepEqual(intent.returnTo, { kind: 'proposta', id: 'prop-gc-4695' });
  });
});

describe('Atualizar validade: salvar volta ao envio', () => {
  it('salvar a mesma proposta do contrato reabre o e-mail desse contrato', () => {
    const edit = buildUpdateValidityHref('prop-gc-4695', { kind: 'contrato', id: 'ctr-loc-124' });
    assert.ok(edit);
    const back = hrefAfterProposalSave(searchOf(edit!), 'prop-gc-4695');
    assert.equal(back, buildReturnToSendHref({ kind: 'contrato', id: 'ctr-loc-124' }));
    assert.match(back || '', /tela=ERP_CONTRACTS/);
    assert.match(back || '', /acao=enviar-email/);
    assert.match(back || '', /origem=contrato/);
    assert.match(back || '', /id=ctr-loc-124/);
    assert.equal(isInternalFlowHref(back || ''), true);
    assert.equal(back!.includes('#t='), false);

    const intent = parseProposalFlowIntent(searchOf(back!));
    assert.deepEqual(intent, { kind: 'send-email', origin: { kind: 'contrato', id: 'ctr-loc-124' } });
    assert.deepEqual(proposalFlowNavigation(searchOf(back!)), {
      section: 'CONTRATOS',
      target: { type: 'CONTRACT_EMAIL', id: 'ctr-loc-124' },
    });
    assert.equal(stripConsumedSendParams(`https://sti-hub.local${back}`), '/?tela=ERP_CONTRACTS');
  });

  it('salvar outra proposta, sem retorno, ou com voltar forjado não redireciona', () => {
    const edit = buildUpdateValidityHref('prop-gc-4695', { kind: 'proposta', id: 'prop-gc-4695' })!;
    assert.equal(hrefAfterProposalSave(searchOf(edit), 'prop-outra'), null);
    assert.equal(hrefAfterProposalSave(searchOf(buildUpdateValidityHref('prop-gc-4695', null)!), 'prop-gc-4695'), null);
    assert.equal(hrefAfterProposalSave('', 'prop-gc-4695'), null);

    const forged = [
      '?acao=atualizar-validade&proposta=prop-gc-4695&foco=validade&voltar=https://evil.example',
      '?acao=atualizar-validade&proposta=prop-gc-4695&foco=validade&voltar=javascript:alert(1)',
      '?acao=atualizar-validade&proposta=prop-gc-4695&foco=validade&voltar=//evil.example',
      '?acao=atualizar-validade&proposta=prop-gc-4695&foco=validade&voltar=contrato:javascript:alert',
      '?acao=enviar-email&origem=contrato&id=https://evil.example',
      'https://evil.example/?acao=enviar-email',
      '/?acao=atualizar-validade&proposta=prop-gc-4695&foco=validade&next=https://evil.example',
    ];
    for (const raw of forged) {
      const intent = parseProposalFlowIntent(raw.startsWith('/?') ? raw.slice(1) : raw);
      if (intent?.kind === 'edit-validity') assert.equal(intent.returnTo, null, raw);
      if (intent?.kind === 'send-email') assert.fail(raw);
      assert.equal(hrefAfterProposalSave(raw, 'prop-gc-4695'), null, raw);
      assert.equal(isInternalFlowHref(raw), false, raw);
    }
    assert.equal(buildUpdateValidityHref('prop-gc-4695', { kind: 'contrato', id: 'https://evil.example' }), null);
    assert.equal(buildReturnToSendHref({ kind: 'contrato', id: '../admin' }), null);
    assert.equal(stripConsumedSendParams(edit), edit);
  });

  it('foco no campo Validade rola e foca; sem elemento não faz nada', () => {
    const calls: string[] = [];
    const el = {
      scrollIntoView(arg?: ScrollIntoViewOptions | boolean) {
        calls.push(`scroll:${JSON.stringify(arg)}`);
      },
      focus(opts?: { preventScroll?: boolean }) {
        calls.push(`focus:${JSON.stringify(opts || {})}`);
      },
    };
    assert.equal(focusProposalValidityField(el), true);
    assert.deepEqual(calls, [
      'scroll:{"block":"center","inline":"nearest"}',
      'focus:{"preventScroll":false}',
    ]);
    assert.equal(focusProposalValidityField(null), false);
    assert.equal(assignInternalFlowHref('https://evil.example'), false);
  });
});

describe('Atualizar validade: a tela liga o botão, o foco e o retorno', () => {
  it('o modal mostra Atualizar validade só nesse caso e mantém Tentar de novo nos demais', () => {
    const modal = src('src/app/components/ClientEmailComposerModal.tsx');
    assert.match(modal, /signedLinkRecovery\(/);
    assert.match(modal, /data-testid="update-proposal-validity"/);
    assert.match(modal, /Atualizar validade/);
    assert.match(modal, /assignInternalFlowHref\(linkRecovery\.href\)/);
    assert.match(modal, /linkRecovery\.kind === 'update-validity'/);
    assert.match(modal, /linkRecovery\.kind === 'retry'/);
    assert.match(modal, /data-testid="retry-signed-proposal-link"/);
    assert.match(modal, /Tentar de novo/);
    assert.match(modal, /setSignedLink\(\{ status: 'error', error: r\.error, code: r\.code \}\)/);
    assert.doesNotMatch(modal, /validade desta proposta já venceu/);
    assert.match(modal, /bg-\[#1e3a6e\]/);
  });

  it('a edição foca o campo Validade e, ao salvar, usa o retorno da URL', () => {
    const editor = src('src/app/components/ErpEditModals.tsx');
    assert.match(editor, /data-testid="proposal-valid-until"/);
    assert.match(editor, /focusProposalValidityField\(validityInputRef\.current\)/);
    assert.match(editor, /focusField !== 'validUntil'/);
    assert.match(editor, /ring-\[#1e3a6e\]/);
    const erp = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(erp, /query === 'validade'/);
    assert.match(erp, /focusField=\{proposalEditorFocus\}/);
    assert.match(erp, /hrefAfterProposalSave\(window\.location\.search/);
    assert.match(erp, /assignInternalFlowHref\(backHref\)/);
    assert.match(erp, /type === 'CONTRACT_EMAIL'/);
    assert.match(erp, /type === 'PROPOSAL_EMAIL'/);
    assert.match(erp, /stripConsumedSendParams/);
    const page = src('src/app/page.tsx');
    assert.match(page, /proposalFlowNavigation\(window\.location\.search\)/);
    assert.equal(page.includes('bg-[#1e3a6e]'), false);
  });
});

describe('Atualizar validade: emissão do link continua igual', () => {
  const HTTP = { _fromHttpBridge: '1', _clientIp: '198.51.100.40' };

  it('sem MFA => 401; validade vencida => 409 PROPOSAL_EXPIRED sem URL e sem promover; validade ok em RASCUNHO => ENVIADA', async () => {
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const rec = repo.findRbacUserRecord('usr-seta-01', '')!;
    const claims = {
      uid: rec.id,
      email: rec.email,
      name: rec.name,
      roleId: rec.roleId,
      scope: rec.scope,
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
      moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      iat: Date.now() - 1000,
      exp: Date.now() + 3_600_000,
    };
    const session = signStiHubSessionToken(claims as Parameters<typeof signStiHubSessionToken>[0]);
    const noMfa = signStiHubSessionToken({ ...claims, mfaVerified: false } as Parameters<typeof signStiHubSessionToken>[0]);
    const expired = repo.createProposal({
      title: 'MUNDIVOX vencida',
      companyName: 'MUNDIVOX',
      status: 'RASCUNHO',
      validUntil: '2020-01-01',
      items: [],
    } as never);

    const anonymous = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${expired.id}/public-link`,
      query: { ...HTTP },
      body: {},
    });
    assert.equal(anonymous.status, 401);
    assert.equal((anonymous.body as { code?: string }).code, 'MFA_AUTH_REQUIRED');

    const weak = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${expired.id}/public-link`,
      query: { ...HTTP, _sessionToken: noMfa },
      body: {},
    });
    assert.equal(weak.status, 401);
    assert.equal((weak.body as { code?: string }).code, 'MFA_AUTH_REQUIRED');
    assert.equal(repo.listProposals().find((p) => p.id === expired.id)!.status, 'RASCUNHO');

    const blocked = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${expired.id}/public-link`,
      query: { ...HTTP, _sessionToken: session },
      body: {},
    });
    assert.equal(blocked.status, 409);
    assert.equal((blocked.body as { code?: string }).code, 'PROPOSAL_EXPIRED');
    assert.equal(JSON.stringify(blocked.body).includes('#t='), false);
    assert.equal(JSON.stringify(blocked.body).includes('"url"'), false);
    assert.equal(repo.listProposals().find((p) => p.id === expired.id)!.status, 'RASCUNHO');
    const auditText = repo.listSecurityAuditLogs(30).logs.map((l) => String((l as { details?: string }).details || '')).join('\n');
    assert.equal(auditText.includes('#t='), false);

    const fresh = repo.createProposal({
      title: 'MUNDIVOX vigente',
      companyName: 'MUNDIVOX',
      status: 'RASCUNHO',
      validUntil: '2099-12-31',
      items: [],
    } as never);
    const issued = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${fresh.id}/public-link`,
      query: { ...HTTP, _sessionToken: session },
      body: {},
    });
    assert.equal(issued.status, 200);
    assert.equal(repo.listProposals().find((p) => p.id === fresh.id)!.status, 'ENVIADA');
    const routerSrc = src('src/api/router.ts');
    const start = routerSrc.indexOf('private issueProposalPublicLink');
    const end = routerSrc.indexOf('private ', start + 40);
    const issueFn = routerSrc.slice(start, end > start ? end : start + 8000);
    assert.equal(issueFn.includes('mfaVerified'), true);
    assert.equal(issueFn.includes('ProposalLinkExpiredProposalError'), true);
    assert.equal(issueFn.includes("code: 'PROPOSAL_EXPIRED'"), true);
    assert.equal(issueFn.includes("status: 'ENVIADA'"), true);
    assert.equal(issueFn.indexOf('signProposalLinkToken') < issueFn.indexOf("status: 'ENVIADA'"), true);
  });
});
