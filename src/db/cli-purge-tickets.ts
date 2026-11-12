// ============================================================================
// SetaDesk - limpeza dos chamados (setadesk_tickets e dependentes)
// ----------------------------------------------------------------------------
// Dry-run por padrao: mostra as contagens e NAO apaga nada.
// A exclusao exige --apply e SETADESK_PURGE_CONFIRM=1. Nao toca em tabelas
// que nao sejam setadesk_*, nem em pipelines, meta, mail_sync ou migracoes.
// Nunca apaga setadesk_email_messages, setadesk_email_outbox nem
// setadesk_integration_outbox. Chamados com e-mail ou outbox vinculado
// sao pulados e relatados.
// Uso:
//   npm run setadesk:purge-tickets
//   SETADESK_PURGE_CONFIRM=1 npm run setadesk:purge-tickets -- --apply
// ============================================================================

import {
  countSetaDeskTicketDependents,
  previewSetaDeskTicketPurge,
  purgeSetaDeskTickets,
  type SetaDeskPurgeCounts,
  type SetaDeskPurgeReport,
} from './setadesk-store';

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
    `e-mails vinculados (nao apagados): ${c.emailMessages}`,
    `outbox de e-mail (nao apagado): ${c.emailOutbox}`,
    `outbox de integracao (nao apagado): ${c.integrationOutbox}`,
    `tombstones: ${c.tombstones}`,
  ].join('\n- ');
}

export function formatSetaDeskPurgeReport(report: SetaDeskPurgeReport, mode: 'preview' | 'applied'): string {
  const skipped = report.skippedTickets;
  const skippedLines = skipped.length
    ? skipped.map((t) => `${t.key} (${t.id})`).join(', ')
    : 'nenhum';
  const head = mode === 'preview'
    ? 'Previa: chamados com e-mail ou outbox vinculado serao pulados. Nada foi apagado.'
    : 'Apagados (somente chamados sem e-mail/outbox vinculado; pipelines e tabelas protegidas intactas):';
  const body = [
    head,
    mode === 'applied' ? `Contagens apagadas:\n- ${formatCounts(report.deleted)}` : null,
    `Chamados pulados (${skipped.length}): ${skippedLines}`,
    report.skippedReason || '',
    `Preservados: e-mails=${report.preserved.emailMessages}, outbox e-mail=${report.preserved.emailOutbox}, outbox integracao=${report.preserved.integrationOutbox} (tabelas: ${report.preserved.tables.join(', ')})`,
  ].filter(Boolean);
  return body.join('\n');
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_POSTGRES_URL) {
    fail('Informe DATABASE_URL para contar ou apagar. Nada foi apagado.');
  }
  const counts = await countSetaDeskTicketDependents();
  console.log(`[SetaDesk purge] Contagem atual:\n- ${formatCounts(counts)}`);
  if (!APPLY) {
    const preview = await previewSetaDeskTicketPurge();
    console.log(`[SetaDesk purge] ${formatSetaDeskPurgeReport(preview, 'preview')}`);
    console.log('[SetaDesk purge] Dry-run: nada foi apagado. Para apagar, use --apply e SETADESK_PURGE_CONFIRM=1.');
    return;
  }
  const denial = setaDeskPurgeApplyDenial();
  if (denial) fail(denial);
  const deleted = await purgeSetaDeskTickets();
  console.log(`[SetaDesk purge] ${formatSetaDeskPurgeReport(deleted, 'applied')}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[SetaDesk purge] Falha:', (err as Error)?.message || err);
    process.exit(1);
  });
}
