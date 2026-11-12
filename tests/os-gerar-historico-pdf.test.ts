// OS: PDF A4, historico, link de acesso e anexo no e-mail ao cliente.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { CrmApiRouter } from '../src/api/router';
import { DEFAULT_COMPANY_EMITTER_SETTINGS } from '../src/modules/erp/daily-sync-service';
import {
  appendServiceOrderDocumentEntry,
  buildServiceOrderDocumentModel,
  buildServiceOrderPdf,
  serviceOrderInternalPath,
  serviceOrderIssuerFromEmitter,
  serviceOrderPdfFileName,
  SERVICE_ORDER_HISTORY_MAX,
} from '../src/modules/erp/service-order-document';
import type { ErpServiceOrder, ServiceTicket } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HTTP = { _fromHttpBridge: '1', _origin: 'https://sti-hub.vercel.app' };

function token(modules: { crm: boolean; erp: boolean; chamados: boolean }): string {
  return signStiHubSessionToken({
    uid: 'usr-seta-01',
    email: 'marcelo.mira@setatelecom.com.br',
    name: 'Marcelo Lopes Mira',
    roleId: 'SUPER_ADMIN',
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'].filter((m) => (modules as Record<string, boolean>)[m.toLowerCase()]) as Array<'CRM' | 'ERP' | 'CHAMADOS'>,
    moduleAccess: modules,
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
  });
}

const OS: ErpServiceOrder = {
  id: 'os-teste-9001',
  code: '9001',
  companyName: 'Cliente Teste OS',
  sellerName: 'Marcelo Mira',
  technicianName: 'Wesley Brito',
  entryDate: '10/11/2026',
  exitDate: '—',
  status: 'Em andamento',
  totalAmount: 0,
  description: 'Switch reiniciando',
  equipmentName: 'Catalyst 3850',
  serialNumber: 'FOC123',
};

function ticket(over: Partial<ServiceTicket> = {}): ServiceTicket {
  return {
    id: 'tk-os-1',
    key: 'SD-9001',
    subject: 'Switch reiniciando',
    description: 'Reinicia 3x por dia',
    category: 'SUPPORT',
    priority: 'HIGH',
    status: 'RESOLVED',
    channel: 'EMAIL',
    contactId: null,
    companyId: null,
    dealId: null,
    assignee: 'NOC',
    serviceOrderId: OS.id,
    resolution: 'Fonte trocada e validada com o cliente.',
    slaFirstResponseDueAt: '',
    slaResolutionDueAt: '',
    firstRespondedAt: null,
    resolvedAt: '2026-11-12T13:00:00Z',
    slaStatus: 'ON_TRACK',
    csatScore: null,
    tags: [],
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-12T13:00:00Z',
    comments: [
      { id: 'c1', author: 'Cliente', authorRole: 'CUSTOMER', isInternal: false, body: 'Caiu de novo', createdAt: '2026-11-10T12:05:00Z' },
      { id: 'c2', author: 'Tecnico', authorRole: 'AGENT', isInternal: true, body: 'SEGREDO INTERNO', createdAt: '2026-11-10T12:06:00Z' },
      { id: 'c3', author: 'Tecnico', authorRole: 'AGENT', isInternal: false, body: 'Fonte trocada', createdAt: '2026-11-11T12:06:00Z' },
    ],
    ...over,
  } as ServiceTicket;
}

const issuer = serviceOrderIssuerFromEmitter(DEFAULT_COMPANY_EMITTER_SETTINGS);
const pdfText = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('OS: documento e PDF', () => {
  it('emissor vem do cadastro, notas internas ficam fora, solução e defeito do chamado', () => {
    const m = buildServiceOrderDocumentModel({ serviceOrder: OS, ticket: ticket(), issuer, customerCnpj: '03.241.757/0001-65', origin: 'https://sti-hub.vercel.app' });
    assert.equal(m.issuer.cnpj, '14.806.925/0001-32');
    assert.equal(m.issuer.legalName, 'SETA TELECOM LTDA');
    assert.equal(m.customerCnpj, '03.241.757/0001-65');
    assert.deepEqual(m.interactions.map((i) => i.text), ['Caiu de novo', 'Fonte trocada']);
    assert.equal(m.reportedDefect, 'Reinicia 3x por dia');
    assert.equal(m.validatedSolution, 'Fonte trocada e validada com o cliente.');
    assert.equal(m.accessUrl, 'https://sti-hub.vercel.app/interno/os/os-teste-9001');
    assert.equal(m.exitDate, 'Não informado');
  });

  it('Trava Fiscal: CNPJ do cliente igual ao do emissor não é repetido como do cliente', () => {
    const m = buildServiceOrderDocumentModel({ serviceOrder: OS, issuer, customerCnpj: '14806925000132' });
    assert.equal(m.customerCnpj, 'Não informado');
    assert.equal(m.issuer.cnpj, '14.806.925/0001-32');
  });

  it('PDF A4 válido, sem nota interna, com quebra de página para muitas interações', () => {
    const one = buildServiceOrderPdf(buildServiceOrderDocumentModel({ serviceOrder: OS, ticket: ticket(), issuer }));
    const txt = pdfText(one);
    assert.ok(txt.startsWith('%PDF-1.4'));
    assert.ok(txt.includes('/MediaBox [0 0 595.28 841.89]'));
    assert.ok(txt.includes('/Count 1 '));
    assert.equal(txt.includes('SEGREDO INTERNO'), false);
    assert.ok(txt.includes('ORDEM DE SERVI'));
    assert.ok(txt.includes('14.806.925/0001-32'));
    const many = ticket({
      comments: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, author: 'Tecnico', authorRole: 'AGENT' as const, isInternal: false, body: `Interação ${i} `.repeat(12), createdAt: `2026-11-10T12:${String(i % 60).padStart(2, '0')}:00Z` })),
    });
    const big = pdfText(buildServiceOrderPdf(buildServiceOrderDocumentModel({ serviceOrder: OS, ticket: many, issuer })));
    const count = Number((big.match(/\/Count (\d+)/) || [])[1]);
    assert.ok(count >= 2, `esperava 2+ páginas, veio ${count}`);
    assert.ok(big.includes('%%EOF'));
  });

  it('nome do arquivo, caminho do link e histórico limitado', () => {
    assert.equal(serviceOrderPdfFileName('9001', 'Cliente Teste OS'), 'OS-9001-ClienteTesteOS.pdf');
    assert.equal(serviceOrderInternalPath('os x'), '/interno/os/os%20x');
    let h = undefined as ReturnType<typeof appendServiceOrderDocumentEntry> | undefined;
    for (let i = 0; i < SERVICE_ORDER_HISTORY_MAX + 5; i++) {
      h = appendServiceOrderDocumentEntry(h, { id: `e${i}`, kind: 'GERADA', at: '', by: 'x', fileName: 'f', accessPath: '/p' });
    }
    assert.equal(h!.length, SERVICE_ORDER_HISTORY_MAX);
    assert.equal(h![h!.length - 1].id, `e${SERVICE_ORDER_HISTORY_MAX + 4}`);
  });
});

describe('OS: rotas', () => {
  function setup() {
    const repo = createInMemoryRepository();
    repo.upsertErpCollectionRecord('serviceOrders', OS as unknown as Record<string, unknown>);
    const state = repo as unknown as { state: { serviceTickets?: ServiceTicket[] } };
    state.state.serviceTickets = [ticket(), ...(state.state.serviceTickets || [])];
    return { repo, router: new CrmApiRouter(repo) };
  }

  it('sem login 401; só ERP 403 sem dados', async () => {
    const { router } = setup();
    const anon = await router.dispatch({ method: 'GET', path: `/api/erp/service-orders/${OS.id}/document`, query: { ...HTTP } });
    assert.equal(anon.status, 401);
    assert.equal(JSON.stringify(anon.body).includes('Cliente Teste OS'), false);
    const crmOnly = await router.dispatch({
      method: 'GET',
      path: `/api/erp/service-orders/${OS.id}/document`,
      query: { ...HTTP, _sessionToken: token({ crm: true, erp: false, chamados: false }) },
    });
    assert.notEqual(crmOnly.status, 200);
  });

  it('com ERP sem Chamados: documento sem interações do chamado', async () => {
    const { router } = setup();
    const res = await router.dispatch({
      method: 'GET',
      path: `/api/erp/service-orders/${OS.id}/document`,
      query: { ...HTTP, _sessionToken: token({ crm: true, erp: true, chamados: false }) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = (res.body as { data: { interactions: unknown[]; ticketKey: string } }).data;
    assert.equal(data.interactions.length, 0);
    assert.equal(data.ticketKey, '');
  });

  it('POST pdf gera o PDF e grava no histórico; o histórico não vem do cliente', async () => {
    const { repo, router } = setup();
    const tk = token({ crm: true, erp: true, chamados: true });
    const res = await router.dispatch({ method: 'POST', path: `/api/erp/service-orders/9001/pdf`, query: { ...HTTP, _sessionToken: tk }, body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = res.body as { fileName: string; contentBase64: string; history: Array<{ kind: string; accessPath: string }> };
    assert.equal(body.fileName, 'OS-9001-ClienteTesteOS.pdf');
    const pdf = Buffer.from(body.contentBase64, 'base64').toString('latin1');
    assert.ok(pdf.startsWith('%PDF-'));
    assert.ok(pdf.includes('Fonte trocada'));
    assert.equal(pdf.includes('SEGREDO INTERNO'), false);
    assert.equal(body.history.length, 1);
    assert.equal(body.history[0].kind, 'GERADA');
    assert.equal(body.history[0].accessPath, '/interno/os/os-teste-9001');
    const forged = await router.dispatch({
      method: 'POST',
      path: `/api/erp/records/serviceOrders/${OS.id}`,
      query: { ...HTTP, _sessionToken: tk },
      body: { ...OS, status: 'Concluída', documentHistory: [] },
    });
    assert.equal(forged.status, 200, JSON.stringify(forged.body));
    assert.equal(repo.findServiceOrderByRef(OS.id)?.documentHistory?.length, 1);
    assert.equal(repo.findServiceOrderByRef(OS.id)?.status, 'Concluída');
  });

  it('e-mail com attachServiceOrderId anexa o PDF montado no servidor e registra ENVIADA', async () => {
    const { repo, router } = setup();
    const res = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: { ...HTTP, _sessionToken: token({ crm: true, erp: true, chamados: true }) },
      body: { docType: 'TICKET_REPLY', to: 'cliente@exemplo.com.br', subject: 'OS 9001', body: 'Segue a OS.', attachServiceOrderId: OS.id },
    });
    assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
    const h = repo.findServiceOrderByRef(OS.id)?.documentHistory || [];
    assert.equal(h.length, 1);
    assert.equal(h[0].kind, 'ENVIADA');
    assert.deepEqual(h[0].sentTo?.includes('cliente@exemplo.com.br'), true);
  });

  it('e-mail com OS inexistente: 404 e nada enviado', async () => {
    const { router } = setup();
    const res = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: { ...HTTP, _sessionToken: token({ crm: true, erp: true, chamados: true }) },
      body: { docType: 'TICKET_REPLY', to: 'cliente@exemplo.com.br', subject: 'OS', body: 'x', attachServiceOrderId: 'nao-existe' },
    });
    assert.equal(res.status, 404);
  });
});

describe('OS: telas', () => {
  it('lista de OS tem PDF, Link, E-mail e Histórico; composer tem a opção de anexar a OS', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    for (const id of ['os-pdf', 'os-link', 'os-email', 'os-historico', 'os-historico-linhas']) assert.ok(tab.includes(`data-testid="${id}"`), id);
    const composer = src('src/app/components/ClientEmailComposerModal.tsx');
    assert.ok(composer.includes('data-testid="service-order-attach-option"'));
    assert.ok(composer.includes('attachServiceOrderId'));
    const page = src('src/app/interno/os/[id]/page.tsx');
    assert.ok(page.includes('/api/erp/service-orders/'));
    assert.ok(page.includes('Baixar PDF'));
  });

  it('código de Chamados não foi alterado nesta branch', () => {
    const desk = src('src/app/components/ServiceDeskTab.tsx');
    assert.ok(desk.includes("'Gerar O.S. Técnica (ERP GestãoClick)'"));
  });
});
