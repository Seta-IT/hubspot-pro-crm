// ============================================================================
// Clean Corporate Light — módulo COMUM do template da proposta (/proposta/[id]) e do
// Recibo/Fatura de Locação (Espelho FAT-LOC). Uma única fonte para classes, cores,
// tipografia e blocos (cabeçalho timbrado, tabela de itens, totais e rodapé).
//
// - CCL_TW: classes Tailwind usadas pela folha da proposta (opção 1 / padrão) e pelo
//   espelho da fatura no ERP. A proposta lê daqui; os valores são os mesmos de antes.
// - CCL_COLORS / CCL_FONT_STACK: os mesmos tokens em hex (paleta Tailwind) para o HTML
//   standalone do recibo, que abre fora do app (impressão/PDF) e não tem Tailwind.
// - CCL_SHEET_CSS + ccl*Html(): os blocos da proposta em HTML puro para o recibo.
// ============================================================================

import type { ProposalLightTemplateId } from './proposal-share';

/** Classes Tailwind de cada modelo da folha (as mesmas da proposta, por modelo). */
export interface ProposalSheetTw {
  pageOuterBg: string;
  sheetBorder: string;
  headerBg: string;
  headerBadge: string;
  metaBox: string;
  instCard: string;
  instEyebrowColor: string;
  bulletColor: string;
  softBox: string;
  stripBox: string;
  scopeBorder: string;
  tableCardBorder: string;
  tableHeaderBg: string;
  tableColHead: string;
  totalBoxBg: string;
  flowBox: string;
  stepBadge: string;
}

/** Classes comuns a todos os modelos (títulos, rótulos, totais, botões). */
export const PROPOSAL_SHEET_COMMON_TW = {
  sectionTitle: 'text-xs font-semibold uppercase tracking-wide text-[#1e3a6e]',
  fieldLabel: 'text-[10px] uppercase font-semibold text-slate-500 block',
  fieldValue: 'text-sm font-semibold text-slate-900',
  totalLabel: 'text-[10px] font-semibold uppercase tracking-wider text-[#1e3a6e] block',
  totalValue: 'font-semibold text-emerald-700',
  fiscalBox: 'rounded-lg bg-emerald-50/60 border border-emerald-200',
  primaryButton: 'bg-[#1e3a6e] hover:bg-[#162b54] text-white',
  outlineButton: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
  topBar: 'bg-white text-slate-700 rounded-lg border border-slate-200',
  templateSelect: 'px-2.5 py-1.5 rounded-md bg-white text-slate-700 text-xs font-medium border border-slate-300 cursor-pointer',
} as const;

export const PROPOSAL_SHEET_TW: Record<ProposalLightTemplateId, ProposalSheetTw> = {
  CLEAN_CORPORATE_LIGHT: {
    pageOuterBg: 'bg-[#f1f5f9]',
    sheetBorder: 'border-slate-300 rounded-lg',
    headerBg:
      'bg-gradient-to-b from-[#f0f6ff] to-white text-[#0d2b4e] border-t-4 border-t-[#1e3a6e] border-b border-b-blue-100',
    headerBadge: 'bg-blue-50 text-[#1e3a6e] border border-blue-200',
    metaBox: 'bg-slate-50/90 border border-blue-100',
    instCard: 'bg-slate-50/90 border border-slate-200 border-l-4 border-l-[#f26522]',
    instEyebrowColor: 'text-[#f26522]',
    bulletColor: 'text-[#f26522]',
    softBox: 'bg-slate-50/90 border border-slate-200',
    stripBox: 'bg-[#f0f7ff] border border-blue-100',
    scopeBorder: 'border-[#1e3a6e]',
    tableCardBorder: 'border-slate-300',
    tableHeaderBg: 'bg-slate-100 text-[#1e3a6e] border-b border-slate-200',
    tableColHead: 'bg-slate-50 text-slate-600 border-b border-slate-200',
    totalBoxBg: 'bg-slate-50 text-slate-900 border border-slate-300',
    flowBox: 'bg-slate-50/90 border border-blue-100',
    stepBadge: 'bg-blue-50 text-[#1e3a6e] border border-blue-200',
  },
  MINIMAL_SWISS_PAPER: {
    pageOuterBg: 'bg-[#f3f4f6]',
    sheetBorder: 'border-slate-300 rounded-md',
    headerBg: 'bg-white text-slate-900 border-t-3 border-t-slate-900 border-b border-b-slate-200',
    headerBadge: 'bg-slate-50 text-slate-700 border border-slate-300',
    metaBox: 'bg-white border border-slate-200',
    instCard: 'bg-white border border-slate-200 border-l-3 border-l-emerald-500',
    instEyebrowColor: 'text-emerald-600',
    bulletColor: 'text-emerald-500',
    softBox: 'bg-[#fafafa] border border-slate-200',
    stripBox: 'bg-white border border-slate-200',
    scopeBorder: 'border-emerald-500',
    tableCardBorder: 'border-slate-200',
    tableHeaderBg: 'bg-slate-50 text-slate-900 border-b border-slate-200',
    tableColHead: 'bg-white text-slate-600 border-b border-slate-200',
    totalBoxBg: 'bg-white text-slate-900 border border-slate-300',
    flowBox: 'bg-[#fafafa] border border-slate-200',
    stepBadge: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  },
  EXECUTIVE_SOFT_INDIGO: {
    pageOuterBg: 'bg-[#eef2ff]',
    sheetBorder: 'border-indigo-200 rounded-xl',
    headerBg:
      'bg-gradient-to-br from-[#f5f7ff] to-[#eef2ff] text-indigo-950 border-t-4 border-t-indigo-600 border-b border-b-indigo-200',
    headerBadge: 'bg-white text-indigo-700 border border-indigo-200',
    metaBox: 'bg-white border border-indigo-200',
    instCard: 'bg-[#fafbff] border border-indigo-100 border-l-4 border-l-indigo-600',
    instEyebrowColor: 'text-indigo-600',
    bulletColor: 'text-indigo-600',
    softBox: 'bg-[#fafbff] border border-indigo-100',
    stripBox: 'bg-[#f5f7ff] border border-indigo-100',
    scopeBorder: 'border-indigo-600',
    tableCardBorder: 'border-indigo-100',
    tableHeaderBg: 'bg-indigo-50/90 text-indigo-950 border-b border-indigo-100',
    tableColHead: 'bg-[#fafbff] text-indigo-900/80 border-b border-indigo-100',
    totalBoxBg: 'bg-[#f5f7ff] text-slate-900 border border-indigo-200',
    flowBox: 'bg-[#fafbff] border border-indigo-100',
    stepBadge: 'bg-indigo-50 text-indigo-800 border border-indigo-200',
  },
};

/** Atalho do modelo padrão (Clean Corporate Light). */
export const CCL_TW = { ...PROPOSAL_SHEET_TW.CLEAN_CORPORATE_LIGHT, ...PROPOSAL_SHEET_COMMON_TW };

/** Os mesmos tokens em hex (paleta Tailwind v3) para HTML sem Tailwind. */
export const CCL_COLORS = {
  accent: '#1e3a6e',
  accentHover: '#162b54',
  ink: '#0d2b4e',
  brandOrange: '#f26522',
  white: '#ffffff',
  slate50: '#f8fafc',
  slate50_90: 'rgba(248, 250, 252, 0.9)',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',
  slate900: '#0f172a',
  blue50: '#eff6ff',
  blue100: '#dbeafe',
  blue200: '#bfdbfe',
  emerald50_60: 'rgba(236, 253, 245, 0.6)',
  emerald200: '#a7f3d0',
  emerald700: '#047857',
  emerald900: '#064e3b',
  rose600: '#e11d48',
} as const;

/**
 * Variáveis CSS de cada modelo = tradução 1:1 de PROPOSAL_SHEET_TW para o HTML standalone.
 * O resto do CSS (CCL_SHEET_CSS) é igual para todos os modelos.
 */
export const PROPOSAL_SHEET_CSS_VARS: Record<ProposalLightTemplateId, Record<string, string>> = {
  CLEAN_CORPORATE_LIGHT: {
    '--ps-page-bg': '#f1f5f9',
    '--ps-sheet-border': '#cbd5e1',
    '--ps-sheet-radius': '8px',
    '--ps-header-bg': 'linear-gradient(to bottom, #f0f6ff, #ffffff)',
    '--ps-header-ink': '#0d2b4e',
    '--ps-header-top': '4px solid #1e3a6e',
    '--ps-header-bottom': '#dbeafe',
    '--ps-meta-bg': 'rgba(248, 250, 252, 0.9)',
    '--ps-meta-border': '#dbeafe',
    '--ps-soft-bg': 'rgba(248, 250, 252, 0.9)',
    '--ps-soft-border': '#e2e8f0',
    '--ps-table-border': '#cbd5e1',
    '--ps-table-head-bg': '#f1f5f9',
    '--ps-table-head-ink': '#1e3a6e',
    '--ps-table-head-border': '#e2e8f0',
    '--ps-col-head-bg': '#f8fafc',
    '--ps-col-head-ink': '#475569',
    '--ps-col-head-border': '#e2e8f0',
    '--ps-total-bg': '#f8fafc',
    '--ps-total-border': '#cbd5e1',
  },
  MINIMAL_SWISS_PAPER: {
    '--ps-page-bg': '#f3f4f6',
    '--ps-sheet-border': '#cbd5e1',
    '--ps-sheet-radius': '6px',
    '--ps-header-bg': '#ffffff',
    '--ps-header-ink': '#0f172a',
    '--ps-header-top': '3px solid #0f172a',
    '--ps-header-bottom': '#e2e8f0',
    '--ps-meta-bg': '#ffffff',
    '--ps-meta-border': '#e2e8f0',
    '--ps-soft-bg': '#fafafa',
    '--ps-soft-border': '#e2e8f0',
    '--ps-table-border': '#e2e8f0',
    '--ps-table-head-bg': '#f8fafc',
    '--ps-table-head-ink': '#0f172a',
    '--ps-table-head-border': '#e2e8f0',
    '--ps-col-head-bg': '#ffffff',
    '--ps-col-head-ink': '#475569',
    '--ps-col-head-border': '#e2e8f0',
    '--ps-total-bg': '#ffffff',
    '--ps-total-border': '#cbd5e1',
  },
  EXECUTIVE_SOFT_INDIGO: {
    '--ps-page-bg': '#eef2ff',
    '--ps-sheet-border': '#c7d2fe',
    '--ps-sheet-radius': '12px',
    '--ps-header-bg': 'linear-gradient(to bottom right, #f5f7ff, #eef2ff)',
    '--ps-header-ink': '#1e1b4b',
    '--ps-header-top': '4px solid #4f46e5',
    '--ps-header-bottom': '#c7d2fe',
    '--ps-meta-bg': '#ffffff',
    '--ps-meta-border': '#c7d2fe',
    '--ps-soft-bg': '#fafbff',
    '--ps-soft-border': '#e0e7ff',
    '--ps-table-border': '#e0e7ff',
    '--ps-table-head-bg': 'rgba(238, 242, 255, 0.9)',
    '--ps-table-head-ink': '#1e1b4b',
    '--ps-table-head-border': '#e0e7ff',
    '--ps-col-head-bg': '#fafbff',
    '--ps-col-head-ink': 'rgba(49, 46, 129, 0.8)',
    '--ps-col-head-border': '#e0e7ff',
    '--ps-total-bg': '#f5f7ff',
    '--ps-total-border': '#c7d2fe',
  },
};

/** CSS das variáveis de todos os modelos, chaveado por [data-template="<id>"]. */
export function proposalSheetCssVarsBlock(): string {
  return Object.entries(PROPOSAL_SHEET_CSS_VARS)
    .map(([id, vars]) => `    [data-template="${id}"] { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} }`)
    .join('\n');
}

/** Tipografia da proposta: font-sans padrão do Tailwind (preflight). */
export const CCL_FONT_STACK =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

const C = CCL_COLORS;

/**
 * CSS da folha Clean Corporate Light para documentos standalone (recibo/fatura).
 * Cada classe espelha um token de CCL_TW (mesmos tamanhos de impressão da proposta).
 */
export const CCL_SHEET_CSS = `
${proposalSheetCssVarsBlock()}
    .ccl-body { font-family: ${CCL_FONT_STACK}; color: ${C.slate900}; -webkit-font-smoothing: antialiased; font-feature-settings: "cv02", "cv03", "cv04", "cv11"; }
    .ccl-topbar { background: ${C.white}; color: ${C.slate700}; border: 1px solid ${C.slate200}; border-radius: 8px; padding: 6px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
    .ccl-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .ccl-btn-primary { background: ${C.accent}; color: ${C.white}; border: 1px solid ${C.accent}; }
    .ccl-btn-primary:hover { background: ${C.accentHover}; }
    .ccl-btn-outline { background: ${C.white}; color: ${C.slate700}; border: 1px solid ${C.slate300}; }
    .ccl-sheet { background: ${C.white}; border: 1px solid var(--ps-sheet-border); border-radius: var(--ps-sheet-radius); overflow: hidden; }
    .ccl-header { background: var(--ps-header-bg); color: var(--ps-header-ink); border-top: var(--ps-header-top); border-bottom: 1px solid var(--ps-header-bottom); padding: 8px 14px; }
    .ccl-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .ccl-header-row + .ccl-header-row { border-top: 1px solid rgba(226, 232, 240, 0.8); margin-top: 6px; padding-top: 5px; }
    .ccl-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .ccl-logo { background: ${C.white}; border: 1px solid ${C.slate200}; border-radius: 6px; padding: 6px 11px; display: flex; align-items: center; gap: 7px; flex-shrink: 0; box-shadow: 0 1px rgba(0,0,0,0.05); }
    .ccl-logo b { font-size: 18px; font-weight: 900; letter-spacing: -0.025em; line-height: 1; }
    .ccl-logo i { width: 2px; height: 18px; background: ${C.brandOrange}; display: inline-block; }
    .ccl-company { font-size: 16px; font-weight: 900; letter-spacing: -0.025em; color: var(--ps-header-ink); margin: 0; line-height: 1.25; }
    .ccl-company-sub { font-size: 10.5px; font-weight: 600; color: ${C.slate600}; margin: 0; }
    .ccl-company-sub2 { font-size: 10.5px; color: ${C.slate500}; margin: 0; }
    .ccl-meta { background: var(--ps-meta-bg); border: 1px solid var(--ps-meta-border); border-radius: 8px; padding: 6px 12px; text-align: right; flex-shrink: 0; }
    .ccl-eyebrow { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.accent}; }
    .ccl-doc-number { font-size: 18px; font-weight: 900; color: var(--ps-header-ink); line-height: 1.2; }
    .ccl-version { padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(30, 58, 110, 0.3); background: rgba(30, 58, 110, 0.05); font-size: 10.5px; font-weight: 600; color: ${C.accent}; white-space: nowrap; }
    .ccl-meta-line { font-size: 10.5px; color: ${C.slate600}; margin-top: 1px; }
    .ccl-meta-line strong, .ccl-contact strong { color: ${C.slate900}; }
    .ccl-contact { font-size: 10.5px; color: ${C.slate700}; display: flex; flex-wrap: wrap; gap: 2px 14px; }
    .ccl-chip { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 4px; background: ${C.white}; color: ${C.slate700}; border: 1px solid ${C.slate200}; font-size: 9.5px; font-weight: 600; }
    .ccl-chip-accent { background: ${C.blue50}; color: ${C.accent}; border-color: ${C.blue200}; }
    .ccl-content { padding: 10px 14px 12px; }
    .ccl-content > * + * { margin-top: 9px; }
    .ccl-section { background: var(--ps-soft-bg); border: 1px solid var(--ps-soft-border); border-radius: 8px; padding: 9px 12px; font-size: 11px; page-break-inside: avoid; break-inside: avoid; }
    .ccl-section-white { background: ${C.white}; }
    .ccl-section-title { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.025em; color: ${C.accent}; margin-bottom: 5px; }
    .ccl-grid { display: grid; gap: 6px 10px; }
    .ccl-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ccl-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ccl-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .ccl-grid-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .ccl-label { font-size: 10px; text-transform: uppercase; font-weight: 600; color: ${C.slate500}; display: block; }
    .ccl-value { font-size: 12.5px; font-weight: 600; color: ${C.slate900}; }
    .ccl-text { font-size: 11px; color: ${C.slate600}; line-height: 1.45; margin: 0; }
    .ccl-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    .ccl-table-card { border: 1px solid var(--ps-table-border); border-radius: 8px; overflow: hidden; background: ${C.white}; page-break-inside: avoid; break-inside: avoid; }
    .ccl-table-head { background: var(--ps-table-head-bg); color: var(--ps-table-head-ink); border-bottom: 1px solid var(--ps-table-head-border); padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 800; letter-spacing: 0.025em; }
    .ccl-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
    .ccl-table thead { background: var(--ps-col-head-bg); color: var(--ps-col-head-ink); border-bottom: 1px solid var(--ps-col-head-border); text-transform: uppercase; font-size: 10px; }
    .ccl-table th { padding: 6px 10px; font-weight: 800; white-space: nowrap; }
    .ccl-table td { padding: 6px 10px; border-top: 1px solid rgba(226, 232, 240, 0.8); vertical-align: top; }
    .ccl-table tbody tr:first-child td { border-top: none; }
    .ccl-table tbody tr:nth-child(even) { background: rgba(248, 250, 252, 0.4); }
    .ccl-td-sku { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-weight: 700; color: ${C.accent}; font-size: 10.5px; white-space: nowrap; }
    .ccl-td-desc { font-weight: 700; color: ${C.slate900}; line-height: 1.35; }
    .ccl-td-num { text-align: right; color: ${C.slate700}; white-space: nowrap; }
    .ccl-td-qty { text-align: center; font-weight: 700; color: ${C.slate900}; white-space: nowrap; }
    .ccl-td-total { text-align: right; font-weight: 800; color: ${C.slate900}; white-space: nowrap; }
    .ccl-right { text-align: right; }
    .ccl-center { text-align: center; }
    .ccl-summary { background: var(--ps-soft-bg); border: 1px solid var(--ps-soft-border); border-radius: 8px; padding: 9px 12px; display: grid; gap: 8px; font-size: 11px; page-break-inside: avoid; }
    .ccl-total-label { font-size: 9.5px; text-transform: uppercase; font-weight: 600; color: ${C.emerald700}; display: block; }
    .ccl-total-value { font-size: 14px; font-weight: 600; color: ${C.emerald700}; }
    .ccl-negative { color: ${C.rose600}; }
    .ccl-fiscal { background: ${C.emerald50_60}; border: 1px solid ${C.emerald200}; border-radius: 8px; padding: 9px 12px; font-size: 11px; page-break-inside: avoid; }
    .ccl-fiscal-title { font-size: 12px; font-weight: 600; color: ${C.emerald900}; margin-bottom: 3px; }
    .ccl-total-box { background: var(--ps-total-bg); color: ${C.slate900}; border: 1px solid var(--ps-total-border); border-radius: 8px; padding: 7px 10px; }
    .ccl-total-box-label { font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.accent}; display: block; }
    .ccl-total-box-value { font-size: 19px; font-weight: 600; color: ${C.emerald700}; margin-top: 1px; }
    .ccl-total-box-lines { border-top: 1px solid ${C.slate200}; margin-top: 4px; padding-top: 4px; font-size: 10.5px; color: ${C.slate600}; }
    .ccl-total-box-lines div { display: flex; justify-content: space-between; gap: 6px; }
    .ccl-total-box-lines strong { color: ${C.slate900}; }
    .ccl-footer { border-top: 1px solid ${C.slate200}; padding-top: 7px; }
    .ccl-sign-card { background: ${C.white}; border: 1px solid ${C.slate200}; border-radius: 8px; padding: 10px 14px; }
    .ccl-sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding-top: 20px; }
    .ccl-sign { border-top: 1px solid ${C.slate300}; padding-top: 4px; text-align: center; }
    .ccl-sign b { display: block; font-size: 11px; font-weight: 600; color: ${C.slate900}; }
    .ccl-sign span { font-size: 10px; color: ${C.slate500}; }
`;

export function cclEscape(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Cabeçalho timbrado SETA | IT idêntico ao da proposta (logo, razão social, quadro do documento). */
export function cclLetterheadHtml(input: {
  eyebrow: string;
  docNumber: string;
  versionLabel?: string;
  metaLinesHtml: string[];
  contactHtml?: string;
  chipsHtml?: string;
  companySubtitle?: string;
  companyLine?: string;
}): string {
  return `<div class="ccl-header">
      <div class="ccl-header-row">
        <div class="ccl-brand">
          <div class="ccl-logo"><b style="color:${C.ink}">SETA</b><i></i><b style="color:${C.brandOrange}">IT</b></div>
          <div style="min-width:0;">
            <h1 class="ccl-company">SETA TELECOM LTDA</h1>
            <p class="ccl-company-sub">${input.companySubtitle ?? 'Infraestrutura de TI, Redes, Segurança &amp; Locação Corporativa (HaaS)'}</p>
            ${input.companyLine ? `<p class="ccl-company-sub2">${input.companyLine}</p>` : ''}
          </div>
        </div>
        <div class="ccl-meta">
          <div class="ccl-eyebrow">${input.eyebrow}</div>
          <div style="display:flex;align-items:baseline;gap:7px;justify-content:flex-end;margin-top:1px;">
            <span class="ccl-doc-number">${input.docNumber}</span>
            ${input.versionLabel ? `<span class="ccl-version">${input.versionLabel}</span>` : ''}
          </div>
          ${input.metaLinesHtml.map((l) => `<div class="ccl-meta-line">${l}</div>`).join('')}
        </div>
      </div>
      ${input.contactHtml || input.chipsHtml ? `<div class="ccl-header-row">
        <div class="ccl-contact">${input.contactHtml ?? ''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end;">${input.chipsHtml ?? ''}</div>
      </div>` : ''}
    </div>`;
}

export interface CclTableColumn {
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

/** Tabela de itens da proposta: faixa de título + cabeçalho de colunas em ardósia suave. */
export function cclItemsTableHtml(input: {
  title: string;
  rightTitle?: string;
  columns: CclTableColumn[];
  rowsHtml: string;
}): string {
  const th = input.columns
    .map(
      (c) =>
        `<th${c.align && c.align !== 'left' ? ` class="ccl-${c.align}"` : ''}${c.width ? ` style="width:${c.width}"` : ''}>${c.label}</th>`
    )
    .join('');
  return `<div class="ccl-table-card">
      <div class="ccl-table-head"><span>${input.title}</span>${input.rightTitle ? `<span>${input.rightTitle}</span>` : ''}</div>
      <table class="ccl-table">
        <thead><tr>${th}</tr></thead>
        <tbody>${input.rowsHtml}</tbody>
      </table>
    </div>`;
}

/** Faixa de subtotais da proposta; a última célula é o total (verde, alinhado à direita). */
export function cclSummaryHtml(cells: { label: string; valueHtml: string; negative?: boolean }[], total: { label: string; valueHtml: string }): string {
  const cols = cells.length + 1;
  return `<div class="ccl-summary" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr));">
      ${cells
        .map(
          (c) => `<div><span class="ccl-label">${c.label}</span><strong class="ccl-value${c.negative ? ' ccl-negative' : ''}">${c.valueHtml}</strong></div>`
        )
        .join('')}
      <div class="ccl-right"><span class="ccl-total-label">${total.label}</span><span class="ccl-total-value">${total.valueHtml}</span></div>
    </div>`;
}

/** Rodapé de assinaturas da proposta (duas linhas de assinatura). */
export function cclSignatureFooterHtml(input: {
  title: string;
  textHtml?: string;
  left: { name: string; detail: string };
  right: { name: string; detail: string };
}): string {
  return `<div class="ccl-footer">
      <div class="ccl-sign-card">
        <div class="ccl-section-title" style="color:${C.slate800};margin-bottom:3px;">${input.title}</div>
        ${input.textHtml ? `<p class="ccl-text">${input.textHtml}</p>` : ''}
        <div class="ccl-sign-grid">
          <div class="ccl-sign"><b>${input.left.name}</b><span>${input.left.detail}</span></div>
          <div class="ccl-sign"><b>${input.right.name}</b><span>${input.right.detail}</span></div>
        </div>
      </div>
    </div>`;
}
