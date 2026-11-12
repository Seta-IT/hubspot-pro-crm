import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';

const HTTP = { _fromHttpBridge: '1' };
const saved: Record<string, string | undefined> = {};

before(() => {
  saved.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET;
  process.env.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET || 's'.repeat(48);
});

after(() => {
  if (saved.STI_HUB_SESSION_SECRET === undefined) delete process.env.STI_HUB_SESSION_SECRET;
  else process.env.STI_HUB_SESSION_SECRET = saved.STI_HUB_SESSION_SECRET;
});

const tokFor = (repo: CrmRepository, uid = 'usr-seta-01', extra: Record<string, unknown> = {}) => {
  const r = repo.findRbacUserRecord(uid, '')!;
  return signStiHubSessionToken({
    uid: r.id,
    email: r.email,
    name: r.name,
    roleId: r.roleId,
    scope: r.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
    ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
};

const chamadosOnly = (repo: CrmRepository) =>
  tokFor(repo, 'usr-seta-05', {
    enabledModules: ['CHAMADOS'],
    moduleAccess: { crm: false, erp: false, chamados: true },
  });

const crmOnly = (repo: CrmRepository) =>
  tokFor(repo, 'usr-seta-03', {
    enabledModules: ['CRM'],
    moduleAccess: { crm: true, erp: false, chamados: false },
  });

const erpOnly = (repo: CrmRepository) =>
  tokFor(repo, 'usr-seta-04', {
    enabledModules: ['ERP'],
    moduleAccess: { crm: false, erp: true, chamados: false },
  });

describe('Permissão de módulo no envio de e-mail sem fatura', () => {
  it('proposta e envio avulso em /api/communications/send-email exigem CRM ou ERP (403 sem o módulo)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const payload = {
      to: 'cliente@exemplo.invalid',
      subject: 'Proposta comercial',
      body: 'Segue a proposta.',
      docType: 'PROPOSAL',
    };

    const blocked = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: { ...HTTP, _clientIp: '198.51.100.21', _sessionToken: chamadosOnly(repo) },
      body: payload,
    });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    assert.equal((blocked.body as { code: string }).code, 'MODULE_CRM_OR_ERP_FORBIDDEN');

    const crmRes = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: { ...HTTP, _clientIp: '198.51.100.22', _sessionToken: crmOnly(repo) },
      body: payload,
    });
    assert.notEqual(crmRes.status, 403, JSON.stringify(crmRes.body));
    assert.notEqual((crmRes.body as { code?: string }).code, 'MODULE_CRM_OR_ERP_FORBIDDEN');

    const erpRes = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: { ...HTTP, _clientIp: '198.51.100.23', _sessionToken: erpOnly(repo) },
      body: payload,
    });
    assert.notEqual(erpRes.status, 403, JSON.stringify(erpRes.body));
    assert.notEqual((erpRes.body as { code?: string }).code, 'MODULE_CRM_OR_ERP_FORBIDDEN');
  });

  it('POST /api/emails/send avulso também exige CRM ou ERP', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const payload = { to: 'cliente@exemplo.invalid', subject: 'Contato', body: 'Olá.' };

    const blocked = await router.dispatch({
      method: 'POST',
      path: '/api/emails/send',
      query: { ...HTTP, _clientIp: '198.51.100.24', _sessionToken: chamadosOnly(repo) },
      body: payload,
    });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    assert.equal((blocked.body as { code: string }).code, 'MODULE_CRM_OR_ERP_FORBIDDEN');

    const crmRes = await router.dispatch({
      method: 'POST',
      path: '/api/emails/send',
      query: { ...HTTP, _clientIp: '198.51.100.25', _sessionToken: crmOnly(repo) },
      body: payload,
    });
    assert.notEqual(crmRes.status, 403, JSON.stringify(crmRes.body));
  });

  it('contrato segue exigindo ERP; caixa /api/mailbox já exige CRM', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const contract = repo.createRentalContract({
      title: 'Contrato permissão',
      companyName: 'Cliente Perm LTDA',
      companyCnpj: '00.000.000/0001-00',
      monthlyValue: 10,
    });
    const blocked = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: { ...HTTP, _clientIp: '198.51.100.26', _sessionToken: crmOnly(repo) },
      body: {
        to: 'cliente@exemplo.invalid',
        subject: 'Contrato',
        body: 'Segue o contrato.',
        docType: 'RENTAL_RECEIPT',
        contractId: contract.id,
      },
    });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    assert.equal((blocked.body as { code: string }).code, 'MODULE_ERP_FORBIDDEN');

    const mailbox = readFileSync(path.join(process.cwd(), 'src/api/mailbox-routes.ts'), 'utf8');
    assert.match(mailbox, /if \(!sess\.moduleAccess\?\.crm\)/);
    assert.match(mailbox, /MAILBOX_CRM_FORBIDDEN/);
  });
});
