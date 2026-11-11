// ============================================================================
// SetaDesk - importacao Jira STT/AF -> chamados TEC-/FIN- (somente leitura no Jira)
// ----------------------------------------------------------------------------
// Dry-run por padrao: gera JSON e relatorio, NAO grava no banco.
// --apply exige SETADESK_IMPORT_APPLY=1 e DATABASE_URL, importa STT e AF
// (ou --project STT / AF) e realinha a sequencia de cada fila para
// max(numero do Jira da fila)+1. Nunca escreve, transiciona ou comenta no Jira.
// Uso:
//   npm run setadesk:import-jira -- --out <dir> [--project ALL|STT|AF]
//       [--input jira-source.json] [--changelog-dir dir]
//   SETADESK_IMPORT_APPLY=1 npm run setadesk:import-jira -- --apply --out <dir> --input <json>
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import {
  jiraImportSpec,
  maxAllocatedNumberForPipeline,
  SETADESK_JIRA_IMPORT_PROJECTS,
  SETADESK_SEED_PIPELINES,
} from './setadesk-schema';
import {
  mapJiraIssue,
  planJiraImport,
  type ExistingImportRow,
  type ImportPlanItem,
  type JiraMappedTicket,
} from './setadesk-jira-map';
import { computeRealtimeTicketSla } from '../api/router';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const arg = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const APPLY = has('--apply');
const OUT = path.resolve(arg('--out') || '');
const INPUT = arg('--input');
const KEYS_FILE = arg('--keys-file');
const KEYS_ARG = arg('--keys');
const CHANGELOG_DIR = arg('--changelog-dir');
const PROJECT = (arg('--project') || 'ALL').toUpperCase();
const MAX_STT_ARG = arg('--max-stt');

function fail(msg: string, code = 1): never {
  console.error(`[SetaDesk import] ${msg}`);
  process.exit(code);
}

function formatNowEt(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} (America/New_York)`;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function collectIssues(inputPath: string): Record<string, unknown>[] {
  const st = fs.statSync(inputPath);
  const files = st.isDirectory()
    ? fs.readdirSync(inputPath).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(inputPath, f))
    : [inputPath];
  const issues: Record<string, unknown>[] = [];
  for (const file of files) {
    const raw = readJson(file) as Record<string, unknown> | unknown[];
    if (Array.isArray(raw)) {
      issues.push(...(raw as Record<string, unknown>[]));
      continue;
    }
    if (Array.isArray(raw.issues)) issues.push(...(raw.issues as Record<string, unknown>[]));
    else if (raw.key || (raw.fields && (raw as { fields: unknown }).fields)) issues.push(raw);
  }
  return issues;
}

function filterKeys(): string[] | null {
  const fromArg = (KEYS_ARG || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const fromFile = KEYS_FILE
    ? (readJson(KEYS_FILE) as unknown[]).map((k) => String(k).trim().toUpperCase())
    : [];
  const keys = [...fromArg, ...fromFile];
  return keys.length ? keys : null;
}

function loadChangelog(issue: Record<string, unknown>): unknown {
  if (issue.changelog) return issue.changelog;
  const key = String(issue.key || '');
  if (CHANGELOG_DIR && key) {
    const p = path.join(CHANGELOG_DIR, `${key}.json`);
    if (fs.existsSync(p)) return readJson(p);
  }
  return undefined;
}

function allowedProjects(): string[] {
  const raw = PROJECT;
  if (!raw || raw === 'ALL') return [...SETADESK_JIRA_IMPORT_PROJECTS];
  const list = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = list.filter((p) => !SETADESK_JIRA_IMPORT_PROJECTS.includes(p));
  if (unknown.length) {
    fail(`Projeto(s) fora do escopo: ${unknown.join(', ')}. Permitidos: ${SETADESK_JIRA_IMPORT_PROJECTS.join(', ')} ou ALL.`);
  }
  return list;
}

function parseMaxByProject(
  issues: Record<string, unknown>[],
  filteredKeys: string[] | null,
  projects: string[]
): Record<string, number> {
  const max: Record<string, number> = {};
  for (const p of projects) max[p] = p === 'STT' && MAX_STT_ARG ? Number(MAX_STT_ARG) : 0;
  const consider = (key: string) => {
    const m = key.toUpperCase().match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
    if (!m || !projects.includes(m[1])) return;
    max[m[1]] = Math.max(max[m[1]] || 0, Number(m[2]));
  };
  for (const iss of issues) consider(String(iss.key || ''));
  for (const k of filteredKeys || []) consider(k);
  return max;
}

type Counts = Record<string, number>;
const bump = (c: Counts, k: string | null | undefined) => {
  const key = k || '(vazio)';
  c[key] = (c[key] || 0) + 1;
};

function buildReport(opts: {
  generatedAt: string;
  items: ImportPlanItem[];
  secondPass: ImportPlanItem[];
  maxByProject: Record<string, number>;
  nextByPipeline: Array<{ name: string; prefix: string; jiraProjectKey: string; maxJira: number; nextSeq: number }>;
  projects: string[];
}): string {
  const { items, secondPass, maxByProject, nextByPipeline, generatedAt, projects } = opts;
  const byJiraStatus: Counts = {};
  const byMappedStatus: Counts = {};
  const byJiraPriority: Counts = {};
  const byMappedPriority: Counts = {};
  const byProject: Counts = {};
  const byCategory: Counts = {};
  const missing: Record<string, string[]> = {};
  let comments = 0;
  let attachments = 0;
  let changelogEntries = 0;
  let breached = 0;
  for (const it of items) {
    const m = it.mapped.mapping;
    bump(byJiraStatus, m.jiraStatus);
    bump(byMappedStatus, m.status);
    bump(byJiraPriority, m.jiraPriority);
    bump(byMappedPriority, m.priority);
    bump(byProject, it.mapped.ticket.jiraProjectKey || m.jiraKey.split('-')[0]);
    bump(byCategory, m.category);
    comments += (it.mapped.ticket.comments || []).length;
    attachments += it.mapped.attachments.length;
    changelogEntries += it.mapped.changelog.length;
    const sla = computeRealtimeTicketSla(it.mapped.ticket);
    if (sla.slaStatus === 'BREACHED') breached += 1;
    for (const field of it.mapped.missingFields) {
      (missing[field] ||= []).push(m.jiraKey);
    }
  }
  const actions = { create: 0, update: 0, skip: 0 };
  for (const it of items) actions[it.action] += 1;
  const actions2 = { create: 0, update: 0, skip: 0 };
  for (const it of secondPass) actions2[it.action] += 1;
  const table = (c: Counts) =>
    Object.entries(c)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `- ${k}: ${n}`)
      .join('\n');
  const missingBlock =
    Object.keys(missing).length === 0
      ? 'Nenhum campo obrigatorio ausente no lote.'
      : Object.entries(missing)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([field, keys]) => {
            const shown = keys.length > 40 ? `${keys.slice(0, 40).join(', ')}...` : keys.join(', ');
            return `- ${field}: ${keys.length} (${shown})`;
          })
          .join('\n');
  const rows = items
    .map((it) => {
      const m = it.mapped.mapping;
      const miss = it.mapped.missingFields.length ? it.mapped.missingFields.join(', ') : '-';
      return `| ${m.jiraKey} | ${m.ticketKey || m.sdKey} | ${m.jiraStatus || '-'} | ${m.status} | ${m.jiraPriority || '-'} | ${m.priority} | ${m.category} | ${it.mapped.ticket.comments.length} | ${it.mapped.attachments.length} | ${it.mapped.changelog.length} | ${miss} |`;
    })
    .join('\n');
  const numbering = nextByPipeline
    .map(
      (p) =>
        `- ${p.name} (${p.prefix}-, origem ${p.jiraProjectKey}): maior ${p.jiraProjectKey}-${p.maxJira}; proximo chamado novo ${p.prefix}-${p.nextSeq}`
    )
    .join('\n');

  return `# Relatorio do dry-run Jira -> SetaDesk

Gerado em ${generatedAt}. Fonte: Jira Cloud somente leitura (projetos ${projects.join(', ')}). Nada foi gravado no Neon nem no Preview.

## Contagem

- Itens lidos: ${items.length}
- Por projeto:
${table(byProject)}
- Primeira execucao (base vazia): cria ${actions.create}, atualiza ${actions.update}, ignora ${actions.skip}
- Segunda execucao (idempotencia sobre o plano anterior): cria ${actions2.create}, atualiza ${actions2.update}, ignora ${actions2.skip}
- Comentarios: ${comments}
- Anexos (referencia Jira: nome/tamanho/URL, arquivo nao copiado): ${attachments}
- Entradas de changelog: ${changelogEntries}
- Chamados historicos com SLA BREACHED no recálculo: ${breached} (meta: 0; prazos fixos no import)

## Numeracao

- A chave importada mantem o numero do Jira: STT-n vira TEC-n; AF-n vira FIN-n.
- O prefixo SD- sai.
${numbering}
- DEV e os demais projetos ficam de fora.

## Status Jira

${table(byJiraStatus)}

## Status mapeado (SetaDesk)

${table(byMappedStatus)}

## Prioridade Jira

${table(byJiraPriority)}

## Prioridade mapeada (SetaDesk)

${table(byMappedPriority)}

## Categoria mapeada (SetaDesk)

${table(byCategory)}

## Campos faltantes ou incompletos

${missingBlock}

## Itens

| Jira | SetaDesk | Status Jira | Status SD | Prioridade Jira | Prioridade SD | Categoria | Coment. | Anexos | Changelog | Campos faltantes |
|---|---|---|---|---|---|---|---:|---:|---:|---|
${rows}

## Observacoes

- Solicitante sem e-mail: o Jira nao devolve e-mail de contas tipo customer (privacidade). O nome do reporter e gravado em requesterName; o casamento com Contatos fica para a carga no banco.
- Anexos entram como JIRA_REF (URL/nome/tamanho). Nao ha copia para o Blob neste lote.
- Changelog alimenta historico e slaPausedAt quando o status atual e Aguardando Cliente.
- A sincronizacao continua (Jira -> SetaDesk, somente leitura) esta descrita em /workspace/jira-migracao/plano.md secao 9.
`;
}

/** Mensagem de recusa das pre-condicoes do --apply, ou null se puder gravar. */
export function setaDeskImportApplyDenial(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SETADESK_IMPORT_APPLY !== '1') {
    return 'Recusado: --apply exige SETADESK_IMPORT_APPLY=1. Nada foi gravado.';
  }
  if (!env.DATABASE_URL && !env.DATABASE_POSTGRES_URL) {
    return 'Recusado: --apply exige DATABASE_URL. Nada foi gravado.';
  }
  return null;
}

async function maybeApply(
  items: ImportPlanItem[],
  maxByProject: Record<string, number>
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  nextSequenceValue: number;
  nextSequenceByPipeline: Record<string, { pipelineId: string; prefix: string; nextSequenceValue: number }>;
} | null> {
  if (!APPLY) return null;
  const denial = setaDeskImportApplyDenial();
  if (denial) fail(denial);
  const { applyJiraImport } = await import('./setadesk-store');
  const result = await applyJiraImport(items, { maxStt: maxByProject.STT, maxByProject, project: PROJECT });
  const seqTxt = Object.values(result.nextSequenceByPipeline || {})
    .map((s) => `${s.prefix}-${s.nextSequenceValue}`)
    .join(', ');
  console.log(
    `[SetaDesk import] Gravados: cria ${result.created}, atualiza ${result.updated}, ignora ${result.skipped}. Sequencias alinhadas: ${seqTxt || result.nextSequenceValue}.`
  );
  return result;
}

function existingFromPlan(items: ImportPlanItem[]): Map<string, ExistingImportRow> {
  const map = new Map<string, ExistingImportRow>();
  for (const it of items) {
    const k = it.mapped.mapping.jiraKey.toUpperCase();
    map.set(k, {
      jiraKey: k,
      importHash: it.mapped.importHash,
      externalUpdatedAt: it.mapped.ticket.externalUpdatedAt || it.mapped.ticket.updatedAt,
    });
  }
  return map;
}

async function main() {
  if (!OUT) fail('Informe --out <diretorio> para o JSON e o relatorio.');
  const projects = allowedProjects();
  if (!INPUT) {
    const hasCreds = Boolean(process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN);
    if (!hasCreds) {
      fail('Sem --input e sem credencial de leitura Jira no ambiente (JIRA_API_TOKEN). Nada foi buscado nem gravado.');
    }
    fail('Busca direta à API Jira neste comando ainda nao foi disparada (use --input com o JSON lido do Jira).');
  }

  const wanted = filterKeys();
  const all = collectIssues(INPUT);
  const selected = all.filter((iss) => {
    const key = String(iss.key || '').toUpperCase();
    if (wanted && !wanted.includes(key)) return false;
    return projects.some((p) => key.startsWith(`${p}-`));
  });
  if (wanted) {
    const got = new Set(selected.map((i) => String(i.key).toUpperCase()));
    const missing = wanted.filter((k) => !got.has(k));
    if (missing.length) fail(`Chaves ausentes no --input: ${missing.join(', ')}`);
  }
  if (!selected.length) fail(`Nenhum item ${projects.join('/')} para mapear.`);

  const mapped: JiraMappedTicket[] = selected.map((iss) => mapJiraIssue(iss, { changelog: loadChangelog(iss) }));
  const first = planJiraImport(mapped, new Map());
  const second = planJiraImport(mapped, existingFromPlan(first));
  const maxByProject = parseMaxByProject(selected, wanted, projects);
  const nextByPipeline = SETADESK_SEED_PIPELINES.filter((s) => projects.includes(s.jiraProjectKey)).map((s) => {
    const fromKeys = maxByProject[s.jiraProjectKey] || 0;
    const fromTickets = maxAllocatedNumberForPipeline(
      mapped.filter((m) => (m.ticket.jiraProjectKey || '') === s.jiraProjectKey).map((m) => m.ticket),
      { prefix: s.prefix, jiraProjectKey: s.jiraProjectKey }
    );
    const maxJira = Math.max(fromKeys, fromTickets);
    maxByProject[s.jiraProjectKey] = maxJira;
    return {
      name: s.name,
      prefix: s.prefix,
      jiraProjectKey: s.jiraProjectKey,
      maxJira,
      nextSeq: maxJira + 1,
    };
  });
  const generatedAt = formatNowEt();

  fs.mkdirSync(OUT, { recursive: true });
  const payload = {
    generatedAt,
    dryRun: true,
    project: projects.join(','),
    maxByProject,
    nextByPipeline,
    counts: {
      read: first.length,
      create: first.filter((i) => i.action === 'create').length,
      update: first.filter((i) => i.action === 'update').length,
      skip: first.filter((i) => i.action === 'skip').length,
      secondPassCreate: second.filter((i) => i.action === 'create').length,
      secondPassUpdate: second.filter((i) => i.action === 'update').length,
      secondPassSkip: second.filter((i) => i.action === 'skip').length,
    },
    items: first.map((it) => ({
      action: it.action,
      reason: it.reason,
      mapping: it.mapped.mapping,
      missingFields: it.mapped.missingFields,
      importHash: it.mapped.importHash,
      ticket: it.mapped.ticket,
      attachments: it.mapped.attachments,
      changelog: it.mapped.changelog,
    })),
  };
  const jsonPath = path.join(OUT, 'import-dry-run.json');
  const mdPath = path.join(OUT, 'relatorio-piloto.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(
    mdPath,
    buildReport({ generatedAt, items: first, secondPass: second, maxByProject, nextByPipeline, projects })
  );

  const applied = await maybeApply(first, maxByProject);

  const nextTxt = nextByPipeline.map((p) => `${p.prefix}-${p.nextSeq}`).join(', ');
  if (applied) {
    console.log(
      `[SetaDesk import] Apply: ${first.length} itens planejados. JSON: ${jsonPath}. Relatorio: ${mdPath}.`
    );
  } else {
    console.log(
      `[SetaDesk import] Dry-run: ${first.length} itens, cria ${payload.counts.create}, 2a execucao ignora ${payload.counts.secondPassSkip}. Proximos chamados novos: ${nextTxt}. JSON: ${jsonPath}. Relatorio: ${mdPath}. Nada gravado no banco.`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[SetaDesk import] Falha:', (err as Error)?.message || err);
    process.exit(1);
  });
}
