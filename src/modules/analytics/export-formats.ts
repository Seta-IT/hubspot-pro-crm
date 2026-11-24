// ============================================================================
// Fase 5: exportacao CSV / XLSX / PDF sem dependencias externas.
//  - CSV: UTF-8 com BOM, ";" (Excel pt-BR), protecao contra injecao de formula (= + - @ \t \r).
//  - XLSX: OOXML minimo (uma planilha, strings inline) num ZIP com deflate (zlib do Node).
//  - PDF: texto em Helvetica (WinAnsi, acentos do portugues), paginas A4 paisagem.
// ============================================================================
import zlib from 'node:zlib';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export interface ExportTable {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export function safeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(t: ExportTable): Buffer {
  const esc = (v: string | number | null) => {
    const s = safeCell(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.columns.map(esc).join(';'), ...t.rows.map((r) => r.map(esc).join(';'))];
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n'), 'utf8')]);
}

// --- ZIP --------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xmlEsc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function toXlsx(t: ExportTable): Buffer {
  const cell = (v: string | number | null, r: number, c: number, bold = false) => {
    const ref = `${colName(c)}${r}`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${bold ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(safeCell(v))}</t></is></c>`;
  };
  const head = [[t.title], ...(t.subtitle ? [[t.subtitle]] : []), []] as Array<Array<string | number | null>>;
  const all = [...head, t.columns, ...t.rows];
  const headerRow = head.length + 1;
  const sheetRows = all.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => cell(v, i + 1, j, i + 1 === headerRow || i === 0)).join('')}</row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Relatorio" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
  return buildZip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })));
}

// --- PDF --------------------------------------------------------------------
/** Converte para WinAnsi (Latin-1 cobre os acentos do portugues); o resto vira "?". */
function winAnsi(s: string): Buffer {
  const out: number[] = [];
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    out.push(code < 256 ? code : code === 0x2014 || code === 0x2013 ? 0x2d : 0x3f);
  }
  return Buffer.from(out);
}
const pdfStr = (s: string) => Buffer.concat([Buffer.from('('), Buffer.from(winAnsi(s).toString('latin1').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'), 'latin1'), Buffer.from(')')]);

export function toPdf(t: ExportTable): Buffer {
  const W = 842;
  const H = 595;
  const M = 36;
  const lineH = 12;
  const usable = W - 2 * M;
  const colW = usable / Math.max(1, t.columns.length);
  const maxChars = Math.max(4, Math.floor(colW / 4.6));
  const clip = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.length > maxChars ? `${s.slice(0, maxChars - 1)}.` : s;
  };
  const pages: Buffer[][] = [];
  let cur: Buffer[] = [];
  let y = H - M;
  const text = (x: number, yy: number, size: number, bold: boolean, s: string) =>
    cur.push(Buffer.from(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td `, 'latin1'), pdfStr(s), Buffer.from(' Tj ET\n', 'latin1'));
  const header = () => {
    text(M, y, 13, true, t.title);
    y -= 16;
    if (t.subtitle) {
      text(M, y, 9, false, t.subtitle);
      y -= 14;
    }
    t.columns.forEach((c, i) => text(M + i * colW, y, 8, true, clip(c)));
    y -= lineH;
  };
  header();
  for (const row of t.rows) {
    if (y < M + lineH) {
      pages.push(cur);
      cur = [];
      y = H - M;
      header();
    }
    row.forEach((v, i) => text(M + i * colW, y, 8, false, clip(v)));
    y -= lineH;
  }
  if (!t.rows.length) text(M, y, 9, false, 'Sem dados para os filtros escolhidos.');
  pages.push(cur);

  const objs: Buffer[] = [];
  const add = (b: Buffer | string) => objs.push(typeof b === 'string' ? Buffer.from(b, 'latin1') : b) && objs.length;
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  pages.forEach((p, i) => {
    const footer = Buffer.concat([Buffer.from(`BT /F1 8 Tf ${M} 20 Td `, 'latin1'), pdfStr(`STI-hub - página ${i + 1} de ${pages.length}`), Buffer.from(' Tj ET\n', 'latin1')]);
    const content = Buffer.concat([...p, footer]);
    const c = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, 'latin1');
  objs[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let len = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    len += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

export function renderExport(format: ExportFormat, t: ExportTable): { data: Buffer; mimeType: string; extension: string } {
  if (format === 'xlsx') return { data: toXlsx(t), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  if (format === 'pdf') return { data: toPdf(t), mimeType: 'application/pdf', extension: 'pdf' };
  return { data: toCsv(t), mimeType: 'text/csv; charset=utf-8', extension: 'csv' };
}
