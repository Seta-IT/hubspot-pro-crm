// ============================================================================
// Ordens de servico (12/11): cliente por combobox, Duplicar O.S. (uso mensal),
// troca de situacao com historico e Painel (kanban) movendo o card de coluna.
// Tudo local (repositorio em memoria), sem rede e sem banco.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import type { Company, ErpServiceOrder } from '../src/db/types';
import {
  SERVICE_ORDER_STATUSES,
  applyServiceOrderStatusChange,
  duplicateServiceOrder,
  groupServiceOrdersByColumn,
  kanbanColumnForStatus,
  kanbanQuickAction,
  mergeServiceOrderOverrides,
  nextServiceOrderCode,
  normalizeServiceOrderStatus,
  serviceOrderStatusOptions,
  suggestNextMeasurementPeriod,
  validateDuplicateServiceOrderInput,
} from '../src/modules/erp/service-order-workflow';
import { filterCompaniesForPicker, serviceOrderCustomerFields } from '../src/app/lib/company-search';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function os(partial: Partial<ErpServiceOrder> = {}): ErpServiceOrder {
  return {
    id: 'os-t-1',
    code: '1600',
    companyName: 'ACME LTDA',
    sellerName: 'Marcelo Mira',
    technicianName: 'Wesley Brito',
    entryDate: '01/10/2026',
    exitDate: '',
    status: 'Em andamento',
    totalAmount: 1250.5,
    description: 'Locação mensal de PABX',
    technicalReport: 'OK',
    ...partial,
  };
}

function company(id: string, name: string, cnpj: string | null, trade = ''): Company {
  return {
    id, name, cnpj, domain: null, industry: null, size: null, annualRevenue: null, city: 'São Paulo', state: 'SP',
    country: 'BR', completenessScore: 0, enrichedAt: null, enrichmentSource: null,
    customProperties: trade ? { tradeName: trade } : {}, lastActivityAt: null, createdAt: '', updatedAt: '',
  };
}

const call = (router: CrmApiRouter, method: string, path: string, body: unknown = {}) =>
  router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method, path, body: body as Record<string, unknown> });

function seedRepoWith(order: ErpServiceOrder) {
  const repo = createInMemoryRepository();
  const erp = repo.getErpState() as unknown as { serviceOrders: ErpServiceOrder[] };
  erp.serviceOrders = [order, ...(erp.serviceOrders || []).filter((o) => o.id !== order.id)];
  return repo;
}

describe('OS: situacao e historico', () => {
  it('normaliza situacoes legadas e mantem as desconhecidas nas opcoes', () => {
    assert.equal(normalizeServiceOrderStatus('Aberta'), 'Em aberto');
    assert.equal(normalizeServiceOrderStatus('ABERTA'), 'Em aberto');
    assert.equal(normalizeServiceOrderStatus('concluida'), 'Concluída');
    assert.equal(normalizeServiceOrderStatus('Aguardando aprovação'), 'Aguardando aprovação');
    const opts = serviceOrderStatusOptions([{ status: 'Aguardando aprovação' }, { status: 'Aberta' }]);
    assert.deepEqual(opts.slice(0, 5), [...SERVICE_ORDER_STATUSES]);
    assert.ok(opts.includes('Aguardando aprovação'));
    assert.ok(!opts.includes('Aberta'));
  });

  it('sai de Em andamento, registra de/para/quem e preenche a saida ao concluir', () => {
    const at = '2026-11-12T15:00:00.000Z';
    const r = applyServiceOrderStatusChange(os(), 'Concluída', { by: 'Marcéllo', at });
    assert.equal(r.changed, true);
    assert.equal(r.order.status, 'Concluída');
    assert.equal(r.order.statusHistory?.length, 1);
    assert.deepEqual(
      { from: r.order.statusHistory![0].from, to: r.order.statusHistory![0].to, by: r.order.statusHistory![0].by },
      { from: 'Em andamento', to: 'Concluída', by: 'Marcéllo' }
    );
    assert.match(r.order.exitDate, /^\d{2}\/\d{2}\/2026$/);
    const same = applyServiceOrderStatusChange(r.order, 'Concluída', { by: 'x' });
    assert.equal(same.changed, false);
  });

  it('POST /api/erp/service-orders/:id/status persiste e grava o historico no servidor', async () => {
    const repo = seedRepoWith(os());
    const router = new CrmApiRouter(repo);
    let r = await call(router, 'POST', '/api/erp/service-orders/os-t-1/status', { status: 'Cancelada' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const saved = repo.getServiceOrderByRef('os-t-1')!;
    assert.equal(saved.status, 'Cancelada');
    assert.equal(saved.statusHistory?.length, 1);
    assert.equal(saved.statusHistory![0].from, 'Em andamento');
    r = await call(router, 'POST', '/api/erp/service-orders/os-t-1/status', { status: 'Em aberto' });
    assert.equal(r.status, 200);
    assert.equal(repo.getServiceOrderByRef('1600')!.statusHistory?.length, 2);
    r = await call(router, 'POST', '/api/erp/service-orders/nao-existe/status', { status: 'Concluída' });
    assert.equal(r.status, 404);
    r = await call(router, 'POST', '/api/erp/service-orders/os-t-1/status', { status: '' });
    assert.equal(r.status, 400);
  });

  it('salvar pelo editor registra a troca de situacao e ignora historico vindo do cliente', async () => {
    const repo = seedRepoWith(os());
    const router = new CrmApiRouter(repo);
    const forged = [{ id: 'x', at: '2020-01-01T00:00:00Z', by: 'forjado', from: 'a', to: 'b' }];
    const r = await call(router, 'POST', '/api/erp/service-orders', { ...os(), status: 'Aguardando peça', statusHistory: forged });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const saved = repo.getServiceOrderByRef('os-t-1')!;
    assert.equal(saved.status, 'Aguardando peça');
    assert.equal(saved.statusHistory?.length, 1);
    assert.notEqual(saved.statusHistory![0].by, 'forjado');
    // A rota generica de registros tambem preserva o historico do servidor.
    await call(router, 'POST', '/api/erp/records/serviceOrders', { ...saved, statusHistory: [], status: 'Concluída' });
    const after = repo.getServiceOrderByRef('os-t-1')!;
    assert.equal(after.statusHistory?.length, 2);
    assert.equal(after.statusHistory![1].to, 'Concluída');
  });

  it('Nova O.S. sem cliente e recusada', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const r = await call(router, 'POST', '/api/erp/service-orders', { ...os({ id: 'os-nova' }), companyName: '  ' });
    assert.equal(r.status, 400);
  });
});

describe('OS: Duplicar (uso mensal)', () => {
  it('copia tudo, numero novo, situacao inicial, sem historicos e com data/periodo novos', () => {
    const src0 = os({
      status: 'Concluída',
      exitDate: '31/10/2026',
      companyId: 'cmp-1',
      companyCnpj: '14.806.925/0001-32',
      measurementPeriodStart: '01/10/2026',
      measurementPeriodEnd: '31/10/2026',
      statusHistory: [{ id: 'h1', at: '2026-10-31T10:00:00Z', by: 'a', from: 'Em andamento', to: 'Concluída' }],
      documentHistory: [{ id: 'd1' }],
      items: [{ sku: 'PABX', qty: 2, unit: 300 }],
      services: [{ code: 'SRV-1', value: 650.5 }],
    } as unknown as Partial<ErpServiceOrder>);
    const dup = duplicateServiceOrder(src0, {
      id: 'os-dup', code: '1601', by: 'Marcéllo', entryDate: '01/11/2026',
      measurementPeriodStart: '01/11/2026', measurementPeriodEnd: '30/11/2026',
    }) as ErpServiceOrder & Record<string, unknown>;
    assert.equal(dup.id, 'os-dup');
    assert.equal(dup.code, '1601');
    assert.equal(dup.status, 'Em aberto');
    assert.equal(dup.entryDate, '01/11/2026');
    assert.equal(dup.exitDate, '');
    assert.equal(dup.measurementPeriodStart, '01/11/2026');
    assert.equal(dup.measurementPeriodEnd, '30/11/2026');
    assert.equal(dup.companyName, 'ACME LTDA');
    assert.equal(dup.companyCnpj, '14.806.925/0001-32');
    assert.equal(dup.totalAmount, 1250.5);
    assert.equal(dup.description, 'Locação mensal de PABX');
    assert.deepEqual(dup.items, [{ sku: 'PABX', qty: 2, unit: 300 }]);
    assert.deepEqual(dup.services, [{ code: 'SRV-1', value: 650.5 }]);
    assert.equal(dup.documentHistory, undefined);
    assert.equal(dup.statusHistory?.length, 1);
    assert.match(String(dup.statusHistory![0].note), /duplica/i);
    assert.equal(dup.duplicatedFromCode, '1600');
    // A origem nao muda (copia profunda).
    (dup.items as Array<{ qty: number }>)[0].qty = 99;
    assert.equal((src0 as unknown as { items: Array<{ qty: number }> }).items[0].qty, 2);
  });

  it('valida data de emissao e periodo e sugere o proximo mes', () => {
    assert.match(String(validateDuplicateServiceOrderInput({ entryDate: '' })), /emissão/);
    assert.match(String(validateDuplicateServiceOrderInput({ entryDate: '01/11/2026', measurementPeriodStart: '01/11/2026' })), /início e o fim/);
    assert.match(String(validateDuplicateServiceOrderInput({ entryDate: '01/11/2026', measurementPeriodStart: '30/11/2026', measurementPeriodEnd: '01/11/2026' })), /depois do fim/);
    assert.equal(validateDuplicateServiceOrderInput({ entryDate: '01/11/2026', measurementPeriodStart: '01/11/2026', measurementPeriodEnd: '30/11/2026' }), null);
    assert.deepEqual(suggestNextMeasurementPeriod({ measurementPeriodStart: '01/01/2026', measurementPeriodEnd: '31/01/2026' }), { start: '01/02/2026', end: '28/02/2026' });
    assert.deepEqual(suggestNextMeasurementPeriod({ measurementPeriodStart: '15/10/2026', measurementPeriodEnd: '14/11/2026' }), { start: '15/11/2026', end: '14/12/2026' });
    assert.deepEqual(suggestNextMeasurementPeriod({}, new Date(2026, 10, 12)), { start: '01/11/2026', end: '30/11/2026' });
    assert.equal(nextServiceOrderCode([{ code: '1600' }, { code: 'OS-1702' }, { code: 'abc' }]), '1703');
    assert.equal(nextServiceOrderCode([]), '1519');
  });

  it('POST /api/erp/service-orders/:id/duplicate cria a nova OS no servidor', async () => {
    const repo = seedRepoWith(os({ statusHistory: [{ id: 'h', at: '2026-10-01T00:00:00Z', by: 'a', from: '', to: 'Em andamento' }] }));
    const router = new CrmApiRouter(repo);
    const before = (repo.getErpState() as unknown as { serviceOrders: ErpServiceOrder[] }).serviceOrders.length;
    const r = await call(router, 'POST', '/api/erp/service-orders/os-t-1/duplicate', {
      entryDate: '01/12/2026', measurementPeriodStart: '01/12/2026', measurementPeriodEnd: '31/12/2026',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const created = (r.body as { data: ErpServiceOrder }).data;
    const list = (repo.getErpState() as unknown as { serviceOrders: ErpServiceOrder[] }).serviceOrders;
    assert.equal(list.length, before + 1);
    assert.notEqual(created.id, 'os-t-1');
    assert.ok(Number(created.code) > 1600);
    assert.equal(created.status, 'Em aberto');
    assert.equal(created.entryDate, '01/12/2026');
    assert.equal(created.statusHistory?.length, 1);
    assert.equal(repo.getServiceOrderByRef('os-t-1')!.status, 'Em andamento');
    const bad = await call(router, 'POST', '/api/erp/service-orders/os-t-1/duplicate', { entryDate: '' });
    assert.equal(bad.status, 400);
  });
});

describe('OS: Painel (kanban)', () => {
  it('cada situacao tem coluna; concluir move o card para Concluida', () => {
    const list = [os({ id: 'a', status: 'Aberta' }), os({ id: 'b', status: 'Em andamento' }), os({ id: 'c', status: 'Situação GC' })];
    let cols = groupServiceOrdersByColumn(list);
    assert.deepEqual(Object.keys(cols), [...SERVICE_ORDER_STATUSES]);
    assert.deepEqual(cols['Em aberto'].map((o) => o.id), ['a', 'c']);
    assert.deepEqual(cols['Em andamento'].map((o) => o.id), ['b']);
    const quick = kanbanQuickAction('Em andamento')!;
    assert.deepEqual(quick, { label: 'Concluir', nextStatus: 'Concluída' });
    const moved = applyServiceOrderStatusChange(list[1], quick.nextStatus, { by: 't' }).order;
    // Estado local: a gravacao recente vale ate o servidor devolver a mesma situacao.
    const view = mergeServiceOrderOverrides(list, { [moved.id]: moved });
    cols = groupServiceOrdersByColumn(view);
    assert.deepEqual(cols['Em andamento'].map((o) => o.id), []);
    assert.deepEqual(cols['Concluída'].map((o) => o.id), ['b']);
    assert.equal(kanbanColumnForStatus('Cancelada'), 'Cancelada');
    assert.equal(kanbanQuickAction('Concluída'), null);
    // Servidor atualizado => volta a valer a versao do servidor.
    const fresh = list.map((o) => (o.id === 'b' ? { ...moved } : o));
    assert.equal(mergeServiceOrderOverrides(fresh, { b: moved }).find((o) => o.id === 'b'), fresh[1]);
    // OS nova (duplicada) ainda nao recarregada aparece no topo.
    const extra = os({ id: 'novo', status: 'Em aberto' });
    assert.equal(mergeServiceOrderOverrides(list, { novo: extra })[0].id, 'novo');
  });

  it('a tela usa a rota de situacao, confere a resposta e tem arrastar entre colunas', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(tab, /\/api\/erp\/service-orders\/\$\{encodeURIComponent\(os\.id\)\}\/status/);
    assert.match(tab, /if \(!res \|\| !res\.ok \|\| !json\?\.data\)/);
    assert.match(tab, /setOsOverrides\(\(prev\) => \(\{ \.\.\.prev, \[saved\.id\]: saved \}\)\)/);
    assert.match(tab, /onDrop=\{/);
    assert.match(tab, /draggable/);
    assert.match(tab, /data-testid=\{`os-row-status-\$\{os\.code\}`\}/);
    assert.match(tab, /data-testid=\{`os-row-duplicar-\$\{os\.code\}`\}/);
    assert.doesNotMatch(tab, /code: String\(1519 \+ serviceOrders\.length\)/);
  });
});

describe('OS: cliente por combobox (mesmo padrao do campo de produtos)', () => {
  const companies = [
    company('c1', 'SETA TELECOM LTDA', '14.806.925/0001-32', 'Seta'),
    company('c2', 'GOLDEN LAND COMERCIO', '11.222.333/0001-81'),
    company('c3', 'Ótica São João', null),
  ];
  it('busca por nome (sem acento), fantasia e CNPJ sem pontuacao', () => {
    assert.deepEqual(filterCompaniesForPicker(companies, 'golden').map((c) => c.id), ['c2']);
    assert.deepEqual(filterCompaniesForPicker(companies, 'otica sao').map((c) => c.id), ['c3']);
    assert.deepEqual(filterCompaniesForPicker(companies, 'seta').map((c) => c.id), ['c1']);
    assert.deepEqual(filterCompaniesForPicker(companies, '14806925').map((c) => c.id), ['c1']);
    assert.equal(filterCompaniesForPicker(companies, '').length, 3);
    assert.deepEqual(serviceOrderCustomerFields(companies[0]), { companyId: 'c1', companyName: 'SETA TELECOM LTDA', companyCnpj: '14.806.925/0001-32' });
  });
  it('o editor de OS usa o combobox de clientes no padrao do CatalogItemPicker', () => {
    const picker = src('src/app/components/CompanyComboboxPicker.tsx');
    const modal = src('src/app/components/ServiceOrderModals.tsx');
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(picker, /CATALOG_GRID_INPUT/);
    assert.match(picker, /role="combobox"/);
    assert.match(modal, /<CompanyComboboxPicker/);
    assert.match(tab, /companies=\{companies\}/);
    for (const f of ['src/app/components/CompanyComboboxPicker.tsx', 'src/app/components/ServiceOrderModals.tsx', 'src/modules/erp/service-order-workflow.ts', 'src/app/lib/company-search.ts']) {
      assert.doesNotMatch(src(f), /\p{Extended_Pictographic}/u, `${f} sem emojis`);
    }
  });
});
