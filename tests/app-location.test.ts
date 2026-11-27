// ============================================================================
// Persistência da rota da SPA na URL (reload / F5)
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSyncAppLocation,
  hasReservedFlowParams,
  locationFromNav,
  mergeAppLocationHref,
  mergeAppLocationSearch,
  parseAppLocation,
  appliedNavFromLocation,
} from '../src/app/lib/app-location';
import { parseHomeDeepLink, resolveInitialHomeScreen } from '../src/app/lib/home-screen';

const ALL = { crm: true, erp: true, chamados: true };

describe('app-location — orçamentos e F5', () => {
  it('grava ?tela=ERP_PROPOSALS e os filtros principais da lista', () => {
    const route = locationFromNav({
      module: 'ERP_GESTAOCLICK',
      erpSection: 'ORCAMENTOS',
      erpSubId: 'ORC_LOCACAO',
      q: 'EVAMIND',
      status: 'ENVIADA',
    });
    assert.deepEqual(route, {
      tela: 'ERP_PROPOSALS',
      sub: 'ORC_LOCACAO',
      q: 'EVAMIND',
      status: 'ENVIADA',
    });
    const search = mergeAppLocationSearch('', route);
    assert.equal(search, '?tela=ERP_PROPOSALS&sub=ORC_LOCACAO&q=EVAMIND&status=ENVIADA');
    assert.deepEqual(parseAppLocation(search), route);
    assert.deepEqual(appliedNavFromLocation(route!), {
      kind: 'erp',
      section: 'ORCAMENTOS',
      subId: 'ORC_LOCACAO',
    });
  });

  it('no reload, ?tela=ERP_PROPOSALS tem prioridade sobre a tela inicial (dashboard)', () => {
    const search = mergeAppLocationSearch('', locationFromNav({
      module: 'ERP_GESTAOCLICK',
      erpSection: 'ORCAMENTOS',
      erpSubId: 'ORC_TODOS',
    }));
    const r = resolveInitialHomeScreen({
      saved: 'CRM_OVERVIEW',
      access: ALL,
      deepLink: parseHomeDeepLink(search),
    });
    assert.deepEqual(r, { screenId: 'ERP_PROPOSALS', source: 'DEEP_LINK' });
  });

  it('omite sub e status padrão para manter a URL curta', () => {
    const route = locationFromNav({
      module: 'ERP_GESTAOCLICK',
      erpSection: 'ORCAMENTOS',
      erpSubId: 'ORC_TODOS',
      status: 'TODOS',
    });
    assert.deepEqual(route, { tela: 'ERP_PROPOSALS' });
    assert.equal(mergeAppLocationSearch('', route), '?tela=ERP_PROPOSALS');
  });

  it('ao sair de orçamentos, os filtros da lista não vão para outra seção', () => {
    const route = locationFromNav({
      module: 'ERP_GESTAOCLICK',
      erpSection: 'INICIO',
      erpSubId: 'INICIO',
      q: 'EVAMIND',
      status: 'ENVIADA',
    });
    assert.deepEqual(route, { tela: 'ERP_OVERVIEW' });
  });

  it('preserva parâmetros do fluxo de validade / envio e não mistura filtros', () => {
    const current = '?tela=ERP_PROPOSALS&acao=atualizar-validade&proposta=prop-1&foco=validade&voltar=proposta:prop-1';
    assert.equal(hasReservedFlowParams(current), true);
    const next = mergeAppLocationSearch(current, {
      tela: 'ERP_PROPOSALS',
      q: 'não-deve-entrar',
      status: 'ENVIADA',
      sub: 'ORC_LOCACAO',
    });
    const params = new URLSearchParams(next.replace(/^\?/, ''));
    assert.equal(params.get('tela'), 'ERP_PROPOSALS');
    assert.equal(params.get('acao'), 'atualizar-validade');
    assert.equal(params.get('proposta'), 'prop-1');
    assert.equal(params.get('foco'), 'validade');
    assert.equal(params.get('voltar'), 'proposta:prop-1');
    assert.equal(params.get('q'), null);
    assert.equal(params.get('status'), null);
    assert.equal(params.get('sub'), null);
  });

  it('preserva ?deal= ao sincronizar a tela do CRM', () => {
    const next = mergeAppLocationSearch('?deal=deal-123', { tela: 'CRM_DEALS' });
    assert.equal(next, '?deal=deal-123&tela=CRM_DEALS');
  });

  it('não altera URLs que não são a home da SPA', () => {
    const href = mergeAppLocationHref('https://sti-hub.local/login?next=%2F', { tela: 'ERP_PROPOSALS' });
    assert.equal(href, '/login?next=%2F');
    assert.equal(canSyncAppLocation('/login'), false);
    assert.equal(canSyncAppLocation('/'), true);
  });

  it('reconhece seções ERP que não são tela inicial, e outras rotas do app', () => {
    assert.deepEqual(
      appliedNavFromLocation({ tela: 'ERP_CADASTROS', sub: 'CAD_FORNECEDORES' }),
      { kind: 'erp', section: 'CADASTROS', subId: 'CAD_FORNECEDORES' }
    );
    assert.deepEqual(appliedNavFromLocation({ tela: 'CRM_COMPANIES' }), {
      kind: 'crm',
      module: 'CONTACTS_COMPANIES',
      contactsSub: 'COMPANIES',
    });
    assert.deepEqual(appliedNavFromLocation({ tela: 'SETTINGS', sub: 'account-users' }), {
      kind: 'settings',
      itemId: 'account-users',
    });
    assert.equal(parseAppLocation('?tela=TELA_INEXISTENTE'), null);
  });

  it('a ida e a volta da rota de contratos com busca se equivalem', () => {
    const built = locationFromNav({
      module: 'ERP_GESTAOCLICK',
      erpSection: 'CONTRATOS',
      erpSubId: 'CTR_SERVICOS',
      q: 'SETA',
    });
    const parsed = parseAppLocation(mergeAppLocationSearch('', built));
    assert.deepEqual(parsed, built);
    assert.deepEqual(appliedNavFromLocation(parsed!), {
      kind: 'erp',
      section: 'CONTRATOS',
      subId: 'CTR_SERVICOS',
    });
  });
});
