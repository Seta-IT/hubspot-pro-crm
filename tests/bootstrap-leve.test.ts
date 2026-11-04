// ============================================================================
// Bootstrap enxuto (04/11/2026): com a migracao completa do GestaoClick (1176 clientes,
// 830 itens) a carga de /api/bootstrap passava de 4 MB (limite Vercel 4,5 MB).
//  - empresas sem vinculo de CRM vao na forma __lean; cadastro completo em /api/companies/:id
//  - /api/companies com busca e paginacao (?q=&limit=&offset=)
//  - aiReport.hiddenOpportunities, healthSummary.issues e accountEngagement limitados (top N)
//  - alertas de Data Health persistidos no estado limitados e com detectedAt estavel
//  - gravacoes (PATCH e journal) nunca perdem customProperties por causa da forma enxuta
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { Company } from '../src/db/types';
import {
  BOOTSTRAP_HEALTH_ISSUES_MAX,
  BOOTSTRAP_HIDDEN_OPPORTUNITIES_MAX,
  PERSISTED_HEALTH_ISSUES_MAX,
  isLeanCompany,
  paginate,
  toLeanCompany,
  topIssuesBySeverity,
} from '../src/modules/bootstrap/lean-payload';

function sessionFor(uid: string, email: string, roleId: string) {
  const iat = Date.now();
  return signStiHubSessionToken({
    uid,
    email,
    name: 'Teste Bootstrap Leve',
    roleId,
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat,
    exp: iat + 3_600_000,
  });
}
const admin = () => ({ _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN') });

function cnpjFor(i: number): string {
  // 12 digitos base + 2 verificadores validos
  const base = String(10_000_000 + i).padStart(8, '0') + '0001';
  const calc = (b: string, w: number[]) => {
    const s = b.split('').reduce((acc, d, k) => acc + Number(d) * w[k], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const n = base + d1 + d2;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

function gcCompany(i: number): Company {
  const now = '2026-11-04T12:00:00.000Z';
  return {
    id: `comp-gc-test-${i}`,
    name: `CLIENTE MIGRADO ${i} LTDA`,
    domain: null,
    cnpj: cnpjFor(i),
    industry: null,
    size: null,
    annualRevenue: null,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
    completenessScore: 50,
    ownerName: 'Marcelo Lopes Mira',
    enrichedAt: now,
    enrichmentSource: 'GestãoClick ERP API (migração completa 2026-11-04)',
    customProperties: {
      gestaoClickClientId: String(900000 + i),
      razaoSocial: `CLIENTE MIGRADO ${i} LTDA`,
      nomeFantasia: `Migrado ${i}`,
      inscricaoEstadual: '123456789',
      endereco: { logradouro: 'Rua Teste', numero: String(i), bairro: 'Centro', cep: '01000-000', nome_cidade: 'São Paulo', estado: 'SP' },
      origem: 'migracao-gc-20261104',
    },
    lastActivityAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function setupWithMigratedCompanies(n: number) {
  const repo = createInMemoryRepository();
  const state = repo.getState();
  for (let i = 0; i < n; i++) state.companies.push(gcCompany(i));
  return { repo, router: new CrmApiRouter(repo) };
}

describe('Bootstrap enxuto: projecao de empresas', () => {
  it('toLeanCompany mantem campos de lista, omite endereco/IE/enrichedAt e nulos, marca __lean', () => {
    const lean = toLeanCompany(gcCompany(1)) as Record<string, unknown>;
    assert.equal(lean.__lean, true);
    assert.equal(lean.name, 'CLIENTE MIGRADO 1 LTDA');
    assert.equal(lean.cnpj, cnpjFor(1));
    assert.equal(lean.city, 'São Paulo');
    assert.equal('enrichedAt' in lean, false);
    assert.equal('domain' in lean, false, 'null vira chave ausente (eco do cliente nao zera o servidor)');
    const cp = lean.customProperties as Record<string, unknown>;
    assert.equal(cp.gestaoClickClientId, '900001');
    assert.equal(cp.nomeFantasia, 'Migrado 1');
    assert.equal('endereco' in cp, false);
    assert.equal('inscricaoEstadual' in cp, false);
    assert.ok(isLeanCompany(lean));
    assert.equal(isLeanCompany(gcCompany(1)), false);
  });

  it('/api/bootstrap: empresas sem vinculo vao enxutas, empresas com contato/negocio seguem completas', async () => {
    const { repo, router } = setupWithMigratedCompanies(300);
    const linkedIds = new Set(repo.listContacts().map((c) => c.companyId).filter(Boolean) as string[]);
    assert.ok(linkedIds.size > 0, 'seed tem empresas com contato');
    const r = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: admin() });
    assert.equal(r.status, 200);
    const data = (r.body as { data: Record<string, unknown> }).data;
    const companies = data.companies as Array<Record<string, unknown>>;
    assert.equal(companies.length, repo.listCompanies().length, 'todas as empresas continuam na lista (selects/buscas)');
    for (const c of companies) {
      if (linkedIds.has(String(c.id))) assert.equal(c.__lean, undefined, `empresa com vinculo ${c.id} completa`);
    }
    const migrated = companies.filter((c) => String(c.id).startsWith('comp-gc-test-'));
    assert.equal(migrated.length, 300);
    assert.ok(migrated.every((c) => c.__lean === true));
    assert.ok(migrated.every((c) => !('endereco' in (c.customProperties as Record<string, unknown>))));
    // contagens seguem presentes
    assert.ok(migrated.every((c) => c.contactsCount === 0 && c.dealsCount === 0));
  });

  it('/api/bootstrap: listas derivadas limitadas (top N) com o total original', async () => {
    const { router } = setupWithMigratedCompanies(400);
    const r = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: admin() });
    const data = (r.body as { data: Record<string, any> }).data;
    assert.ok(data.aiReport.hiddenOpportunities.length <= BOOTSTRAP_HIDDEN_OPPORTUNITIES_MAX);
    assert.equal(typeof data.aiReport.hiddenOpportunitiesTotal, 'number');
    assert.ok(data.healthSummary.issues.length <= BOOTSTRAP_HEALTH_ISSUES_MAX);
    assert.ok(data.healthSummary.issuesTotal >= data.healthSummary.issues.length);
    assert.ok(data.healthSummary.issuesTotal > BOOTSTRAP_HEALTH_ISSUES_MAX, '400 empresas incompletas geram mais alertas que o teto');
    assert.ok(data.accountEngagement.length <= 20);
    assert.equal(data.accountEngagementTotal, (data.companies as unknown[]).length);
  });

  it('/api/bootstrap com 1200 empresas migradas fica bem abaixo do limite de 4,5 MB', async () => {
    const { router } = setupWithMigratedCompanies(1200);
    const r = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: admin() });
    const bytes = Buffer.byteLength(JSON.stringify(r.body));
    assert.ok(bytes < 2_500_000, `bootstrap com 1200 empresas: ${bytes} bytes`);
  });
});

describe('Bootstrap enxuto: /api/companies com busca e paginacao', () => {
  it('limit/offset paginam e total reflete o filtro', async () => {
    const { router, repo } = setupWithMigratedCompanies(120);
    const total = repo.listCompanies().length;
    const p1 = await router.dispatch({ method: 'GET', path: '/api/companies', query: { ...admin(), limit: '50', offset: '0' } });
    const b1 = p1.body as { data: Company[]; total: number; limit: number; offset: number };
    assert.equal(p1.status, 200);
    assert.equal(b1.data.length, 50);
    assert.equal(b1.total, total);
    assert.equal(b1.limit, 50);
    const p3 = await router.dispatch({ method: 'GET', path: '/api/companies', query: { ...admin(), limit: '50', offset: '100' } });
    const b3 = p3.body as { data: Company[]; total: number };
    assert.equal(b3.data.length, total - 100);
    // sem limit: lista inteira (compatibilidade)
    const all = await router.dispatch({ method: 'GET', path: '/api/companies', query: admin() });
    assert.equal((all.body as { data: Company[] }).data.length, total);
  });

  it('busca por nome (q) e por digitos do CNPJ encontra a empresa migrada, com cadastro completo', async () => {
    const { router } = setupWithMigratedCompanies(80);
    const byName = await router.dispatch({ method: 'GET', path: '/api/companies', query: { ...admin(), q: 'cliente migrado 77', limit: '10' } });
    const bn = byName.body as { data: Company[]; total: number };
    assert.equal(bn.total, 1);
    assert.equal(bn.data[0].id, 'comp-gc-test-77');
    assert.ok((bn.data[0].customProperties as Record<string, unknown>).endereco, 'endpoint paginado devolve o cadastro completo');
    const digits = cnpjFor(42).replace(/\D+/g, '');
    const byDoc = await router.dispatch({ method: 'GET', path: '/api/companies', query: { ...admin(), q: digits, limit: '10' } });
    assert.equal((byDoc.body as { data: Company[] }).data[0].id, 'comp-gc-test-42');
    const one = await router.dispatch({ method: 'GET', path: '/api/companies/comp-gc-test-42', query: admin() });
    assert.equal(one.status, 200);
    assert.ok(((one.body as { data: Company }).data.customProperties as Record<string, unknown>).inscricaoEstadual);
  });

  it('paginate: limites e valores invalidos', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    assert.deepEqual(paginate(items, '3', '2').page, [2, 3, 4]);
    assert.equal(paginate(items, '9999').limit, 500);
    assert.equal(paginate(items, '0').limit, 50, 'limit invalido/zero usa o padrao 50');
    assert.equal(paginate(items, '-3').limit, 1);
    assert.equal(paginate(items, undefined, '-5').offset, 0);
    assert.equal(paginate(items).page.length, 10);
  });
});

describe('Bootstrap enxuto: gravacoes nunca perdem dados por causa da forma enxuta', () => {
  it('journal com empresa __lean faz merge de customProperties e nao grava o marcador', () => {
    const { repo } = setupWithMigratedCompanies(3);
    const lean = toLeanCompany(repo.getCompanyById('comp-gc-test-1')!) as unknown as Company;
    const edited = { ...lean, ownerName: 'Outro Vendedor', updatedAt: new Date(Date.now() + 1000).toISOString() };
    repo.reconcileClientState({ upsertedCompanies: [edited] });
    const after = repo.getCompanyById('comp-gc-test-1')! as Company & Record<string, unknown>;
    assert.equal(after.ownerName, 'Outro Vendedor');
    assert.equal(after.__lean, undefined);
    const cp = after.customProperties as Record<string, unknown>;
    assert.ok(cp.endereco, 'endereco preservado');
    assert.equal(cp.inscricaoEstadual, '123456789');
    assert.equal(after.enrichedAt, '2026-11-04T12:00:00.000Z', 'campo omitido na forma enxuta preservado');
  });

  it('PATCH /api/companies/:id com objeto __lean preserva customProperties e descarta o marcador', async () => {
    const { repo, router } = setupWithMigratedCompanies(2);
    const lean = toLeanCompany(repo.getCompanyById('comp-gc-test-0')!) as unknown as Record<string, unknown>;
    const r = await router.dispatch({ method: 'PATCH', path: '/api/companies/comp-gc-test-0', query: admin(), body: { ...lean, city: 'Campinas' } });
    assert.equal(r.status, 200);
    const after = repo.getCompanyById('comp-gc-test-0')! as Company & Record<string, unknown>;
    assert.equal(after.city, 'Campinas');
    assert.equal(after.__lean, undefined);
    assert.ok((after.customProperties as Record<string, unknown>).endereco);
  });
});

describe('Bootstrap enxuto: alertas de Data Health persistidos', () => {
  it('estado guarda no maximo PERSISTED_HEALTH_ISSUES_MAX alertas, os mais graves, com detectedAt estavel', async () => {
    const { repo, router } = setupWithMigratedCompanies(400);
    await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: admin() });
    const first = repo.getState().dataHealthIssues;
    assert.ok(first.length <= PERSISTED_HEALTH_ISSUES_MAX, `persistidos: ${first.length}`);
    const firstById = new Map(first.map((i) => [i.id, i.detectedAt]));
    await new Promise((res) => setTimeout(res, 5));
    await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: admin() });
    const second = repo.getState().dataHealthIssues;
    let same = 0;
    for (const i of second) if (firstById.get(i.id) === i.detectedAt) same++;
    assert.ok(same > 0 && same === second.filter((i) => firstById.has(i.id)).length, 'detectedAt mantido entre cargas');
  });

  it('topIssuesBySeverity ordena HIGH antes de MEDIUM e e estavel', () => {
    const list = [
      { id: 'a', severity: 'MEDIUM' },
      { id: 'b', severity: 'HIGH' },
      { id: 'c', severity: 'LOW' },
      { id: 'd', severity: 'HIGH' },
    ];
    assert.deepEqual(topIssuesBySeverity(list, 3).map((i) => i.id), ['b', 'd', 'a']);
  });
});
