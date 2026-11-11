// Visão interna da proposta (link estável para o contrato).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { evaluateStiHubRouteProtection, isPublicStiHubPath, middleware } from '../src/middleware';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { CrmApiRouter } from '../src/api/router';
import {
  buildStableInternalProposalUrl,
  copyInternalProposalLink,
  resolveInternalProposalKind,
  toInternalProposalSummary,
} from '../src/app/lib/internal-proposal-summary';
import { getProposalsByRefs, proposalRouteLookupRefs, type PgQ } from '../src/db/proposal-store';
import {
  buildInternalProposalPdf,
  buildInternalProposalPrintHtml,
  internalProposalPdfFileName,
} from '../src/app/lib/internal-proposal-pdf';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HTTP = { _fromHttpBridge: '1', _origin: 'https://sti-hub.vercel.app' };

function adminToken(): string {
  return signStiHubSessionToken({
    uid: 'usr-seta-01',
    email: 'marcelo.mira@setatelecom.com.br',
    name: 'Marcelo Lopes Mira',
    roleId: 'SUPER_ADMIN',
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
  });
}

function baseProposal(over: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-x',
    code: '4700',
    title: 'Proposta',
    companyId: null,
    companyName: 'Cliente',
    companyCnpj: '03.241.757/0001-65',
    contactId: null,
    contactName: '',
    dealId: null,
    sellerName: 'Marcelo Lopes Mira',
    status: 'ENVIADA',
    contractMonths: 36,
    paymentCondition: 'Mensalidade via boleto',
    validUntil: '2026-11-13',
    items: [],
    monthlyRecurringTotal: 0,
    oneTimeSetupTotal: 0,
    totalContractValue: 0,
    commercialNotes: '',
    technicalClauses: '',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    version: 1,
    ...over,
  };
}

describe('Link interno: acesso', () => {
  it('sem login a página redireciona ao login e a API responde 401, sem dados', async () => {
    const path = '/interno/proposta/prop-via-italia-loc-20261106';
    assert.equal(isPublicStiHubPath(path, 'GET'), false);
    assert.equal(isPublicStiHubPath('/api/interno/proposta/prop-via-italia-loc-20261106', 'GET'), false);
    const decision = evaluateStiHubRouteProtection({ pathname: path, method: 'GET', sessionToken: null });
    assert.equal(decision.allowed, false);
    assert.equal(decision.statusCode, 307);
    assert.equal(decision.redirectTo, `/login?next=${encodeURIComponent(path)}`);
    const apiDecision = evaluateStiHubRouteProtection({
      pathname: '/api/interno/proposta/prop-via-italia-loc-20261106',
      method: 'GET',
      sessionToken: null,
    });
    assert.equal(apiDecision.statusCode, 401);

    const res = middleware(new NextRequest(`https://sti-hub.vercel.app${path}`));
    assert.equal(res.status, 307);
    const location = res.headers.get('location') || '';
    assert.match(location, /\/login\?next=%2Finterno%2Fproposta%2Fprop-via-italia-loc-20261106/);

    const router = new CrmApiRouter(createInMemoryRepository());
    const anon = await router.dispatch({
      method: 'GET',
      path: '/api/interno/proposta/prop-fixture-001',
      query: { ...HTTP },
    });
    assert.equal(anon.status, 401);
    assert.equal((anon.body as { code: string }).code, 'MFA_AUTH_REQUIRED');
    assert.equal(JSON.stringify(anon.body).includes('internalNotes'), false);
    assert.equal(JSON.stringify(anon.body).includes('Nu Pagamentos'), false);
  });

  it('com login a API devolve a visão; sem permissão de leitura, 403', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const ok = await router.dispatch({
      method: 'GET',
      path: '/api/interno/proposta/prop-fixture-001',
      query: { ...HTTP, _sessionToken: adminToken() },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const data = (ok.body as { data: { kind: string; codeLabel: string; companyCnpj: string; stablePath: string; internalNotes: string } }).data;
    assert.equal(data.kind, 'LOCACAO');
    assert.equal(data.codeLabel, '#4699');
    assert.equal(data.companyCnpj, '18.236.120/0001-58');
    assert.equal(data.stablePath, '/interno/proposta/prop-fixture-001');
    assert.doesNotMatch(data.stablePath, /token|#t=|version/);

    const denied = await router.dispatch({
      method: 'GET',
      path: '/api/interno/proposta/prop-fixture-001',
      query: {
        ...HTTP,
        _sessionToken: signStiHubSessionToken({
          uid: 'usr-seta-07',
          email: 'pdv.matriz@setatelecom.com.br',
          name: 'Lucas Ferreira',
          roleId: 'OPERADOR_PDV_ESTOQUE',
          scope: 'EQUIPE',
          enabledModules: ['ERP'],
          moduleAccess: { crm: false, erp: true, chamados: false },
          mfaVerified: true,
          mfaMethod: 'EMAIL_OTP',
          iat: Date.now() - 1000,
          exp: Date.now() + 3_600_000,
        }),
      },
    });
    assert.equal(denied.status, 403);
    assert.equal(JSON.stringify(denied.body).includes('Nu Pagamentos'), false);
  });
});

describe('Link interno: locação, serviço, produtos e URL estável', () => {
  it('locação separa o período do frete; serviço e produtos usam o rótulo certo; campo ausente fica não definido', () => {
    const loc = toInternalProposalSummary(baseProposal({
      id: 'prop-via-italia-loc-20261106',
      code: '4711',
      budgetType: 'LOCACAO',
      modality: 'RENTAL',
      companyName: 'Via Itália',
      companyCnpj: '07.638.845/0001-56',
      contractMonths: 36,
      monthlyRecurringTotal: 4490,
      shippingCost: 650,
      setupFee: 0,
      readjustmentIndex: 'IPCA',
      slaTier: 'CORPORATIVO_8X5_NBD',
      slaAvailabilityPercent: '99,50%',
      slaResponseHours: 4,
      paymentCondition: 'Mensalidade via boleto bancário',
      validUntil: '2026-11-13',
      internalNotes: 'nota interna da locação',
      items: [
        { id: 'a', sku: 'FG-40F', description: 'FortiGate 40F', fiscalNature: 'LOCACAO_BENS_MOVEIS', ncmOrServiceCode: '', quantity: 2, unitPrice: 780, discountPercent: 0, isRecurring: true, totalMonthly: 1560 },
      ],
    }));
    assert.equal(loc.kind, 'LOCACAO');
    assert.equal(loc.kindLabel, 'Proposta de locação');
    assert.equal(loc.termValue, '36 meses');
    assert.match(loc.monthlyLabel, /4\.490,00/);
    assert.match(loc.periodValue, /161\.640,00/);
    assert.equal(loc.oneTimeRows.find((r) => r.label === 'Frete')?.value.includes('650,00'), true);
    assert.equal(loc.conditions.find((c) => c.label === 'Início previsto')?.value, 'não definido');
    assert.equal(loc.internalNotes, 'nota interna da locação');
    assert.match(loc.lines[0].unitLabel, /780,00/);
    assert.match(loc.lines[0].lineLabel, /1\.560,00/);

    const svc = toInternalProposalSummary(baseProposal({
      id: 'prop-goldenland-suporte-20261106',
      code: '4713',
      budgetType: 'SERVICOS',
      modality: 'SERVICE',
      serviceType: 'Suporte N1/N2',
      slaTier: 'SEM_SLA_ESPECIFICO',
      readjustmentIndex: 'IPCA',
      monthlyRecurringTotal: 1100,
      shippingCost: 0,
      setupFee: 0,
      items: [
        { id: 's', sku: '', description: 'Suporte técnico remoto N1/N2', fiscalNature: 'SERVICO_TECNICO_TI_TELECOM', ncmOrServiceCode: '', quantity: 1, unitPrice: 1100, discountPercent: 0, isRecurring: true, totalMonthly: 1100 },
      ],
    }));
    assert.equal(svc.kind, 'SERVICO');
    assert.equal(svc.scopeLabel, 'Suporte N1/N2');
    assert.match(svc.periodValue, /39\.600,00/);
    assert.equal(svc.oneTimeRows.length, 0);
    assert.equal(svc.conditions.find((c) => c.label === 'SLA')?.value, 'não definido');

    const sale = toInternalProposalSummary(baseProposal({
      budgetType: 'PRODUTOS',
      contractMonths: 1,
      monthlyRecurringTotal: 0,
      totalContractValue: 2005,
      shippingCost: 50,
      items: [
        { id: 'p', sku: 'A400', description: 'SSD', fiscalNature: 'VENDA_EQUIPAMENTO', ncmOrServiceCode: '', quantity: 2, unitPrice: 977.5, discountPercent: 0, isRecurring: false, totalMonthly: 1955, subtotal: 1955 },
      ],
    }));
    assert.equal(sale.kind, 'PRODUTOS');
    assert.equal(sale.kindLabel, 'Proposta de venda');
    assert.match(sale.periodValue, /2\.005,00/);

    assert.equal(resolveInternalProposalKind({ budgetType: 'SERVICOS', serviceType: 'Spare Parts / Hard Parts' }), 'SPARE_PARTS');
    const spare = toInternalProposalSummary(baseProposal({
      budgetType: 'SERVICOS',
      serviceType: 'Spare Parts / Hard Parts',
      readjustmentIndex: undefined,
      monthlyRecurringTotal: 200,
      items: [
        { id: 'sp', sku: 'FAN', description: 'Ventoinha', fiscalNature: 'SERVICO_TECNICO_TI_TELECOM', ncmOrServiceCode: '', quantity: 1, unitPrice: 200, discountPercent: 0, isRecurring: true, totalMonthly: 200 },
      ],
    }));
    assert.equal(spare.kindLabel, 'Proposta de spare parts');
    assert.equal(spare.conditions.find((c) => c.label === 'SLA de reposição')?.value, 'não definido');
    assert.equal(spare.conditions.find((c) => c.label === 'Índice de reajuste')?.value, 'não definido');
  });

  it('a URL não muda quando a versão comercial muda', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const created = repo.createProposal({
      title: 'Locação estável',
      companyName: 'Via Itália',
      companyCnpj: '07.638.845/0001-56',
      budgetType: 'LOCACAO',
      contractMonths: 36,
      monthlyRecurringTotal: 4490,
      shippingCost: 650,
      internalNotes: 'antes',
      items: [],
    } as unknown as { title: string });
    const first = await router.dispatch({
      method: 'GET',
      path: `/api/interno/proposta/${created.id}`,
      query: { ...HTTP, _sessionToken: adminToken() },
    });
    assert.equal(first.status, 200);
    const before = (first.body as { data: { stableUrl: string; stablePath: string; versionLabel: string } }).data;
    repo.updateProposal(created.id, { title: 'Locação corrigida', internalNotes: 'depois', monthlyRecurringTotal: 4500 });
    const second = await router.dispatch({
      method: 'GET',
      path: `/api/interno/proposta/${created.id}`,
      query: { ...HTTP, _sessionToken: adminToken() },
    });
    const after = (second.body as { data: { stableUrl: string; stablePath: string; versionLabel: string; title: string; internalNotes: string } }).data;
    assert.equal(after.stablePath, before.stablePath);
    assert.equal(after.stableUrl, before.stableUrl);
    assert.equal(after.stableUrl, buildStableInternalProposalUrl(created.id, 'https://sti-hub.vercel.app'));
    assert.doesNotMatch(after.stableUrl, /[?&#]t=|version=/);
    assert.notEqual(after.versionLabel, before.versionLabel);
    assert.equal(after.title, 'Locação corrigida');
    assert.equal(after.internalNotes, 'depois');
  });
});

describe('Link interno no modo tabela (erp_proposals)', () => {
  function stored(over: Record<string, unknown>) {
    return {
      id: String(over.id),
      code: String(over.code || ''),
      title: String(over.title || 'Proposta'),
      companyId: null,
      companyName: 'Cliente',
      companyCnpj: '07.638.845/0001-56',
      contactId: null,
      contactName: '',
      dealId: null,
      sellerName: 'Marcelo Lopes Mira',
      status: 'ENVIADA',
      budgetType: over.budgetType,
      contractMonths: 36,
      paymentCondition: 'Mensalidade via boleto',
      validUntil: '2026-11-13',
      items: [],
      monthlyRecurringTotal: 100,
      oneTimeSetupTotal: 0,
      totalContractValue: 3600,
      commercialNotes: '',
      technicalClauses: '',
      internalNotes: 'nota da tabela',
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
      version: 1,
      ...over,
    };
  }

  function table(rows: Array<ReturnType<typeof stored> & { code_num?: number | null }>): PgQ {
    return {
      async query(_sql: string, params?: unknown[]) {
        const lowers = ((params?.[0] as string[]) || []).map((v) => String(v).toLowerCase());
        const nums = (params?.[1] as number[]) || [];
        const hit = rows.filter((r) => {
          const codeNum = r.code_num ?? null;
          return (
            lowers.includes(String(r.id).toLowerCase()) ||
            (r.code && lowers.includes(String(r.code).toLowerCase())) ||
            (codeNum !== null && nums.includes(codeNum))
          );
        });
        return { rows: hit.map((r) => ({ data: r, row_version: 1 })) };
      },
    };
  }

  /** Hidratação antiga: só /api/erp/proposals. A rota interna ficava de fora e a memória vazia virava 404. */
  function legacyHydrationRefs(cleanPath: string): string[] {
    const m = cleanPath.match(/^\/api\/erp\/proposals\/([^/]+)(?:\/[^/]+)?$/);
    return m ? [m[1]] : [];
  }

  it('sem carregar a tabela, o link interno não acha a proposta; com a rota, acha hub, GC, locação, serviço e produtos', async () => {
    const rows = [
      stored({ id: 'prop-sti-loc', code: '4801', code_num: 4801, budgetType: 'LOCACAO', title: 'Locação criada no STI-hub' }),
      stored({ id: 'prop-gc-9001', code: '4711', code_num: 4711, budgetType: 'LOCACAO', title: 'Locação importada do GestãoClick' }),
      stored({ id: 'prop-gc-9002', code: '4713', code_num: 4713, budgetType: 'SERVICOS', serviceType: 'Suporte N1/N2', title: 'Serviço importado do GestãoClick' }),
      stored({ id: 'prop-sti-prod', code: '4714', code_num: 4714, budgetType: 'PRODUTOS', title: 'Venda criada no STI-hub' }),
    ];
    const db = table(rows);
    for (const id of ['prop-sti-loc', 'prop-gc-9001', 'prop-gc-9002', 'prop-sti-prod']) {
      const path = `/api/interno/proposta/${id}`;
      assert.deepEqual(legacyHydrationRefs(path), [], id);
      assert.equal((await getProposalsByRefs(db, legacyHydrationRefs(path))).length, 0, id);
      const refs = proposalRouteLookupRefs('GET', path);
      assert.deepEqual(refs, [id], id);
      const found = await getProposalsByRefs(db, refs);
      assert.equal(found.length, 1, id);
      assert.equal(found[0].proposal.id, id);
      assert.equal(found[0].proposal.internalNotes, 'nota da tabela');
    }
    const kinds = ['LOCACAO', 'LOCACAO', 'SERVICO', 'PRODUTOS'];
    for (let i = 0; i < rows.length; i++) {
      assert.equal(toInternalProposalSummary(rows[i] as unknown as ErpCommercialProposal).kind, kinds[i]);
    }
    const byHash = await getProposalsByRefs(db, proposalRouteLookupRefs('GET', '/api/interno/proposta/%234711'));
    assert.equal(byHash[0]?.proposal.id, 'prop-gc-9001');
    const byGc = await getProposalsByRefs(db, proposalRouteLookupRefs('GET', '/api/interno/proposta/GC-ORC-4713'));
    assert.equal(byGc[0]?.proposal.id, 'prop-gc-9002');
    assert.deepEqual(proposalRouteLookupRefs('GET', '/api/erp/proposals/prop-gc-9001'), ['prop-gc-9001']);
    assert.match(src('src/app/interno/proposta/[id]/page.tsx'), /Proposta comercial não encontrada\./);
    assert.match(src('src/app/interno/proposta/[id]/page.tsx'), /Voltar ao STI-hub/);
  });
});

describe('Visão interna: sem observações e com PDF', () => {
  it('o bloco some da tela e do PDF, os botões existem e o arquivo segue Proposta-<código>-<Cliente>.pdf', () => {
    const view = src('src/app/components/InternalProposalSummaryView.tsx');
    assert.doesNotMatch(view, /Observações internas/);
    assert.doesNotMatch(view, /internal-proposal-notes/);
    assert.match(view, /data-testid="internal-proposal-print"/);
    assert.match(view, /data-testid="internal-proposal-download-pdf"/);
    assert.match(view, />\s*Imprimir\s*</);
    assert.match(view, />\s*Baixar PDF\s*</);
    assert.match(view, /bg-\[#1e3a6e\]/);
    assert.equal(internalProposalPdfFileName('4711', 'Via Itália'), 'Proposta-4711-ViaItalia.pdf');
    assert.equal(internalProposalPdfFileName('#4711', 'Via Itália'), 'Proposta-4711-ViaItalia.pdf');
    assert.equal(internalProposalPdfFileName('4713', 'GOLDEN LAND LTDA'), 'Proposta-4713-GOLDENLANDLTDA.pdf');

    const model = toInternalProposalSummary(baseProposal({
      id: 'prop-via-italia-loc-20261106',
      code: '4711',
      budgetType: 'LOCACAO',
      companyName: 'Via Itália',
      companyCnpj: '07.638.845/0001-56',
      monthlyRecurringTotal: 4490,
      contractMonths: 36,
      shippingCost: 650,
      setupFee: 0,
      internalNotes: 'Empresa não encontrada no cadastro. Observações internas secretas.',
      items: [
        { id: 'a', sku: 'FG-40F', description: 'FortiGate 40F', fiscalNature: 'LOCACAO_BENS_MOVEIS', ncmOrServiceCode: '', quantity: 2, unitPrice: 780, discountPercent: 0, isRecurring: true, totalMonthly: 1560 },
      ],
    }), { origin: 'https://sti-hub.vercel.app' });
    assert.equal(internalProposalPdfFileName(model.codeLabel, model.companyName), 'Proposta-4711-ViaItalia.pdf');
    const html = buildInternalProposalPrintHtml(model);
    assert.doesNotMatch(html, /Observações internas/);
    assert.doesNotMatch(html, /Empresa não encontrada/);
    assert.match(html, /4711/);
    assert.match(html, /Via Itália/);
    const pdf = Buffer.from(buildInternalProposalPdf(model)).toString('latin1');
    assert.match(pdf, /^%PDF-1\.4/);
    assert.doesNotMatch(pdf, /Observações internas/);
    assert.doesNotMatch(pdf, /Empresa não encontrada/);
    assert.match(pdf, /4711/);
    assert.match(pdf, /Via Itália/);
  });
});

describe('Link interno: botão ao lado de Copiar link do cliente', () => {
  it('a barra da proposta copia a URL estável e não mexe no link assinado do cliente', async () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const clientAt = page.indexOf('data-testid="copy-client-link"');
    const internalAt = page.indexOf('data-testid="copy-internal-link"');
    assert.ok(clientAt > 0 && internalAt > clientAt);
    assert.match(page.slice(internalAt, internalAt + 700), /Copiar link interno/);
    assert.match(page.slice(internalAt, internalAt + 700), /copyInternalProposalLink\(proposal\.id\)/);
    assert.match(page, /handleCopyPublicLink/);
    assert.match(page, /onClick=\{handleCopyPublicLink\}/);
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /data-testid="menu-copy-internal-link"[\s\S]{0,800}Copiar link interno/);
    const url = buildStableInternalProposalUrl('prop-via-italia-loc-20261106', 'https://sti-hub.vercel.app');
    assert.equal(url, 'https://sti-hub.vercel.app/interno/proposta/prop-via-italia-loc-20261106');
    const copied = await copyInternalProposalLink('prop-via-italia-loc-20261106');
    assert.equal(copied, url);
    assert.match(src('src/app/interno/proposta/[id]/page.tsx'), /InternalProposalSummaryView/);
  });
});
