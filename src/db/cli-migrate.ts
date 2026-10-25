// ============================================================================
// HubSpot Pro CRM - PostgreSQL Schema Migration & Seed CLI
// ============================================================================

import {
  checkPostgresHealth,
  closePostgresPool,
  ensurePostgresSchema,
  isPostgresEnabled,
  loadStateFromPostgres,
} from './postgres';
import { getRepository } from './repository';

async function main() {
  const args = process.argv.slice(2);
  const forceReset = args.includes('--reset') || args.includes('--seed');

  console.log('==============================================================');
  console.log(' HubSpot Pro CRM - Inicializador de Banco de Dados (Produção)');
  console.log('==============================================================');

  if (!isPostgresEnabled()) {
    console.log(
      '[Aviso] Variável DATABASE_URL não definida. Inicializando/validando banco local JSON (.data/crm-store.json)...'
    );
    const repo = getRepository();
    if (forceReset) {
      repo.resetToSeed();
    }
    const state = repo.getState();
    console.log('[OK] Estado local pronto:', {
      companies: state.companies.length,
      contacts: state.contacts.length,
      pipelines: state.pipelines.length,
      deals: state.deals.length,
      workflows: state.workflows.length,
      sequences: state.sequences.length,
    });
    return;
  }

  const health = await checkPostgresHealth();
  if (!health.connected) {
    console.error('[ERRO] Não foi possível conectar ao PostgreSQL em DATABASE_URL:', health.error);
    process.exitCode = 1;
    await closePostgresPool();
    return;
  }

  console.log(`[1/3] Conectado ao PostgreSQL (${health.latencyMs}ms). Criando/verificando tabelas e índices...`);
  await ensurePostgresSchema();

  console.log(
    `[2/3] Sincronizando estado do CRM (${forceReset ? 'redefinindo seed inicial' : 'preservando dados existentes ou aplicando seed inicial'})...`
  );
  const state = await loadStateFromPostgres({ forceReset });

  if (state) {
    console.log('[3/3] Migração e sincronização PostgreSQL concluídas com sucesso!');
    console.log('Resumo das tabelas populadas:', {
      crm_companies: state.companies.length,
      crm_contacts: state.contacts.length,
      crm_pipelines: state.pipelines.length,
      crm_deals: state.deals.length,
      crm_timeline_events: state.timelineEvents.length,
      crm_workflows: state.workflows.length,
      crm_sequences: state.sequences.length,
      crm_data_health_issues: state.dataHealthIssues.length,
    });
  }

  await closePostgresPool();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('[ERRO FATAL na migração PostgreSQL]:', err);
    await closePostgresPool();
    process.exit(1);
  });
}
