// ============================================================================
// STI-hub - Regra de resolucao da tela inicial padrao por usuario
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_SCREEN_STORAGE_KEY,
  getAllowedSystems,
  loadHomeScreenPreference,
  parseHomeDeepLink,
  resolveInitialHomeScreen,
  saveHomeScreenPreference,
  shouldOfferHomeScreenChoice,
} from '../src/app/lib/home-screen';

const ALL = { crm: true, erp: true, chamados: true };
const NO_DEEP_LINK = parseHomeDeepLink('', '');

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    raw: data,
  };
}

describe('Tela inicial padrao - resolucao', () => {
  it('abre a tela padrao salva quando o usuario tem acesso ao sistema', () => {
    const r = resolveInitialHomeScreen({ saved: 'ERP_CONTRACTS', access: ALL, deepLink: NO_DEEP_LINK });
    assert.deepEqual(r, { screenId: 'ERP_CONTRACTS', source: 'SAVED' });
    const r2 = resolveInitialHomeScreen({ saved: 'CHAMADOS_QUEUE', access: ALL });
    assert.deepEqual(r2, { screenId: 'CHAMADOS_QUEUE', source: 'SAVED' });
  });

  it('sem tela salva abre a Visao Geral do primeiro sistema permitido', () => {
    assert.deepEqual(resolveInitialHomeScreen({ saved: null, access: ALL }), {
      screenId: 'CRM_OVERVIEW',
      source: 'FALLBACK',
    });
    assert.deepEqual(resolveInitialHomeScreen({ saved: null, access: { crm: false, erp: true, chamados: true } }), {
      screenId: 'ERP_OVERVIEW',
      source: 'FALLBACK',
    });
  });

  it('tela salva de sistema sem acesso cai no primeiro sistema permitido', () => {
    const r = resolveInitialHomeScreen({
      saved: 'CRM_DEALS',
      access: { crm: false, erp: false, chamados: true },
      deepLink: NO_DEEP_LINK,
    });
    assert.deepEqual(r, { screenId: 'CHAMADOS_OVERVIEW', source: 'FALLBACK' });
    const r2 = resolveInitialHomeScreen({ saved: 'ERP_PROPOSALS', access: { crm: true, erp: false, chamados: true } });
    assert.deepEqual(r2, { screenId: 'CRM_OVERVIEW', source: 'FALLBACK' });
  });

  it('valor salvo invalido e ignorado', () => {
    const r = resolveInitialHomeScreen({ saved: 'TELA_INEXISTENTE' as never, access: ALL });
    assert.equal(r.source, 'FALLBACK');
    assert.equal(r.screenId, 'CRM_OVERVIEW');
  });

  it('deep link tem prioridade sobre a tela padrao', () => {
    const explicit = resolveInitialHomeScreen({
      saved: 'ERP_CONTRACTS',
      access: ALL,
      deepLink: parseHomeDeepLink('?tela=chamados_queue'),
    });
    assert.deepEqual(explicit, { screenId: 'CHAMADOS_QUEUE', source: 'DEEP_LINK' });

    const next = resolveInitialHomeScreen({
      saved: 'ERP_CONTRACTS',
      access: ALL,
      deepLink: parseHomeDeepLink('?next=%2Fproposta%2Fabc'),
    });
    assert.deepEqual(next, { screenId: null, source: 'DEEP_LINK' });

    const hash = resolveInitialHomeScreen({ saved: 'ERP_CONTRACTS', access: ALL, deepLink: parseHomeDeepLink('', '#negocio-123') });
    assert.deepEqual(hash, { screenId: null, source: 'DEEP_LINK' });
  });

  it('deep link ?tela= de sistema sem acesso nao abre a tela proibida', () => {
    const r = resolveInitialHomeScreen({
      saved: 'CHAMADOS_QUEUE',
      access: { crm: true, erp: false, chamados: true },
      deepLink: parseHomeDeepLink('?tela=ERP_CONTRACTS'),
    });
    assert.deepEqual(r, { screenId: 'CHAMADOS_QUEUE', source: 'SAVED' });
  });

  it('usuario com um so sistema nao recebe a escolha e sempre abre esse sistema', () => {
    const onlyErp = { crm: false, erp: true, chamados: false };
    assert.equal(shouldOfferHomeScreenChoice(onlyErp), false);
    assert.deepEqual(getAllowedSystems(onlyErp), ['ERP']);
    assert.deepEqual(resolveInitialHomeScreen({ saved: 'CRM_CONTACTS', access: onlyErp }), {
      screenId: 'ERP_OVERVIEW',
      source: 'FALLBACK',
    });
    assert.equal(shouldOfferHomeScreenChoice({ crm: true, erp: true, chamados: false }), true);
  });

  it('usuario sem nenhum sistema nao recebe tela', () => {
    assert.deepEqual(resolveInitialHomeScreen({ saved: 'CRM_OVERVIEW', access: { crm: false, erp: false, chamados: false } }), {
      screenId: null,
      source: 'NO_ACCESS',
    });
  });
});

describe('Tela inicial padrao - persistencia por usuario', () => {
  it('salva, le e remove a preferencia indexada pelo id do usuario', () => {
    const storage = memoryStorage();
    saveHomeScreenPreference('user-a', 'ERP_PROPOSALS', storage);
    saveHomeScreenPreference('user-b', 'CHAMADOS_OVERVIEW', storage);
    assert.equal(loadHomeScreenPreference('user-a', storage), 'ERP_PROPOSALS');
    assert.equal(loadHomeScreenPreference('user-b', storage), 'CHAMADOS_OVERVIEW');
    assert.equal(loadHomeScreenPreference('user-c', storage), null);
    saveHomeScreenPreference('user-a', null, storage);
    assert.equal(loadHomeScreenPreference('user-a', storage), null);
    assert.equal(loadHomeScreenPreference('user-b', storage), 'CHAMADOS_OVERVIEW');
  });

  it('conteudo corrompido no armazenamento nao quebra a leitura', () => {
    const storage = memoryStorage();
    storage.setItem(HOME_SCREEN_STORAGE_KEY, '{nao-e-json');
    assert.equal(loadHomeScreenPreference('user-a', storage), null);
  });
});
