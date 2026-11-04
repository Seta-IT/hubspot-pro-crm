// ============================================================================
// STI-hub — Parecer CISO 04/11/2026 (lote Nova: abas/convite + e-mail CRM)
// (3) /api/communications/send-email: remetente RESEND_FROM_EMAIL; falha do provedor => 502
//     com codigo, sem gravar timeline; sucesso continua 200.
// (4) reenvio de convite invalida o link anterior (aceite e leitura conferem o mais recente).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = 'marcelo.mira@setatelecom.com.br';
const adminTok = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: ADMIN, name: 'Marcelo', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    canManageUsersRbac: true,
  } as Parameters<typeof signStiHubSessionToken>[0]);

async function withResend<T>(status: number | 'network', fn: (calls: Array<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM_EMAIL;
  const calls: Array<Record<string, unknown>> = [];
  process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
  process.env.RESEND_FROM_EMAIL = 'STI-hub <no-reply@notificacoes.setatelecom.com.br>';
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    if (status === 'network') throw new Error('rede');
    return new Response(JSON.stringify(status === 200 ? { id: 'email-test' } : { message: 'domain not verified' }), { status });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = prevFrom;
  }
}

describe('CISO 04/11 — send-email', () => {
  const send = (router: CrmApiRouter) =>
    router.dispatch({ method: 'POST', path: '/api/communications/send-email', query: { ...HTTP, _sessionToken: adminTok() }, body: { to: 'cliente@exemplo.invalid', subject: 'Proposta', body: 'corpo' } });

  it('usa RESEND_FROM_EMAIL (nunca comercial@ sem DKIM) e responde 200 quando entregue', async () => {
    await withResend(200, async (calls) => {
      const r = await send(new CrmApiRouter(createInMemoryRepository()));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].from, 'STI-hub <no-reply@notificacoes.setatelecom.com.br>');
      assert.equal((r.body as { data: { externalRelay: string } }).data.externalRelay, 'SENT_VIA_RESEND');
    });
  });

  for (const mode of [422, 500, 'network'] as const) {
    it(`falha do provedor (${mode}) => 502 EMAIL_SEND_FAILED, sem timeline e sem segredo`, async () => {
      await withResend(mode, async () => {
        const repo = createInMemoryRepository();
        const before = repo.listTimelineEvents().length;
        const r = await send(new CrmApiRouter(repo));
        assert.equal(r.status, 502);
        assert.equal((r.body as { code: string }).code, 'EMAIL_SEND_FAILED');
        assert.doesNotMatch(JSON.stringify(r.body), /re_test|domain not verified|Bearer/);
        const after = repo.listTimelineEvents().length;
        assert.equal(after, before, 'nada gravado como enviado');
      });
    });
  }

  it('telas que chamam send-email tratam a falha (nao assumem sucesso)', () => {
    const composer = readFileSync('src/app/components/ClientEmailComposerModal.tsx', 'utf8');
    assert.ok(composer.includes('setSendError(msg)'));
    assert.ok(!composer.includes('const json = res.ok ? await res.json() : null;'));
    const admin = readFileSync('src/app/components/AdminSettingsCenterTab.tsx', 'utf8');
    assert.ok(admin.includes('Falha ao enviar o e-mail de teste'));
    assert.ok(!admin.includes('STI_HUB_FROM_EMAIL'));
    const rbac = readFileSync('src/app/components/StiHubAdminRbacPanel.tsx', 'utf8');
    assert.ok(rbac.includes('Falha ao enviar o e-mail de teste'));
    const router = readFileSync('src/api/router.ts', 'utf8');
    assert.ok(!router.includes("'Seta Telecom <comercial@setatelecom.com.br>'"));
  });
});

describe('CISO 04/11 — reenvio de convite invalida o link anterior', () => {
  const SELLER = 'vendedor.lote1104@setatelecom.com.br';
  const PW = 'SenhaNova#2026A';
  it('link antigo recusado (leitura e aceite); link novo aceito', async () => {
    const repo = createInMemoryRepository();
    repo.upsertRbacUser({ email: SELLER, name: 'Vendedor', roleId: 'VENDEDOR_SALES' } as Parameters<typeof repo.upsertRbacUser>[0]);
    const inv1 = repo.createUserInvite(SELLER);
    await new Promise((r) => setTimeout(r, 5));
    const inv2 = repo.createUserInvite(SELLER);
    assert.notEqual(inv1.inviteToken, inv2.inviteToken);
    const old = repo.inspectUserInvite(inv1.inviteToken!);
    assert.equal(old.ok, false);
    assert.match(String(old.error), /substituído/);
    const oldAccept = repo.acceptUserInvite({ token: inv1.inviteToken!, password: PW });
    assert.equal(oldAccept.ok, false);
    assert.match(String(oldAccept.error), /substituído/);
    assert.equal(repo.inspectUserInvite(inv2.inviteToken!).ok, true);
    const ok = repo.acceptUserInvite({ token: inv2.inviteToken!, password: PW });
    assert.equal(ok.ok, true, String(ok.error));
  });
  it('instancia que nao conhece o reenvio (sem latestInviteIat) continua aceitando o link (sem quebrar convites atuais)', () => {
    const repo = createInMemoryRepository();
    repo.upsertRbacUser({ email: SELLER, name: 'Vendedor', roleId: 'VENDEDOR_SALES' } as Parameters<typeof repo.upsertRbacUser>[0]);
    const inv = repo.createUserInvite(SELLER);
    const rec = repo.findRbacUserRecord('', SELLER)! as { latestInviteIat?: number | null };
    rec.latestInviteIat = null;
    assert.equal(repo.inspectUserInvite(inv.inviteToken!).ok, true);
  });
  it('rota de reenvio continua so para admin (401 sem sessao)', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const r = await router.dispatch({ method: 'POST', path: '/api/admin/users/usr-seta-02/invite', query: { ...HTTP }, body: {} });
    assert.equal(r.status, 401);
  });
});
