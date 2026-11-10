// STI-hub — Inventário e migração idempotente das 9 etapas do funil de venda.
// NÃO conecta em PostgreSQL. Recusa rodar se DATABASE_URL estiver definido.
// Uso:
//   env -u DATABASE_URL node dist/src/db/cli-migrate-sales-stages.js --store .data/crm-store.json
//   env -u DATABASE_URL node dist/src/db/cli-migrate-sales-stages.js --store .data/crm-store.json --apply

import fs from 'node:fs';
import path from 'node:path';
import type { CrmDatabaseState } from './types';
import {
  applySalesPipelineStageMigration,
  formatSalesPipelineInventoryReport,
  inventoryEnterpriseSalesDeals,
} from '../modules/deals/sales-pipeline-stages';

function fail(message: string, code = 1): never {
  console.error(`[migrate-sales-stages] ${message}`);
  process.exit(code);
}

function parseArgs(argv: string[]): { store: string | null; apply: boolean } {
  let store: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--store') {
      store = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg.startsWith('--store=')) {
      store = arg.slice('--store='.length);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Inventário/migração local do funil pipe-enterprise-b2b (9 etapas HubSpot).\n' +
          '  --store <arquivo.json>  Estado CRM local (ex.: .data/crm-store.json)\n' +
          '  --apply                 Grava o arquivo (padrão: apenas dry-run)\n' +
          'Recusa DATABASE_URL. Não há modo PostgreSQL neste comando.'
      );
      process.exit(0);
    }
    fail(`Argumento não reconhecido: ${arg}. Use --help.`);
  }
  return { store, apply };
}

function main(): void {
  if (process.env.DATABASE_URL) {
    fail(
      'Recusado: DATABASE_URL está definido. Este comando não se conecta a banco. ' +
        'Rode com `env -u DATABASE_URL` e `--store <arquivo.json>`.'
    );
  }

  const { store, apply } = parseArgs(process.argv.slice(2));
  if (!store) {
    fail('Informe --store <arquivo.json> (dry-run por padrão).');
  }

  const storePath = path.resolve(store);
  if (!fs.existsSync(storePath)) {
    fail(`Arquivo não encontrado: ${storePath}`);
  }

  const raw = fs.readFileSync(storePath, 'utf-8');
  const state = JSON.parse(raw) as CrmDatabaseState;
  if (!state || !Array.isArray(state.pipelines) || !Array.isArray(state.deals)) {
    fail('O arquivo não parece um estado CRM (faltam pipelines/deals).');
  }

  const inventory = inventoryEnterpriseSalesDeals(state);
  console.log('==============================================================');
  console.log(' STI-hub — Funil de venda: 7 etapas → 9 etapas do HubSpot');
  console.log(apply ? ' Modo: APPLY (grava o JSON local)' : ' Modo: DRY-RUN (não grava)');
  console.log(` Arquivo: ${storePath}`);
  console.log('==============================================================');
  console.log(formatSalesPipelineInventoryReport(inventory));

  const result = applySalesPipelineStageMigration(state);
  console.log('\nResultado da migração:');
  console.log(
    JSON.stringify(
      {
        applied: result.applied,
        alreadyUpToDate: result.alreadyUpToDate,
        pipelineUpdated: result.pipelineUpdated,
        stagesAdded: result.stagesAdded,
        dealsRemapped: result.dealsMapped.length,
        workflowsUpdated: result.workflowsUpdated,
        unmapped: result.unmappedDeals.map((d) => d.dealId),
      },
      null,
      2
    )
  );
  if (result.dealsMapped.length) {
    console.log('Negócios com stageId/probabilidade alterados:');
    for (const row of result.dealsMapped) {
      console.log(
        `  ${row.dealId}: ${row.fromStageId} (${row.fromStageName}, p=${row.probabilityFrom}) → ${row.toStageId} (${row.toStageName}, p=${row.probabilityTo})`
      );
    }
  }

  if (!apply) {
    console.log('\nDry-run concluído. Nada foi gravado. Para gravar o JSON local: acrescente --apply.');
    return;
  }

  const backupPath = `${storePath}.bak-stages-${Date.now()}`;
  fs.copyFileSync(storePath, backupPath);
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2), 'utf-8');
  console.log(`\nAplicado. Backup: ${backupPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
