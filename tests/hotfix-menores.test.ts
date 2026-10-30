// ============================================================================
// STI-hub — HOTFIX 29/10/2026, menores: (a) senha definida pelo admin no IAM so vale se NOVA
// e com >= 12 caracteres (existentes intocadas); (b) APIs de CNPJ sem rede nos testes.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = 'marcelo.mira@setatelecom.com.br';
const adminTok = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: ADMIN, name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    canManageUsersRbac: true,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const fresh = () => {
  const repo = createInMemoryRepository();
  return { repo, router: new CrmApiRouter(repo) };
};

describe('Menor (a): senha definida pelo admin no IAM — so senhas NOVAS >= 12', () => {
  it('criar com senha de 11 => 400 (antes de qualquer convite)', async () => {
    const { router } = fresh();
    const r = await router.dispatch({
      method: 'POST', path: '/api/admin/users', query: { ...HTTP, _sessionToken: adminTok() },
      body: { name: 'Novo', email: 'novo.iam@setatelecom.com.br', roleId: 'VENDEDOR_SALES', password: 'Curta#2026A' },
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /12 caracteres/);
  });

  it('editar: nova senha 11 => 400; 12+ => ok; senha existente curta reenviada => ignorada (nada invalidado)', async () => {
    const { repo, router } = fresh();
    const email = 'legado.iam@setatelecom.com.br';
    repo.upsertRbacUser({ email, name: 'Legado', roleId: 'VENDEDOR_SALES', password: 'Antiga#8' } as Parameters<typeof repo.upsertRbacUser>[0]);
    const rec = repo.findRbacUserRecord('', email)!;
    const hashBefore = rec.passwordHash;
    const put = (body: Record<string, unknown>) =>
      router.dispatch({ method: 'PUT', path: `/api/admin/users/${rec.id}`, query: { ...HTTP, _sessionToken: adminTok() }, body });
    const same = await put({ jobTitle: 'Analista', password: 'Antiga#8' });
    assert.ok(same.status < 300, JSON.stringify(same.body));
    assert.equal(repo.findRbacUserRecord(rec.id, '')!.passwordHash, hashBefore);
    const short = await put({ password: 'Curta#2026A' });
    assert.equal(short.status, 400);
    assert.equal(repo.findRbacUserRecord(rec.id, '')!.passwordHash, hashBefore);
    const ok = await put({ password: 'SenhaNova#2026A' });
    assert.ok(ok.status < 300, JSON.stringify(ok.body));
    assert.notEqual(repo.findRbacUserRecord(rec.id, '')!.passwordHash, hashBefore);
  });
});

describe('Menor (b): APIs de CNPJ nunca vao a rede nos testes', () => {
  it('brasilapi, receitaws e publica.cnpj.ws => mock local 404', async () => {
    for (const url of [
      'https://brasilapi.com.br/api/cnpj/v1/00000000000191',
      'https://receitaws.com.br/v1/cnpj/00000000000191',
      'https://publica.cnpj.ws/cnpj/00000000000191',
    ]) {
      const r = await fetch(url);
      assert.equal(r.status, 404);
      assert.equal(((await r.json()) as { name: string }).name, 'test_network_mocked');
    }
  });
});
