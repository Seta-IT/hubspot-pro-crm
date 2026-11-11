/**
 * Impressão e PDF da visão interna. O mesmo conteúdo da folha, sem botões,
 * sem barra de ações e sem observações internas.
 * A impressão segue o padrão das propostas/contratos: HTML A4 e window.print().
 */
import type { InternalProposalSummaryModel } from './internal-proposal-summary';

export function internalProposalPdfFileName(code: string, companyName: string): string {
  const safeCode = String(code || '').replace(/^#/, '').trim().replace(/[^\w.-]+/g, '') || 'sem-codigo';
  const client = String(companyName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '');
  return `Proposta-${safeCode}-${client || 'Cliente'}.pdf`;
}

export function internalProposalPdfFileNameFromModel(model: InternalProposalSummaryModel): string {
  return internalProposalPdfFileName(model.codeLabel, model.companyName);
}

function escHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML A4 da folha, sem observações internas e sem botões. */
export function buildInternalProposalPrintHtml(model: InternalProposalSummaryModel): string {
  const rows = model.lines
    .map(
      (line) =>
        `<tr><td>${escHtml(line.description)}${line.detail ? `<div class="detail">${escHtml(line.detail)}</div>` : ''}</td><td class="num">${escHtml(line.quantityLabel)}</td><td class="num">${escHtml(line.unitLabel)}</td><td class="num strong">${escHtml(line.lineLabel)}</td></tr>`
    )
    .join('');
  const oneTime = model.oneTimeRows.length
    ? `<section class="box"><h3>Valores únicos</h3><p class="hint">${escHtml(model.oneTimeCaption)}</p>${model.oneTimeRows
        .map((row) => `<div class="pair"><span>${escHtml(row.label)}</span><strong>${escHtml(row.value)}</strong></div>`)
        .join('')}</section>`
    : '';
  const conditions = model.conditions
    .map((c) => `<div class="cond"><div class="k">${escHtml(c.label)}</div><div>${escHtml(c.value)}</div></div>`)
    .join('');
  const title = internalProposalPdfFileNameFromModel(model).replace(/\.pdf$/, '');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escHtml(title)}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 12px; }
header { background: #1e3a6e; color: #fff; padding: 16px 22px; }
.eyebrow { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; opacity: .75; margin: 0; }
h1 { font-size: 18px; margin: 4px 0 0; font-weight: 600; }
.kind { margin: 0; font-size: 11px; opacity: .85; }
article { border: 1px solid #e2e8f0; }
.pad { padding: 16px 22px; }
.code { color: #1e3a6e; font-size: 26px; font-weight: 600; margin: 2px 0; }
.muted { color: #64748b; font-size: 11px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1.1fr; gap: 8px; margin-top: 12px; }
.card { border: 1px solid #e2e8f0; background: #f8fafc; padding: 8px 10px; }
.k { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: #64748b; font-weight: 600; }
.total { background: #1e3a6e; color: #fff; padding: 8px 10px; }
.total .k { color: rgba(255,255,255,.75); }
.total strong { font-size: 18px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th { background: #1e3a6e; color: #fff; text-align: left; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; padding: 6px 8px; }
td { border-top: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; }
.num { text-align: right; white-space: nowrap; }
.strong { font-weight: 700; }
.detail { color: #64748b; font-size: 10px; }
.box { border: 1px solid #e2e8f0; padding: 8px 10px; margin-top: 10px; }
.hint { color: #64748b; font-size: 10px; margin: 2px 0 6px; }
.pair { display: flex; justify-content: space-between; border-top: 1px solid #f1f5f9; padding: 4px 0; }
.conds { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #e2e8f0; border: 1px solid #e2e8f0; margin-top: 6px; }
.cond { background: #fff; padding: 8px 10px; }
footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 10px 22px; font-size: 10px; color: #1e3a6e; word-break: break-all; }
h3 { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: #64748b; margin: 14px 0 0; }
</style></head><body>
<article>
<header>
  <p class="eyebrow">STI-hub · Seta Telecom</p>
  <h1>Visão interna do orçamento</h1>
  <p class="kind">${escHtml(model.kindLabel)} · para o contrato</p>
</header>
<div class="pad">
  <div class="k">Orçamento</div>
  <div class="code">${escHtml(model.codeLabel)}</div>
  <div class="muted">${escHtml(model.versionLabel)} · ${escHtml(model.statusLabel)}</div>
  <h2 style="font-size:14px;margin:12px 0 0">${escHtml(model.title)}</h2>
  <div class="grid2">
    <div class="card"><div class="k">Cliente</div><strong>${escHtml(model.companyName)}</strong>${model.careOf ? `<div class="muted">A/C ${escHtml(model.careOf)}</div>` : ''}</div>
    <div class="card"><div class="k">CNPJ</div><strong>${escHtml(model.companyCnpj)}</strong></div>
  </div>
  <div class="grid3">
    <div class="card"><div class="k">${escHtml(model.termLabel)}</div><strong>${escHtml(model.termValue)}</strong></div>
    <div class="card"><div class="k">Valor mensal</div><strong>${escHtml(model.monthlyLabel)}</strong></div>
    <div class="total"><div class="k">${escHtml(model.periodLabel)}</div><strong>${escHtml(model.periodValue)}</strong></div>
  </div>
  ${model.scopeLabel ? `<p><span class="k">Escopo · </span>${escHtml(model.scopeLabel)}</p>` : ''}
  <h3>${escHtml(model.itemsHeading)}</h3>
  <table><thead><tr><th>${escHtml(model.itemColumn)}</th><th class="num">Qtd</th><th class="num">${escHtml(model.unitColumn)}</th><th class="num">${escHtml(model.lineColumn)}</th></tr></thead><tbody>${rows}</tbody></table>
  ${oneTime}
  <h3>Condições</h3>
  <div class="conds">${conditions}</div>
</div>
<footer><div class="k">Link interno estável</div>${escHtml(model.stableUrl)}</footer>
</article>
</body></html>`;
}

export function printInternalProposal(model: InternalProposalSummaryModel): void {
  if (typeof window === 'undefined') return;
  const html = buildInternalProposalPrintHtml(model);
  const opened = window.open('', '_blank');
  if (opened) {
    opened.document.open();
    opened.document.write(html);
    opened.document.close();
    opened.focus();
    setTimeout(() => opened.print(), 300);
    return;
  }
  window.print();
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const NAVY = '0.118 0.227 0.431';
const SLATE = '0.392 0.455 0.545';
const INK = '0.118 0.161 0.231';

function winAnsi(value: string): string {
  return String(value || '')
    .normalize('NFC')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, '?');
}

function wrap(text: string, size: number, width: number): string[] {
  const max = Math.max(8, Math.floor(width / (size * 0.5)));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** PDF A4 com o conteúdo da folha. Não inclui observações internas. */
export function buildInternalProposalPdf(model: InternalProposalSummaryModel): Uint8Array {
  const ops: string[] = [];
  let y = PAGE_H - 36;
  const left = 36;
  const right = PAGE_W - 36;
  const width = right - left;
  const text = (x: number, yy: number, size: number, value: string, font: 'F1' | 'F2', color: string) => {
    ops.push(`BT /${font} ${size} Tf ${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td (${winAnsi(value)}) Tj ET`);
  };
  const rect = (x: number, yy: number, w: number, h: number, color: string) => {
    ops.push(`${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };
  const gap = (n = 14) => {
    y -= n;
  };

  rect(0, PAGE_H - 64, PAGE_W, 64, NAVY);
  text(left, PAGE_H - 28, 8, 'STI-HUB  ·  SETA TELECOM', 'F1', '1 1 1');
  text(left, PAGE_H - 46, 14, 'Visão interna do orçamento', 'F2', '1 1 1');
  text(right - 210, PAGE_H - 46, 8, `${model.kindLabel} · para o contrato`, 'F1', '1 1 1');
  y = PAGE_H - 86;
  text(left, y, 8, 'ORÇAMENTO', 'F2', SLATE);
  gap(22);
  text(left, y, 20, model.codeLabel, 'F2', NAVY);
  text(right - 80, y, 9, model.statusLabel, 'F2', NAVY);
  gap(14);
  text(left, y, 9, model.versionLabel, 'F1', SLATE);
  gap(18);
  for (const line of wrap(model.title, 11, width)) {
    text(left, y, 11, line, 'F2', INK);
    gap(14);
  }
  gap(4);
  rect(left, y - 28, width / 2 - 4, 36, '0.973 0.980 0.988');
  rect(left + width / 2 + 4, y - 28, width / 2 - 4, 36, '0.973 0.980 0.988');
  text(left + 8, y - 8, 7, 'CLIENTE', 'F2', SLATE);
  text(left + 8, y - 22, 9, wrap(model.companyName, 9, width / 2 - 20)[0], 'F2', INK);
  text(left + width / 2 + 12, y - 8, 7, 'CNPJ', 'F2', SLATE);
  text(left + width / 2 + 12, y - 22, 9, model.companyCnpj, 'F2', INK);
  y -= 44;
  const col = (width - 8) / 3;
  rect(left, y - 26, col, 34, '1 1 1');
  rect(left + col + 4, y - 26, col, 34, '1 1 1');
  rect(left + (col + 4) * 2, y - 26, col, 34, NAVY);
  text(left + 6, y - 6, 7, model.termLabel.toUpperCase(), 'F2', SLATE);
  text(left + 6, y - 20, 11, model.termValue, 'F2', NAVY);
  text(left + col + 10, y - 6, 7, 'VALOR MENSAL', 'F2', SLATE);
  text(left + col + 10, y - 20, 11, model.monthlyLabel, 'F2', NAVY);
  text(left + (col + 4) * 2 + 6, y - 6, 7, model.periodLabel.toUpperCase(), 'F2', '1 1 1');
  text(left + (col + 4) * 2 + 6, y - 20, 11, model.periodValue, 'F2', '1 1 1');
  y -= 46;
  text(left, y, 8, model.itemsHeading.toUpperCase(), 'F2', SLATE);
  gap(8);
  rect(left, y - 14, width, 16, NAVY);
  text(left + 6, y - 10, 7, model.itemColumn.toUpperCase(), 'F2', '1 1 1');
  text(left + 280, y - 10, 7, 'QTD', 'F2', '1 1 1');
  text(left + 330, y - 10, 7, model.unitColumn.toUpperCase(), 'F2', '1 1 1');
  text(left + 450, y - 10, 7, model.lineColumn.toUpperCase(), 'F2', '1 1 1');
  y -= 18;
  for (const line of model.lines) {
    const desc = wrap(line.description, 9, 260);
    const h = Math.max(16, desc.length * 12 + 4);
    desc.forEach((part, i) => text(left + 6, y - 12 - i * 11, 9, part, 'F1', INK));
    text(left + 280, y - 12, 9, line.quantityLabel, 'F1', INK);
    text(left + 330, y - 12, 9, line.unitLabel, 'F1', INK);
    text(left + 450, y - 12, 9, line.lineLabel, 'F2', INK);
    y -= h;
  }
  if (model.oneTimeRows.length) {
    gap(8);
    text(left, y, 8, 'VALORES ÚNICOS', 'F2', SLATE);
    gap(12);
    text(left, y, 8, model.oneTimeCaption, 'F1', SLATE);
    gap(12);
    for (const row of model.oneTimeRows) {
      text(left, y, 9, row.label, 'F1', SLATE);
      text(left + 420, y, 9, row.value, 'F2', INK);
      gap(14);
    }
  }
  gap(8);
  text(left, y, 8, 'CONDIÇÕES', 'F2', SLATE);
  gap(14);
  for (let i = 0; i < model.conditions.length; i += 2) {
    const a = model.conditions[i];
    const b = model.conditions[i + 1];
    text(left, y, 7, a.label.toUpperCase(), 'F2', SLATE);
    if (b) text(left + 270, y, 7, b.label.toUpperCase(), 'F2', SLATE);
    gap(12);
    for (const part of wrap(a.value, 9, 250)) {
      text(left, y, 9, part, 'F1', INK);
      gap(11);
    }
    if (b) {
      let by = y + 11;
      for (const part of wrap(b.value, 9, 250)) {
        text(left + 270, by, 9, part, 'F1', INK);
        by -= 11;
      }
    }
    gap(6);
  }
  gap(8);
  text(left, y, 7, 'LINK INTERNO ESTÁVEL', 'F2', SLATE);
  gap(12);
  text(left, y, 8, model.stableUrl, 'F1', NAVY);

  const stream = ops.join('\n') + '\n';
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${latin1Bytes(stream).length} >> stream\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    '6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n',
  ];
  const chunks: Uint8Array[] = [latin1Bytes('%PDF-1.4\n')];
  const offsets: number[] = [0];
  let cursor = chunks[0].length;
  const pushObj = (head: string, body?: Uint8Array, tail?: string) => {
    offsets.push(cursor);
    const h = latin1Bytes(head);
    chunks.push(h);
    cursor += h.length;
    if (body) {
      chunks.push(body);
      cursor += body.length;
      const t = latin1Bytes(tail || '');
      chunks.push(t);
      cursor += t.length;
    }
  };
  pushObj(objects[0]);
  pushObj(objects[1]);
  pushObj(objects[2]);
  pushObj(objects[3], latin1Bytes(stream), 'endstream\nendobj\n');
  pushObj(objects[4]);
  pushObj(objects[5]);
  const xrefAt = cursor;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer << /Size 7 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  chunks.push(latin1Bytes(xref));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function latin1Bytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

export function downloadInternalProposalPdf(model: InternalProposalSummaryModel): string {
  const name = internalProposalPdfFileNameFromModel(model);
  const bytes = buildInternalProposalPdf(model);
  if (typeof document === 'undefined') return name;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
