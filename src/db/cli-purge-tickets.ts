// ============================================================================
// SetaDesk - limpeza dos chamados (setadesk_tickets e dependentes)
// ----------------------------------------------------------------------------
// Dry-run por padrao: mostra as contagens e NAO apaga nada.
// A exclusao exige --apply e SETADESK_PURGE_CONFIRM=1. Nao toca em tabelas
// que nao sejam setadesk_*, nem em pipelines, meta, mail_sync ou migracoes.
// Uso:
//   npm run setadesk:purge-tickets
//   SETADESK_PURGE_CONFIRM=1 npm run setadesk:purge-tickets -- --apply
// ============================================================================

import { countSetaDeskTicketDependents, purgeSetaDeskTickets, type SetaDeskPurgeCounts } from './setadesk-store';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

function fail(msg: string, code = 1): never {
  console.error(`[SetaDesk purge] ${msg}`);
  process.exit(code);
}

export function setaDeskPurgeApplyDenial(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SETADESK_PURGE_CONFIRM !== '1') {
    return 'Recusado: a exclusao exige SETADESK_PURGE_CONFIRM=1. Nada foi apagado.';
  }
  if (!env.DATABASE_URL && !env.DATABASE_POSTGRES_URL) {
    return 'Recusado: a exclusao exige DATABASE_URL. Nada foi apagado.';
  }
  return null;
}

function formatCounts(c: SetaDeskPurgeCounts): string {
  return [
    `chamados: ${c.tickets}`,
    `comentarios: ${c.comments}`,
    `anexos: ${c.attachments}`,
    `historico: ${c.history}`,
    `relacionados: ${c.related}`,
    `notificacoes: ${c.notifications}`,
    `e-mails vinculados: ${c.emailMessages}`,
    `outbox de e-mail: ${c.emailOutbox}`,
    `outbox de integracao: ${c.integrationOutbox}`,
    `tombstones: ${c.tombstones}`,
  ].join('\n- ');
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_POSTGRES_URL) {
    fail('Informe DATABASE_URL para contar ou apagar. Nada foi apagado.');
  }
  const counts = await countSetaDeskTicketDependents();
  console.log(`[SetaDesk purge] Contagem atual:\n- ${formatCounts(counts)}`);
  if (!APPLY) {
    console.log('[SetaDesk purge] Dry-run: nada foi apagado. Para apagar, use --apply e SETADESK_PURGE_CONFIRM=1.');
    return;
  }
  const denial = setaDeskPurgeApplyDenial();
  if (denial) fail(denial);
  const deleted = await purgeSetaDeskTickets();
  console.log(
    `[SetaDesk purge] Apagados (somente setadesk_tickets e dependentes; pipelines e demais tabelas setadesk_* intactas):\n- ${formatCounts(deleted)}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[SetaDesk purge] Falha:', (err as Error)?.message || err);
    process.exit(1);
  });
}
