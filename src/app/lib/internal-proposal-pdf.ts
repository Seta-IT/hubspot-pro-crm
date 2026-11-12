/**
 * Impressão e PDF da visão interna. O mesmo conteúdo da folha, sem botões,
 * sem barra de ações e sem observações internas.
 * A impressão segue o padrão das propostas/contratos: HTML A4 e window.print().
 */
import type { InternalProposalSummaryModel } from './internal-proposal-summary';
import { SETA_IT_LOGO_PDF } from './seta-it-logo-pdf';

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

/** HTML A4 da folha v3, sem botões e sem observações internas. */
export function buildInternalProposalPrintHtml(model: InternalProposalSummaryModel): string {
  const sheet = model.sheet;
  const logo = typeof window !== 'undefined' ? `${window.location.origin}/brand/seta-it-logo.png` : '/brand/seta-it-logo.png';
  const rows = sheet.lines
    .map(
      (line) =>
        `<tr><td>${line.index}</td><td>${escHtml(line.sku)}</td><td>${escHtml(line.name)}${line.detail ? `<br><small>${escHtml(line.detail)}</small>` : ''}</td><td class="c">${escHtml(line.unit)}</td><td class="r">${escHtml(line.qty)}</td><td class="r">${escHtml(line.unitPrice)}</td><td class="r">${escHtml(line.subtotal)}</td></tr>`
    )
    .join('');
  const pay = sheet.paymentRows
    .map(
      (row) =>
        `<tr><td>${escHtml(row.due)}</td><td class="r">${escHtml(row.amount)}</td><td class="${row.methodMissing ? 'muted' : ''}">${escHtml(row.method)}</td><td>${escHtml(row.note)}</td></tr>`
    )
    .join('');
  const clauses = [
    sheet.commercialNote ? `<p>${escHtml(sheet.commercialNote)}</p>` : '',
    `<p><b>CONFIDENCIALIDADE E CONDIÇÕES GERAIS</b> — ${escHtml(sheet.confidentiality)}</p>`,
    ...sheet.clauses.map((clause) => `<p><b>${escHtml(clause.title)}</b> — ${escHtml(clause.body)}</p>`),
  ].join('');
  const title = internalProposalPdfFileNameFromModel(model).replace(/\.pdf$/, '');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escHtml(title)}</title>
<style>
@page{size:A4;margin:8mm 9mm}
body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:10.5px;line-height:1.3}
.head{display:flex;justify-content:space-between;gap:12px;padding-bottom:7px;border-bottom:2px solid #1e3a6e}
.brand{display:flex;gap:10px;align-items:center}
.brand img{width:100px;height:32px}
h1{margin:0 0 1px;font-size:14px;color:#1e3a6e}
.l,.contact{font-size:10px;line-height:1.3}
.contact{text-align:right}
.contact strong,h1{color:#1e3a6e}
.docline{display:grid;grid-template-columns:1fr auto;margin-top:7px;padding:4px 10px;background:#eef2f8;border:1px solid #cdd7e6}
.docline .n{font-size:13px;font-weight:700;color:#1e3a6e;text-align:center}
.docline .d{font-size:12px;font-weight:700;color:#1e3a6e}
.contract{margin-top:4px;border:1px solid #cdd7e6;padding:4px 10px;display:flex;gap:8px;align-items:baseline}
.contract .k{font-weight:700;color:#1e3a6e;text-transform:uppercase;font-size:10px}
.blank{width:180px;border-bottom:1px solid #1f2937;height:12px}
.hint{color:#6b7280;font-size:10px}
.top2{display:grid;grid-template-columns:205px 1fr;gap:12px;margin-top:7px}
.rental b{color:#1e3a6e}
.notes p{margin:0 0 2px}
.sec{margin-top:6px}
.t{background:#eef2f8;border:1px solid #cdd7e6;border-bottom:0;color:#1e3a6e;font-weight:700;padding:3px 7px}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #cdd7e6;padding:2px 6px;vertical-align:top}
th{background:#fafbfd;font-size:9.5px;text-transform:uppercase;text-align:left}
.r{text-align:right;white-space:nowrap}.c{text-align:center}
.k{font-weight:700;background:#fafbfd;white-space:nowrap}
.muted{color:#9ca3af}
.val{display:grid;grid-template-columns:1fr 1fr;border:1px solid #cdd7e6;margin-top:6px}
.val div{padding:3px 8px;font-weight:700}
.val div+div{border-left:1px solid #cdd7e6}
.sum{margin-left:auto;width:270px;border:1px solid #cdd7e6;border-top:0}
.sum div{display:flex;justify-content:space-between;padding:2px 8px;border-top:1px solid #e5eaf2}
.sum .g{font-weight:700;color:#1e3a6e}
.obs{border:1px solid #cdd7e6;padding:5px 8px;font-size:10px;line-height:1.28;column-count:2;column-gap:14px}
.obs p{margin:0 0 3px}
.sign{margin-top:6px;border:1px solid #cdd7e6;padding:18px 0 4px;text-align:center}
.ln{width:300px;margin:0 auto 4px;border-top:1px solid #1f2937}
.foot{margin-top:4px;text-align:right;font-size:9.5px;color:#6b7280}
</style></head><body>
<header class="head"><div class="brand"><img src="${escHtml(logo)}" alt="SETA | IT"><div><h1>${escHtml(sheetTitle(sheet))}</h1><div class="l">${escHtml(sheet.issuerLegalName)}</div><div class="l">CNPJ: ${escHtml(sheet.issuerCnpj)}</div><div class="l">${escHtml(sheet.issuerStreet)}</div><div class="l">${escHtml(sheet.issuerCity)}</div></div></div>
<div class="contact">${sheet.issuerPhone ? `<div><strong>${escHtml(sheet.issuerPhone)}</strong></div>` : ''}${sheet.issuerEmail ? `<div><strong>${escHtml(sheet.issuerEmail)}</strong></div>` : ''}${sheet.sellerName ? `<div>Vendedor: <strong>${escHtml(sheet.sellerName)}</strong></div>` : ''}</div></header>
<div class="docline"><div class="n">ORÇAMENTO Nº ${escHtml(sheet.budgetNumber)}</div><div class="d">${escHtml(sheet.proposalDateLabel)}</div></div>
<div class="contract"><span class="k">Nº do contrato:</span>${sheet.contractNumber ? `<strong>${escHtml(sheet.contractNumber)}</strong>` : '<span class="blank"></span><span class="hint">preenchido quando a proposta for convertida em contrato de locação</span>'}</div>
<div class="top2"><section class="rental"><div><b>${escHtml(sheet.headline)}</b></div><div>${escHtml(sheet.monthlyLine)}</div><div>${escHtml(sheet.deliveryLine)}</div>${sheet.freightLine ? `<div>${escHtml(sheet.freightLine)}</div>` : ''}${sheet.slaLine ? `<div>${escHtml(sheet.slaLine)}</div>` : ''}<div>${escHtml(sheet.readjustmentLine)}</div></section>
<section class="notes">${sheet.notices.map((note) => `<p>› ${escHtml(note)}</p>`).join('')}</section></div>
<div class="val"><div>${escHtml(sheet.validityLine)}</div><div>${escHtml(sheet.deliveryForecastLine)}</div></div>
<section class="sec"><div class="t">DADOS DO CLIENTE</div><table><tr><td class="k">Razão social:</td><td>${escHtml(sheet.clientLegalName)}</td><td class="k">Nome fantasia:</td><td>${escHtml(sheet.clientTradeName)}</td></tr><tr><td class="k">CNPJ/CPF:</td><td>${escHtml(sheet.clientCnpj)}</td><td class="k">Endereço:</td><td>${escHtml(sheet.clientAddress)}</td></tr><tr><td class="k">CEP:</td><td>${escHtml(sheet.clientCep)}</td><td class="k">Cidade/UF:</td><td>${escHtml(sheet.clientCityUf)}</td></tr><tr><td class="k">Telefone:</td><td>${escHtml(sheet.clientPhone)}</td><td class="k">E-mail:</td><td>${escHtml(sheet.clientEmail)}</td></tr></table></section>
<section class="sec"><div class="t">${escHtml(sheet.itemsSection)}</div><table><thead><tr><th>Item</th><th>Código</th><th>Nome</th><th class="c">Und.</th><th class="r">Qtd.</th><th class="r">Vr. unit. mensal</th><th class="r">Subtotal mensal</th></tr></thead><tbody>${rows}<tr><td colspan="4"><b>TOTAL</b></td><td class="r"><b>${escHtml(sheet.qtyTotal)}</b></td><td></td><td class="r"><b>${escHtml(sheet.monthlyPlain)}</b></td></tr></tbody></table>
<div class="sum"><div><span>${escHtml(sheet.itemsSection)} (mensal):</span><span>${escHtml(sheet.productsMonthly)}</span></div>${sheet.showFreight ? `<div><span>FRETE (pagamento único):</span><span>${escHtml(sheet.freightAmount)}</span></div>` : ''}<div class="g"><span>TOTAL MENSAL:</span><span>${escHtml(sheet.totalMonthly)}</span></div></div></section>
<section class="sec"><div class="t">DADOS DO PAGAMENTO</div><table><thead><tr><th>Vencimento</th><th class="r">Valor</th><th>Forma de pagamento</th><th>Observação</th></tr></thead><tbody>${pay}</tbody></table></section>
<section class="sec"><div class="t">OBSERVAÇÕES</div><div class="obs">${clauses}</div></section>
<section class="sign"><div class="ln"></div>Assinatura do cliente</section>
<div class="foot">Orçamento Nº ${escHtml(sheet.budgetNumber)} · ${escHtml(sheet.brandTitle)}</div>
</body></html>`;
}

function sheetTitle(sheet: InternalProposalSummaryModel['sheet']): string {
  return sheet.brandTitle;
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

/** Bytes WinAnsi que não coincidem com o ponto Unicode (travessão, aspas, euro). */
const WINANSI_EXTRA: Record<string, number> = {
  '\u20AC': 0x80,
  '\u201A': 0x82,
  '\u0192': 0x83,
  '\u201E': 0x84,
  '\u2026': 0x85,
  '\u2020': 0x86,
  '\u2021': 0x87,
  '\u02C6': 0x88,
  '\u2030': 0x89,
  '\u0160': 0x8a,
  '\u2039': 0x8b,
  '\u0152': 0x8c,
  '\u017D': 0x8e,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201C': 0x93,
  '\u201D': 0x94,
  '\u2022': 0x95,
  '\u2013': 0x96,
  '\u2014': 0x97,
  '\u02DC': 0x98,
  '\u2122': 0x99,
  '\u0161': 0x9a,
  '\u203A': 0x9b,
  '\u0153': 0x9c,
  '\u017E': 0x9e,
  '\u0178': 0x9f,
};

/**
 * Helvetica padrão só desenha acentos se o dicionário da fonte declarar
 * WinAnsiEncoding. Sem isso o leitor usa StandardEncoding e á/ã/ç viram Æ, º etc.
 * O espaço de "R$ 4.490,00" no pt-BR é U+00A0; aqui vira espaço comum para o texto extraído.
 */
function winAnsi(value: string): string {
  const src = String(value || '')
    .normalize('NFC')
    .replace(/[\u00A0\u202F]/g, ' ');
  let out = '';
  for (const ch of src) {
    if (ch === '\\' || ch === '(' || ch === ')') {
      out += `\\${ch}`;
      continue;
    }
    const cp = ch.codePointAt(0) || 0;
    if (cp >= 32 && cp <= 255) {
      out += ch;
      continue;
    }
    const mapped = WINANSI_EXTRA[ch];
    out += mapped === undefined ? '?' : String.fromCharCode(mapped);
  }
  return out;
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

  const sheet = model.sheet;
  y = PAGE_H - 28;
  const logoW = 78;
  const logoH = (logoW * SETA_IT_LOGO_PDF.height) / SETA_IT_LOGO_PDF.width;
  ops.push(`q ${logoW.toFixed(2)} 0 0 ${logoH.toFixed(2)} ${left.toFixed(2)} ${(y - 14).toFixed(2)} cm /Im1 Do Q`);
  const brandX = left + logoW + 8;
  text(brandX, y, 11, sheet.brandTitle, 'F2', NAVY);
  text(brandX, y - 12, 8, sheet.issuerLegalName, 'F1', INK);
  text(brandX, y - 22, 8, `CNPJ: ${sheet.issuerCnpj}`, 'F1', INK);
  text(brandX, y - 32, 7, sheet.issuerStreet, 'F1', INK);
  text(brandX, y - 42, 7, sheet.issuerCity, 'F1', INK);
  if (sheet.issuerPhone) text(right - 180, y, 8, sheet.issuerPhone, 'F2', NAVY);
  if (sheet.issuerEmail) text(right - 180, y - 11, 7, sheet.issuerEmail, 'F2', NAVY);
  if (sheet.sellerName) text(right - 180, y - 22, 7, `Vendedor: ${sheet.sellerName}`, 'F1', INK);
  ops.push(`${NAVY} RG 1.2 w ${left.toFixed(2)} ${(y - 50).toFixed(2)} ${width.toFixed(2)} 0 re S`);
  y -= 66;
  rect(left, y - 4, width, 16, '0.933 0.949 0.973');
  text(left + 140, y, 9, `ORÇAMENTO Nº ${sheet.budgetNumber}`, 'F2', NAVY);
  text(right - 70, y, 8, sheet.proposalDateLabel, 'F2', NAVY);
  y -= 18;
  ops.push(`0.804 0.843 0.902 RG 0.6 w ${left.toFixed(2)} ${(y - 4).toFixed(2)} ${width.toFixed(2)} 14 re S`);
  text(left + 4, y, 7, 'Nº DO CONTRATO:', 'F2', NAVY);
  if (sheet.contractNumber) text(left + 90, y, 8, sheet.contractNumber, 'F2', INK);
  else {
    ops.push(`0.12 0.16 0.22 RG 0.6 w ${(left + 92).toFixed(2)} ${(y - 2).toFixed(2)} 140 0 re S`);
    text(left + 240, y, 6, 'preenchido quando a proposta for convertida em contrato de locação', 'F1', SLATE);
  }
  y -= 16;
  text(left, y, 8, sheet.headline, 'F2', NAVY);
  gap(10);
  text(left, y, 7, sheet.monthlyLine, 'F1', INK);
  gap(9);
  text(left, y, 7, sheet.deliveryLine, 'F1', INK);
  if (sheet.freightLine) { gap(9); text(left, y, 7, sheet.freightLine, 'F1', INK); }
  if (sheet.slaLine) { gap(9); text(left, y, 7, wrap(sheet.slaLine, 7, 190)[0], 'F1', INK); }
  gap(9);
  text(left, y, 7, sheet.readjustmentLine, 'F1', INK);
  let noteY = y + 36;
  for (const note of sheet.notices) {
    const bits = wrap(`› ${note}`, 6.5, 330);
    for (const bit of bits) {
      text(left + 200, noteY, 6.5, bit, 'F1', INK);
      noteY -= 8;
    }
  }
  y = Math.min(y, noteY) - 8;
  rect(left, y - 3, width, 12, '0.933 0.949 0.973');
  text(left + 4, y, 7, sheet.validityLine, 'F2', INK);
  text(left + 280, y, 7, sheet.deliveryForecastLine, 'F2', INK);
  y -= 16;
  text(left + 4, y, 8, 'DADOS DO CLIENTE', 'F2', NAVY);
  y -= 4;
  const clientRows: Array<[string, string, string, string]> = [
    ['Razão social:', sheet.clientLegalName, 'Nome fantasia:', sheet.clientTradeName],
    ['CNPJ/CPF:', sheet.clientCnpj, 'Endereço:', sheet.clientAddress],
    ['CEP:', sheet.clientCep, 'Cidade/UF:', sheet.clientCityUf],
    ['Telefone:', sheet.clientPhone, 'E-mail:', sheet.clientEmail],
  ];
  for (const row of clientRows) {
    y -= 11;
    text(left + 2, y, 6.5, row[0], 'F2', INK);
    text(left + 62, y, 6.5, wrap(row[1], 6.5, 160)[0], 'F1', INK);
    text(left + 250, y, 6.5, row[2], 'F2', INK);
    text(left + 320, y, 6.5, wrap(row[3], 6.5, 180)[0], 'F1', INK);
  }
  y -= 14;
  text(left + 4, y, 8, sheet.itemsSection, 'F2', NAVY);
  y -= 11;
  text(left, y, 6, 'ITEM  CÓDIGO', 'F2', INK);
  text(left + 110, y, 6, 'NOME', 'F2', INK);
  text(left + 300, y, 6, 'UND.', 'F2', INK);
  text(left + 340, y, 6, 'QTD.', 'F2', INK);
  text(left + 390, y, 6, 'VR. UNIT.', 'F2', INK);
  text(left + 460, y, 6, 'SUBTOTAL', 'F2', INK);
  for (const line of sheet.lines) {
    y -= 11;
    text(left, y, 6.5, String(line.index), 'F1', INK);
    text(left + 18, y, 6.5, line.sku, 'F1', INK);
    text(left + 90, y, 6.5, wrap(line.name, 6.5, 200)[0], 'F1', INK);
    text(left + 300, y, 6.5, line.unit, 'F1', INK);
    text(left + 340, y, 6.5, line.qty, 'F1', INK);
    text(left + 390, y, 6.5, line.unitPrice, 'F1', INK);
    text(left + 460, y, 6.5, line.subtotal, 'F1', INK);
  }
  y -= 11;
  text(left, y, 7, 'TOTAL', 'F2', INK);
  text(left + 340, y, 7, sheet.qtyTotal, 'F2', INK);
  text(left + 460, y, 7, sheet.monthlyPlain, 'F2', INK);
  y -= 12;
  ops.push(`0.804 0.843 0.902 RG 0.6 w ${(left + 300).toFixed(2)} ${(y - 4).toFixed(2)} ${(width - 300).toFixed(2)} ${sheet.showFreight ? 28 : 18} re S`);
  text(left + 304, y, 7, `${sheet.itemsSection} (mensal):`, 'F1', INK);
  text(left + 460, y, 7, sheet.productsMonthly, 'F1', INK);
  if (sheet.showFreight) {
    y -= 10;
    text(left + 304, y, 7, 'FRETE (pagamento único):', 'F1', INK);
    text(left + 460, y, 7, sheet.freightAmount, 'F1', INK);
  }
  y -= 10;
  text(left + 304, y, 7, 'TOTAL MENSAL:', 'F2', NAVY);
  text(left + 460, y, 7, sheet.totalMonthly, 'F2', NAVY);
  y -= 14;
  text(left + 4, y, 8, 'DADOS DO PAGAMENTO', 'F2', NAVY);
  for (const row of sheet.paymentRows) {
    y -= 10;
    text(left, y, 6.5, row.due, 'F1', INK);
    text(left + 150, y, 6.5, row.amount, 'F1', INK);
    text(left + 230, y, 6.5, row.method, 'F1', INK);
    text(left + 340, y, 6.5, wrap(row.note, 6.5, 180)[0], 'F1', INK);
  }
  y -= 14;
  text(left + 4, y, 8, 'OBSERVAÇÕES', 'F2', NAVY);
  y -= 9;
  const obs: string[] = [];
  if (sheet.commercialNote) obs.push(sheet.commercialNote);
  obs.push(`CONFIDENCIALIDADE E CONDIÇÕES GERAIS — ${sheet.confidentiality}`);
  for (const clause of sheet.clauses) obs.push(`${clause.title} — ${clause.body}`);
  const leftCol = obs.slice(0, Math.ceil(obs.length / 2));
  const rightCol = obs.slice(Math.ceil(obs.length / 2));
  const paintCol = (x: number, start: number, parts: string[]) => {
    let cy = start;
    for (const part of parts) {
      for (const bit of wrap(part, 6, 250)) {
        text(x, cy, 6, bit, 'F1', INK);
        cy -= 7;
      }
      cy -= 2;
    }
    return cy;
  };
  const endL = paintCol(left, y, leftCol);
  const endR = paintCol(left + 270, y, rightCol);
  y = Math.min(endL, endR) - 8;
  ops.push(`0.12 0.16 0.22 RG 0.6 w ${(left + 150).toFixed(2)} ${y.toFixed(2)} 200 0 re S`);
  y -= 10;
  text(left + 190, y, 7, 'Assinatura do cliente', 'F1', INK);
  y -= 12;
  text(right - 180, y, 7, `Orçamento Nº ${sheet.budgetNumber} · ${sheet.brandTitle}`, 'F1', SLATE);

  const stream = ops.join('\n') + '\n';
  const logo = decodeBase64(SETA_IT_LOGO_PDF.flateBase64);
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im1 7 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${latin1Bytes(stream).length} >> stream\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n',
    '6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj\n',
    `7 0 obj << /Type /XObject /Subtype /Image /Width ${SETA_IT_LOGO_PDF.width} /Height ${SETA_IT_LOGO_PDF.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${logo.length} >> stream\n`,
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
  pushObj(objects[6], logo, '\nendstream\nendobj\n');
  const xrefAt = cursor;
  let xref = `xref\n0 8\n0000000000 65535 f \n`;
  for (let i = 1; i <= 7; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer << /Size 8 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
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

function decodeBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
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
