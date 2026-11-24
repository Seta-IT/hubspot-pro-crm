// Propostas da conta de serviço: acesso de qualquer sessão Seta, rascunho até o link e aberturas do cliente.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { hashServiceToken, SALES_AGENT_CREATED_NOTE, SALES_AGENT_TOKEN_ENV } from '../src/app/lib/service-account';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { signProposalLinkToken } from '../src/app/lib/proposal-link';
import { PUBLIC_PROPOSAL_DTO_KEYS } from '../src/app/lib/proposal-public-dto';
import { formatClientProposalViews, isProposalLinkPreviewAgent } from '../src/app/lib/proposal-client-view';

const TOKEN = `stihub_svc_${randomBytes(32).toString('base64url')}`;
const HTTP = { _fromHttpBridge: '1' };
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const LINK_SECRET = 'c'.repeat(48);

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevToken = process.env[SALES_AGENT_TOKEN_ENV];
  const prevSecret = process.env.STI_HUB_PROPOSAL_LINK_SECRET;
  process.env[SALES_AGENT_TOKEN_ENV] = createHash('sha256').update(TOKEN).digest('hex');
  process.env.STI_HUB_PROPOSAL_LINK_SECRET = LINK_SECRET;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevToken === undefined) delete process.env[SALES_AGENT_TOKEN_ENV];
      else process.env[SALES_AGENT_TOKEN_ENV] = prevToken;
      if (prevSecret === undefined) delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
      else process.env.STI_HUB_PROPOSAL_LINK_SECRET = prevSecret;
    });
}

function sessionFor(repo: ReturnType<typeof createInMemoryRepository>, uid: string) {
  const rec = repo.findRbacUserRecord(uid, '');
  assert.ok(rec, uid);
  return signStiHubSessionToken({
    uid: rec!.id,
    email: rec!.email,
    name: rec!.name,
    roleId: rec!.roleId,
    scope: rec!.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
  });
}

const svc = (router: CrmApiRouter, method: string, path: string, body: Record<string, unknown> = {}) =>
  router.dispatch({
    method,
    path,
    query: { ...HTTP, _svcBearer: '1', _svcTokenSha256: hashServiceToken(TOKEN), _clientIp: '200.1.1.1' },
    body,
  });

describe('Propostas da conta de serviço', () => {
  it('qualquer sessão Seta vê e edita; sem sessão continua 404; proposta de outro vendedor é 403', async () => {
    await withEnv(async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const created = await svc(router, 'POST', '/api/erp/proposals', { title: 'Orçamento do assistente', status: 'ENVIADA' });
      assert.equal(created.status, 201);
      const proposal = (created.body as { data: { id: string; status: string; createdByServiceAccount?: boolean; commercialNotes?: string; sellerUserId?: string } }).data;
      assert.equal(proposal.status, 'RASCUNHO');
      assert.equal(proposal.createdByServiceAccount, true);
      assert.ok(String(proposal.commercialNotes || '').includes(SALES_AGENT_CREATED_NOTE));
      assert.equal(proposal.sellerUserId, 'usr-seta-01');

      const maria = sessionFor(repo, 'usr-seta-03');
      const seen = await router.dispatch({
        method: 'GET',
        path: `/api/erp/proposals/${proposal.id}`,
        query: { ...HTTP, _sessionToken: maria },
      });
      assert.equal(seen.status, 200);
      const edited = await router.dispatch({
        method: 'PATCH',
        path: `/api/erp/proposals/${proposal.id}`,
        query: { ...HTTP, _sessionToken: maria },
        body: { title: 'Orçamento ajustado pela Maria' },
      });
      assert.equal(edited.status, 200);
      assert.equal((edited.body as { data: { title: string; status: string } }).data.title, 'Orçamento ajustado pela Maria');
      assert.equal((edited.body as { data: { status: string } }).data.status, 'RASCUNHO');

      const anon = await router.dispatch({
        method: 'GET',
        path: `/api/erp/proposals/${proposal.id}`,
        query: { ...HTTP },
      });
      assert.equal(anon.status, 404);

      const missing = await router.dispatch({
        method: 'GET',
        path: '/api/erp/proposals/prop-que-nao-existe',
        query: { ...HTTP, _sessionToken: maria },
      });
      assert.equal(missing.status, 404);

      const manual = repo.createProposal(
        { title: 'Proposta manual do Marcelo', status: 'ENVIADA' },
        { sellerUserId: 'usr-seta-01' }
      );
      const denied = await router.dispatch({
        method: 'GET',
        path: `/api/erp/proposals/${manual.id}`,
        query: { ...HTTP, _sessionToken: maria },
      });
      assert.equal(denied.status, 403);
      assert.equal((denied.body as { code: string }).code, 'PROPOSAL_SCOPE_FORBIDDEN');

      const legacy = repo.createProposal(
        {
          title: 'Proposta antiga do assistente',
          status: 'ENVIADA',
          commercialNotes: `Observação. ${SALES_AGENT_CREATED_NOTE}`,
        },
        { sellerUserId: 'usr-seta-01' }
      );
      const legacySeen = await router.dispatch({
        method: 'GET',
        path: `/api/erp/proposals/${legacy.id}`,
        query: { ...HTTP, _sessionToken: maria },
      });
      assert.equal(legacySeen.status, 200);
      assert.equal((legacySeen.body as { data: { status: string } }).data.status, 'ENVIADA');
    });
  });

  it('o link do cliente promove só RASCUNHO e a abertura anônima conta uma vez', async () => {
    await withEnv(async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const admin = sessionFor(repo, 'usr-seta-01');
      const created = await svc(router, 'POST', '/api/erp/proposals', { title: 'Aguardando link' });
      const id = (created.body as { data: { id: string } }).data.id;
      assert.equal(repo.listProposals().find((p) => p.id === id)?.status, 'RASCUNHO');

      const issued = await router.dispatch({
        method: 'POST',
        path: `/api/erp/proposals/${id}/public-link`,
        query: { ...HTTP, _sessionToken: admin, _origin: 'https://sti-hub.vercel.app' },
        body: {},
      });
      assert.equal(issued.status, 200);
      const sent = repo.listProposals().find((p) => p.id === id)!;
      assert.equal(sent.status, 'ENVIADA');
      const versionAfterLink = Math.max(1, Number(sent.version || 1));
      const shortUrl = (issued.body as { data: { shortUrl: string } }).data.shortUrl;
      const code = shortUrl.split('/p/')[1];
      assert.ok(code);

      const alreadySent = repo.createProposal(
        { title: 'Já enviada', status: 'ENVIADA', commercialNotes: SALES_AGENT_CREATED_NOTE },
        { sellerUserId: 'usr-seta-01' }
      );
      const again = await router.dispatch({
        method: 'POST',
        path: `/api/erp/proposals/${alreadySent.id}/public-link`,
        query: { ...HTTP, _sessionToken: admin, _origin: 'https://sti-hub.vercel.app' },
        body: {},
      });
      assert.equal(again.status, 200);
      assert.equal(repo.listProposals().find((p) => p.id === alreadySent.id)?.status, 'ENVIADA');

      const open = (ua: string, session?: string) =>
        router.dispatch({
          method: 'GET',
          path: `/api/p/${code}`,
          query: { ...HTTP, _userAgent: ua, _clientIp: '198.51.100.20', ...(session ? { _sessionToken: session } : {}) },
        });
      assert.equal((await open(BROWSER)).status, 200);
      assert.equal((await open(BROWSER)).status, 200);
      assert.equal((await open('WhatsApp/2.23.20.0')).status, 200);
      assert.equal((await open('')).status, 200);
      assert.equal((await open(BROWSER, admin)).status, 200);

      const afterShort = repo.listProposals().find((p) => p.id === id)!;
      assert.equal(afterShort.viewCount, 2);
      assert.ok(afterShort.firstViewedAt);
      assert.ok(afterShort.lastViewedAt);
      assert.equal(afterShort.version, versionAfterLink);
      const first = afterShort.firstViewedAt;

      const token = signProposalLinkToken({ proposalId: id, version: versionAfterLink }).token;
      const viaPage = await router.dispatch({
        method: 'GET',
        path: `/api/erp/proposals/${id}`,
        query: { ...HTTP, proposalLinkToken: token, _userAgent: BROWSER, _clientIp: '198.51.100.21' },
      });
      assert.equal(viaPage.status, 200);
      const dto = (viaPage.body as { data: Record<string, unknown> }).data;
      assert.equal('viewCount' in dto, false);
      assert.equal('firstViewedAt' in dto, false);
      assert.equal('internalNotes' in dto, false);
      assert.ok(PUBLIC_PROPOSAL_DTO_KEYS.every((key) => key in dto));

      const counted = repo.listProposals().find((p) => p.id === id)!;
      assert.equal(counted.viewCount, 3);
      assert.equal(counted.firstViewedAt, first);
      assert.equal(counted.version, versionAfterLink);

      const status = await router.dispatch({
        method: 'GET',
        path: `/api/erp/proposals/${id}/acceptance-status`,
        query: { ...HTTP, _sessionToken: admin },
      });
      assert.equal(status.status, 200);
      const body = (status.body as { data: Record<string, unknown> }).data;
      assert.equal(body.proposalId, id);
      assert.equal(body.status, 'ENVIADA');
      assert.equal(body.viewCount, 3);
      assert.equal(body.firstViewedAt, first);
      assert.equal(typeof body.lastViewedAt, 'string');
      assert.equal(typeof (body.acceptance as { accepted: boolean }).accepted, 'boolean');
      assert.equal(typeof body.updatedAt, 'string');

      const line = formatClientProposalViews(counted);
      assert.match(line || '', /^Aberta pelo cliente: 3 vezes, primeira em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}, última em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
      assert.equal(isProposalLinkPreviewAgent('Slackbot-LinkExpanding 1.0'), true);
      assert.equal(isProposalLinkPreviewAgent(BROWSER), false);
    });
  });
});
