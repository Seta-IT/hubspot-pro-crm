// STI-hub — Pacote O (CISO 02/11/2026): /api/email-templates com alcada de Marketing/admin,
// zod estrito, id do servidor, autoria da sessao, recusa auditada e journal sanitizado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';

const HTTP = { _fromHttpBridge: '1', _clientIp: '10.20.30.40' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'T', roleId, scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });
const FISCAL = () => ({ ...HTTP, _sessionToken: tok('usr-seta-06', 'fiscal@setatelecom.com.br', 'FISCAL_CONTABIL') });
const MKT = () => ({ ...HTTP, _sessionToken: tok('usr-seta-08', 'marketing@setatelecom.com.br', 'ANALISTA_MARKETING') });
const MKT_NO_MFA = () => ({ ...HTTP, _sessionToken: tok('usr-seta-08', 'marketing@setatelecom.com.br', 'ANALISTA_MARKETING', { mfaVerified: false }) });

function setup() {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const call = (method: string, path: string, query: Record<string, string>, body: unknown = {}) =>
    router.dispatch({ method, path, query, body: body as Record<string, unknown> });
  const mktUser = repo.getRbacState().users.find((u) => u.id === 'usr-seta-08');
  return { repo, router, call, mktName: mktUser?.name || '' };
}
const valid = { name: 'Modelo CISO', category: 'PROPOSTA', subject: 'Assunto do modelo', body: 'Olá,\n\ncorpo do modelo.' };
const denials = (repo: ReturnType<typeof createInMemoryRepository>) =>
  (repo.getRbacState().auditLogs || []).filter((l) => l.action === 'EMAIL_TEMPLATE_WRITE_DENIED').length;

describe('Pacote O: alcada de escrita dos modelos de e-mail', () => {
  it('Vendedor e Fiscal com 2FA: POST/PUT/PATCH/DELETE => 403 auditado, nada muda', async () => {
    const { repo, call } = setup();
    const before = JSON.stringify(repo.listEmailTemplates());
    const id = repo.listEmailTemplates()[0].id;
    for (const q of [SELLER, FISCAL]) {
      const d0 = denials(repo);
      assert.equal((await call('POST', '/api/email-templates', q(), valid)).status, 403);
      assert.equal((await call('PUT', `/api/email-templates/${id}`, q(), valid)).status, 403);
      assert.equal((await call('PATCH', `/api/email-templates/${id}`, q(), { name: 'x' })).status, 403);
      const del = await call('DELETE', `/api/email-templates/${id}`, q());
      assert.equal(del.status, 403);
      assert.equal((del.body as { code?: string }).code, 'EMAIL_TEMPLATE_FORBIDDEN');
      assert.equal(denials(repo) - d0, 4);
    }
    assert.equal(JSON.stringify(repo.listEmailTemplates()), before);
  });

  it('sem sessao => 401; Marketing sem 2FA => 401 (gate) e nada criado', async () => {
    const { repo, call } = setup();
    const n = repo.listEmailTemplates().length;
    assert.equal((await call('POST', '/api/email-templates', { ...HTTP }, valid)).status, 401);
    assert.equal((await call('POST', '/api/email-templates', MKT_NO_MFA(), valid)).status, 401);
    assert.equal(repo.listEmailTemplates().length, n);
  });

  it('GET lista para qualquer sessao com 2FA e devolve canManage pela mesma regra', async () => {
    const { call } = setup();
    for (const [q, exp] of [[SELLER, false], [FISCAL, false], [MKT, true], [ADMIN, true]] as const) {
      const r = await call('GET', '/api/email-templates', q());
      assert.equal(r.status, 200);
      assert.equal((r.body as { canManage?: boolean }).canManage, exp);
    }
  });
});

describe('Pacote O: criacao com id do servidor e autoria da sessao', () => {
  it('Marketing cria: id do navegador e createdBy ignorados; modelo existente intacto', async () => {
    const { repo, call, mktName } = setup();
    const existing = structuredClone(repo.listEmailTemplates().find((t) => t.id === 'tpl-fibra-b2b'));
    assert.ok(existing);
    const r = await call('POST', '/api/email-templates', MKT(), { ...valid, id: 'tpl-fibra-b2b', createdBy: 'Marcelo Lopes Mira', usageCount: 999 });
    assert.equal(r.status, 201);
    const d = (r.body as { data: Record<string, unknown> }).data;
    assert.notEqual(d.id, 'tpl-fibra-b2b');
    assert.match(String(d.id), /^tpl-[0-9a-f-]{36}$/);
    assert.equal(d.createdBy, mktName);
    assert.equal(d.updatedBy, mktName);
    assert.equal(d.usageCount, 0);
    assert.deepEqual(repo.listEmailTemplates().find((t) => t.id === 'tpl-fibra-b2b'), existing);
    assert.ok((repo.getRbacState().auditLogs || []).some((l) => l.action === 'EMAIL_TEMPLATE_CREATED'));
  });

  it('admin tambem cria', async () => {
    const { call } = setup();
    assert.equal((await call('POST', '/api/email-templates', ADMIN(), valid)).status, 201);
  });

  it('zod estrito e tetos: chave extra, controle, tamanho, categoria e corpo > 16 KiB', async () => {
    const { repo, call } = setup();
    const n = repo.listEmailTemplates().length;
    const bad = async (b: unknown, st = 400) => assert.equal((await call('POST', '/api/email-templates', MKT(), b)).status, st);
    await bad({ ...valid, html: '<b>x</b>' });
    await bad({ ...valid, name: 'linha\nquebrada' });
    await bad({ ...valid, subject: 'a\r\nBcc: x@y.z' });
    await bad({ ...valid, subject: 'x\u202Eabc' });
    await bad({ ...valid, name: 'n'.repeat(121) });
    await bad({ ...valid, subject: 's'.repeat(201) });
    await bad({ ...valid, body: 'b'.repeat(10_001) });
    await bad({ ...valid, body: 'tem \u0000 nulo' });
    await bad({ ...valid, category: 'SPAM' });
    await bad({ ...valid, name: '   ' });
    await bad({ ...valid, extra: 'x'.repeat(17 * 1024) }, 413);
    await bad([valid]);
    assert.equal(repo.listEmailTemplates().length, n);
  });
});

describe('Pacote O: alterar e excluir com a mesma alcada', () => {
  it('PATCH/PUT de Marketing mantem id, createdBy, createdAt e usageCount; updatedBy da sessao', async () => {
    const { repo, call, mktName } = setup();
    const cur = structuredClone(repo.listEmailTemplates().find((t) => t.id === 'tpl-fibra-b2b')!);
    const p = await call('PATCH', '/api/email-templates/tpl-fibra-b2b', MKT(), { subject: 'Novo assunto', createdBy: 'Outro', usageCount: 0, id: 'x' });
    assert.equal(p.status, 200);
    const d = (p.body as { data: Record<string, unknown> }).data;
    assert.equal(d.id, 'tpl-fibra-b2b');
    assert.equal(d.subject, 'Novo assunto');
    assert.equal(d.createdBy, cur.createdBy);
    assert.equal(d.createdAt, cur.createdAt);
    assert.equal(d.usageCount, cur.usageCount);
    assert.equal(d.updatedBy, mktName);
    assert.equal((await call('PUT', '/api/email-templates/tpl-fibra-b2b', MKT(), { name: 'só nome' })).status, 400);
    assert.equal((await call('PUT', '/api/email-templates/tpl-fibra-b2b', MKT(), valid)).status, 200);
    assert.equal((await call('PATCH', '/api/email-templates/tpl-fibra-b2b', MKT(), {})).status, 400);
    assert.equal((await call('PATCH', '/api/email-templates/nao-existe', MKT(), { name: 'x' })).status, 404);
  });

  it('DELETE de Marketing => 200 e some; repetido => 404; metodo desconhecido => 405', async () => {
    const { repo, call } = setup();
    assert.equal((await call('DELETE', '/api/email-templates/tpl-renovacao-upgrade', MKT())).status, 200);
    assert.equal(repo.listEmailTemplates().some((t) => t.id === 'tpl-renovacao-upgrade'), false);
    assert.equal((await call('DELETE', '/api/email-templates/tpl-renovacao-upgrade', MKT())).status, 404);
    assert.equal((await call('GET', '/api/email-templates/tpl-renovacao-upgrade', SELLER())).status, 404);
    assert.equal((await call('DELETE', '/api/email-templates', MKT())).status, 405);
    assert.equal((await call('POST', '/api/email-templates/tpl-fibra-b2b', MKT(), valid)).status, 405);
  });
});

describe('Pacote O: journal do navegador', () => {
  const fut = () => new Date(Date.now() + 120_000).toISOString();
  it('Vendedor nao altera nem cria modelo pelo journal (recusa auditada)', async () => {
    const { repo, call } = setup();
    const before = JSON.stringify(repo.listEmailTemplates());
    const cur = repo.listEmailTemplates().find((t) => t.id === 'tpl-fibra-b2b')!;
    const d0 = denials(repo);
    await call('POST', '/api/state/reconcile', SELLER(), {
      journal: {
        upsertedEmailTemplates: [
          { ...cur, body: 'sequestrado', createdBy: 'Marcelo Lopes Mira', updatedAt: fut() },
          { id: 'tpl-novo-pelo-journal', name: 'n', category: 'PROPOSTA', subject: 's', body: 'b', createdBy: 'X', usageCount: 0, createdAt: fut(), updatedAt: fut() },
        ],
      },
    });
    assert.equal(JSON.stringify(repo.listEmailTemplates()), before);
    assert.equal(denials(repo) - d0, 1);
  });

  it('Marketing altera pelo journal so os campos de conteudo; nunca cria; autoria da sessao', async () => {
    const { repo, call, mktName } = setup();
    const cur = structuredClone(repo.listEmailTemplates().find((t) => t.id === 'tpl-fibra-b2b')!);
    const n = repo.listEmailTemplates().length;
    await call('POST', '/api/state/reconcile', MKT(), {
      journal: {
        upsertedEmailTemplates: [
          { ...cur, body: 'corpo novo', createdBy: 'Outro', usageCount: 0, updatedAt: fut() },
          { id: 'tpl-novo-pelo-journal', name: 'n', category: 'PROPOSTA', subject: 's', body: 'b', createdBy: 'X', usageCount: 0, createdAt: fut(), updatedAt: fut() },
        ],
      },
    });
    const after = repo.listEmailTemplates().find((t) => t.id === 'tpl-fibra-b2b')!;
    assert.equal(after.body, 'corpo novo');
    assert.equal(after.createdBy, cur.createdBy);
    assert.equal(after.usageCount, cur.usageCount);
    assert.equal(after.updatedBy, mktName);
    assert.equal(repo.listEmailTemplates().length, n);
  });

  it('replay identico do proprio modelo nao gera recusa nem mudanca', async () => {
    const { repo, call } = setup();
    const cur = structuredClone(repo.listEmailTemplates()[0]);
    const d0 = denials(repo);
    await call('POST', '/api/state/reconcile', SELLER(), { journal: { upsertedEmailTemplates: [cur] } });
    assert.equal(denials(repo), d0);
    assert.deepEqual(repo.listEmailTemplates()[0], cur);
  });
});

describe('Pacote O: botoes da Central de Administracao para quem nao e admin', () => {
  it('Vendedor e Fiscal com 2FA recebem 403 em todas as acoes de IAM/admin/ERP da Central', async () => {
    const { repo, call } = setup();
    const snap = () =>
      JSON.stringify([
        repo.getRbacState().users.map((u) => {
          const x = u as unknown as Record<string, unknown>;
          return [x.id, x.roleId, x.active, x.mfaEnabled, x.totpSecret, x.totpConfigured, x.homeScreen ?? null, x.moduleAccess, x.erpPermissions];
        }),
        repo.getRbacState().users.length,
        repo.getErpOverview().gestaoClickConfig,
      ]);
    // Primeiro toque normaliza o estado (seed/hidratacao); a foto e tirada depois dele.
    await call('GET', '/api/email-templates', SELLER());
    await call('GET', '/api/email-templates', FISCAL());
    const s0 = snap();
    for (const q of [SELLER, FISCAL]) {
      const own = q === SELLER ? 'usr-seta-03' : 'usr-seta-06';
      const reqs: Array<[string, string, Record<string, unknown>?]> = [
        ['POST', '/api/admin/users', { name: 'X', email: 'x-ciso@setatelecom.com.br', roleId: 'SUPER_ADMIN' }],
        ['PATCH', '/api/admin/roles/VENDEDOR_SALES', { actionGuards: { canManageUsersRbac: true } }],
        ['PUT', '/api/admin/security', {}],
        ['PUT', '/api/admin/settings', { certificateSettings: { sefazEnvironment: 'HOMOLOGACAO' } }],
        ['POST', '/api/admin/migration-checklist', { moduleNumber: 1, validationStatus: 'PASSOU' }],
        ['PATCH', '/api/erp/gestaoclick/config', { companyLegalName: 'X LTDA' }],
        ['PATCH', '/api/erp/gestaoclick/config', { taxRegime: 'SIMPLES_NACIONAL' }],
        ['POST', '/api/erp/gestaoclick/sync', {}],
        ['POST', '/api/erp/daily-sync', { mode: 'DAILY_INCREMENTAL_SYNC' }],
      ];
      for (const id of [own, 'usr-seta-01']) {
        reqs.push(['POST', `/api/admin/users/${id}/invite`, {}]);
        reqs.push(['POST', `/api/admin/users/${id}/reset-mfa`, {}]);
        reqs.push(['PATCH', `/api/admin/users/${id}`, { roleId: 'SUPER_ADMIN' }]);
        reqs.push(['PATCH', `/api/admin/users/${id}/full-control`, { module: 'ERP', enabled: true }]);
        reqs.push(['PATCH', `/api/iam/users/${id}/home-screen`, { homeScreen: 'ERP_INICIO' }]);
        reqs.push(['DELETE', `/api/admin/users/${id}`, {}]);
      }
      for (const [m, p, b] of reqs) {
        const r = await call(m, p, q(), b || {});
        assert.equal(r.status, 403, `${m} ${p} => ${r.status}`);
      }
    }
    assert.equal(snap(), s0);
  });
});
