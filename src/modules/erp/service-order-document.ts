// ============================================================================
// STI-hub - Documento da Ordem de Servico (OS) em PDF A4.
// Mesmo gerador sem dependencias usado no PDF da proposta interna (Helvetica com
// WinAnsiEncoding), com quebra automatica de pagina para interacoes longas.
// Emissor: sempre o cadastro da empresa emissora (Dados da Empresa / Emitente).
// Trava Fiscal: o CNPJ do emissor nunca vem do cliente nem do chamado; os dois
// CNPJs aparecem em blocos separados e nunca sao mesclados.
// Interacoes: so as publicas (visiveis ao cliente). Notas internas nunca entram.
// ============================================================================
import type { ErpServiceOrder, ErpServiceOrderDocumentEntry, ServiceTicket } from '../../db/types';

export interface ServiceOrderIssuer {
  legalName: string;
  cnpj: string;
  addressLine: string;
  phone: string;
  email: string;
}

export interface ServiceOrderIssuerSource {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
  phone?: string;
  financialEmail?: string;
}

export interface ServiceOrderInteraction {
  at: string;
  author: string;
  text: string;
}

export interface ServiceOrderDocumentModel {
  issuer: ServiceOrderIssuer;
  osCode: string;
  osId: string;
  status: string;
  priority: string;
  customerName: string;
  customerCnpj: string;
  ticketKey: string;
  ticketSubject: string;
  equipment: string;
  serialNumber: string;
  reportedDefect: string;
  interactions: ServiceOrderInteraction[];
  validatedSolution: string;
  technician: string;
  entryDate: string;
  exitDate: string;
  openedAt: string;
  resolvedAt: string;
  generatedAt: string;
  accessUrl: string;
  /** Rotulo exibido no topo quando os dados sao de exemplo. */
  sampleLabel?: string;
}

export type ServiceOrderDocumentEntry = ErpServiceOrderDocumentEntry;

export const SERVICE_ORDER_HISTORY_MAX = 50;
const NOT_INFORMED = 'Não informado';

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

/** Emissor a partir do cadastro (nunca do cliente). */
export function serviceOrderIssuerFromEmitter(src: ServiceOrderIssuerSource): ServiceOrderIssuer {
  const street = [clean(src.addressStreet), clean(src.addressNumber)].filter(Boolean).join(', ');
  const parts = [
    street,
    clean(src.addressComplement),
    clean(src.neighborhood),
    [clean(src.city), clean(src.state)].filter(Boolean).join('/'),
    clean(src.cep) ? `CEP ${clean(src.cep)}` : '',
  ].filter(Boolean);
  return {
    legalName: clean(src.legalName) || clean(src.tradeName),
    cnpj: clean(src.cnpj),
    addressLine: parts.join(' - '),
    phone: clean(src.phone),
    email: clean(src.financialEmail),
  };
}

export function serviceOrderInternalPath(osId: string): string {
  return `/interno/os/${encodeURIComponent(String(osId || '').trim())}`;
}

export function serviceOrderPdfFileName(code: string, customerName: string): string {
  const safeCode = String(code || '').replace(/^#/, '').trim().replace(/[^\w.-]+/g, '') || 'sem-numero';
  const client = String(customerName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '');
  return `OS-${safeCode}-${client || 'Cliente'}.pdf`;
}

/** Chamado vinculado a OS (o chamado guarda o id ou o numero da OS). */
export function findTicketForServiceOrder(
  os: Pick<ErpServiceOrder, 'id' | 'code'>,
  tickets: ServiceTicket[]
): ServiceTicket | undefined {
  return tickets.find((t) => t && t.serviceOrderId && (t.serviceOrderId === os.id || t.serviceOrderId === os.code));
}

function formatDateTimeBr(iso: string): string {
  const raw = clean(iso);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function buildServiceOrderDocumentModel(input: {
  serviceOrder: ErpServiceOrder;
  ticket?: ServiceTicket | null;
  issuer: ServiceOrderIssuer;
  customerCnpj?: string | null;
  origin?: string;
  now?: Date;
  sampleLabel?: string;
}): ServiceOrderDocumentModel {
  const os = input.serviceOrder;
  const ticket = input.ticket || null;
  const issuer = { ...input.issuer };
  let customerCnpj = clean(input.customerCnpj);
  // Trava Fiscal: se o CNPJ do cliente coincidir com o do emissor, nao repete o do
  // emissor como se fosse do cliente (cadastro trocado). Mostra "nao informado".
  if (customerCnpj && digits(customerCnpj) === digits(issuer.cnpj)) customerCnpj = '';
  const interactions: ServiceOrderInteraction[] = (ticket?.comments || [])
    .filter((c) => c && !c.isInternal && clean(c.body))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((c) => ({ at: formatDateTimeBr(c.createdAt), author: clean(c.author) || (c.authorRole === 'CUSTOMER' ? 'Cliente' : 'Equipe técnica'), text: String(c.body || '').trim() }));
  const origin = clean(input.origin).replace(/\/+$/, '');
  const path = serviceOrderInternalPath(os.id);
  return {
    issuer,
    osCode: clean(os.code),
    osId: os.id,
    status: clean(os.status) || NOT_INFORMED,
    priority: clean(os.priority) || 'NORMAL',
    customerName: clean(os.companyName) || NOT_INFORMED,
    customerCnpj: customerCnpj || NOT_INFORMED,
    ticketKey: clean(ticket?.key),
    ticketSubject: clean(ticket?.subject),
    equipment: clean(os.equipmentName) || NOT_INFORMED,
    serialNumber: clean(os.serialNumber) || clean(ticket?.equipmentSerial) || NOT_INFORMED,
    reportedDefect: String(ticket?.description || os.description || '').trim() || NOT_INFORMED,
    interactions,
    validatedSolution: String(ticket?.resolution || os.technicalReport || '').trim() || 'Ainda não validada',
    technician: clean(ticket?.assigneeAgent) || clean(os.technicianName) || NOT_INFORMED,
    entryDate: clean(os.entryDate) || NOT_INFORMED,
    exitDate: clean(os.exitDate) && clean(os.exitDate) !== '—' ? clean(os.exitDate) : NOT_INFORMED,
    openedAt: ticket?.createdAt ? formatDateTimeBr(ticket.createdAt) : NOT_INFORMED,
    resolvedAt: ticket?.resolvedAt ? formatDateTimeBr(ticket.resolvedAt) : NOT_INFORMED,
    generatedAt: formatDateTimeBr((input.now || new Date()).toISOString()),
    accessUrl: origin ? `${origin}${path}` : path,
    sampleLabel: input.sampleLabel,
  };
}

/** Historico de documentos da OS: acrescenta e mantem os ultimos 50. */
export function appendServiceOrderDocumentEntry(
  history: ServiceOrderDocumentEntry[] | undefined,
  entry: ServiceOrderDocumentEntry
): ServiceOrderDocumentEntry[] {
  const list = Array.isArray(history) ? history.filter(Boolean) : [];
  list.push(entry);
  return list.slice(-SERVICE_ORDER_HISTORY_MAX);
}

// ---------------------------------------------------------------------------
// PDF (A4, multipagina)
// ---------------------------------------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const NAVY = '0.118 0.227 0.431'; // #1e3a6e
const SLATE = '0.392 0.455 0.545';
const INK = '0.118 0.161 0.231';
const SOFT = '0.973 0.980 0.988';
const LINE = '0.886 0.910 0.941';

const WINANSI_EXTRA: Record<string, number> = {
  '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84, '\u2026': 0x85, '\u2020': 0x86,
  '\u2021': 0x87, '\u02C6': 0x88, '\u2030': 0x89, '\u0160': 0x8a, '\u2039': 0x8b, '\u0152': 0x8c,
  '\u017D': 0x8e, '\u2018': 0x91, '\u2019': 0x92, '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95,
  '\u2013': 0x96, '\u2014': 0x97, '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203A': 0x9b,
  '\u0153': 0x9c, '\u017E': 0x9e, '\u0178': 0x9f,
};

function winAnsi(value: string): string {
  const src = String(value || '').normalize('NFC').replace(/[\u00A0\u202F]/g, ' ');
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
  const out: string[] = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (next.length > max && cur) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    out.push(cur);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out.length ? out : [''];
}

function latin1Bytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

export function buildServiceOrderPdf(model: ServiceOrderDocumentModel): Uint8Array {
  const pages: string[][] = [];
  let ops: string[] = [];
  const left = 36;
  const right = PAGE_W - 36;
  const width = right - left;
  const bottom = 54;
  let y = 0;

  const text = (x: number, yy: number, size: number, value: string, font: 'F1' | 'F2', color: string) => {
    ops.push(`BT /${font} ${size} Tf ${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td (${winAnsi(value)}) Tj ET`);
  };
  const rect = (x: number, yy: number, w: number, h: number, color: string) => {
    ops.push(`${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };
  const stroke = (x: number, yy: number, w: number, h: number) => {
    ops.push(`${LINE} RG 0.8 w ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };
  const footer = () => {
    ops.push(`${LINE} RG 0.6 w ${left} 40 m ${right} 40 l S`);
    text(left, 28, 7, `${model.issuer.legalName} - CNPJ ${model.issuer.cnpj}`, 'F1', SLATE);
    text(right - 120, 28, 7, `OS ${model.osCode} - página ${pages.length + 1}`, 'F1', SLATE);
  };
  const newPage = (first: boolean) => {
    if (!first) {
      footer();
      pages.push(ops);
      ops = [];
    }
    if (first) {
      rect(0, PAGE_H - 92, PAGE_W, 92, '1 1 1');
      rect(0, PAGE_H - 6, PAGE_W, 6, NAVY);
      text(left, PAGE_H - 32, 15, 'SETA TELECOM | STI IT', 'F2', NAVY);
      text(left, PAGE_H - 46, 8, `${model.issuer.legalName}  -  CNPJ ${model.issuer.cnpj}`, 'F1', INK);
      text(left, PAGE_H - 57, 8, model.issuer.addressLine || NOT_INFORMED, 'F1', SLATE);
      text(left, PAGE_H - 68, 8, [model.issuer.phone, model.issuer.email].filter(Boolean).join('  -  '), 'F1', SLATE);
      text(right - 150, PAGE_H - 30, 8, 'ORDEM DE SERVIÇO', 'F2', SLATE);
      text(right - 150, PAGE_H - 52, 20, `Nº ${model.osCode}`, 'F2', NAVY);
      text(right - 150, PAGE_H - 66, 8, `Emitida em ${model.generatedAt}`, 'F1', SLATE);
      ops.push(`${NAVY} RG 1.2 w ${left} ${PAGE_H - 82} m ${right} ${PAGE_H - 82} l S`);
      y = PAGE_H - 100;
      if (model.sampleLabel) {
        rect(left, y - 14, width, 18, '1 0.973 0.882');
        text(left + 8, y - 9, 8, model.sampleLabel, 'F2', '0.573 0.251 0.055');
        y -= 26;
      }
    } else {
      rect(0, PAGE_H - 6, PAGE_W, 6, NAVY);
      text(left, PAGE_H - 30, 9, `ORDEM DE SERVIÇO Nº ${model.osCode} (continuação)`, 'F2', NAVY);
      y = PAGE_H - 48;
    }
  };
  const ensure = (h: number) => {
    if (y - h < bottom) newPage(false);
  };
  const section = (title: string) => {
    ensure(30);
    y -= 6;
    rect(left, y - 14, width, 17, NAVY);
    text(left + 8, y - 9, 8, title.toUpperCase(), 'F2', '1 1 1');
    y -= 24;
  };
  const paragraph = (value: string, size = 9, color = INK, indent = 0) => {
    for (const line of wrap(value, size, width - 16 - indent)) {
      ensure(size + 4);
      text(left + 8 + indent, y, size, line, 'F1', color);
      y -= size + 3;
    }
  };
  const cells = (items: Array<{ label: string; value: string }>, cols: number) => {
    const gapX = 6;
    const cw = (width - gapX * (cols - 1)) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const lines = row.map((it) => wrap(it.value, 9, cw - 14).slice(0, 3));
      const h = 18 + Math.max(...lines.map((l) => l.length)) * 11;
      ensure(h + 6);
      row.forEach((it, j) => {
        const x = left + j * (cw + gapX);
        rect(x, y - h + 8, cw, h, SOFT);
        stroke(x, y - h + 8, cw, h);
        text(x + 7, y - 3, 7, it.label.toUpperCase(), 'F2', SLATE);
        lines[j].forEach((ln, k) => text(x + 7, y - 16 - k * 11, 9, ln, 'F2', INK));
      });
      y -= h + 6;
    }
  };

  newPage(true);

  section('Dados do cliente');
  cells(
    [
      { label: 'Cliente', value: model.customerName },
      { label: 'CNPJ do cliente', value: model.customerCnpj },
      { label: 'Chamado', value: model.ticketKey ? `${model.ticketKey}${model.ticketSubject ? ` - ${model.ticketSubject}` : ''}` : NOT_INFORMED },
    ],
    3
  );

  section('Equipamento e atendimento');
  cells(
    [
      { label: 'Equipamento / modelo', value: model.equipment },
      { label: 'Nº de série', value: model.serialNumber },
      { label: 'Situação', value: model.status },
      { label: 'Técnico responsável', value: model.technician },
      { label: 'Prioridade', value: model.priority },
      { label: 'Abertura do chamado', value: model.openedAt },
      { label: 'Entrada', value: model.entryDate },
      { label: 'Saída', value: model.exitDate },
      { label: 'Finalização', value: model.resolvedAt },
    ],
    3
  );

  section('Defeito relatado');
  paragraph(model.reportedDefect);
  y -= 4;

  section('Interações');
  if (!model.interactions.length) {
    paragraph('Sem interações registradas.', 9, SLATE);
  } else {
    for (const it of model.interactions) {
      ensure(30);
      text(left + 8, y, 8, `${it.at}  -  ${it.author}`, 'F2', NAVY);
      y -= 12;
      paragraph(it.text, 9, INK, 6);
      ops.push(`${LINE} RG 0.5 w ${left + 8} ${y + 4} m ${right - 8} ${y + 4} l S`);
      y -= 6;
    }
  }

  section('Solução validada');
  paragraph(model.validatedSolution);
  y -= 6;

  ensure(70);
  section('Link de acesso');
  paragraph(model.accessUrl, 9, NAVY);
  y -= 22;
  ensure(40);
  ops.push(`${SLATE} RG 0.6 w ${left + 8} ${y} m ${left + 230} ${y} l S`);
  ops.push(`${SLATE} RG 0.6 w ${right - 230} ${y} m ${right - 8} ${y} l S`);
  text(left + 8, y - 11, 8, `Técnico: ${model.technician}`, 'F1', SLATE);
  text(right - 230, y - 11, 8, `Cliente: ${model.customerName}`, 'F1', SLATE);
  footer();
  pages.push(ops);

  // Montagem: catalogo(1), paginas(2), fontes(3,4), depois pares pagina/conteudo.
  const objs: Array<{ head: string; stream?: string }> = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs.push({ head: '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' });
  objs.push({ head: `2 0 obj << /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj\n` });
  objs.push({ head: '3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n' });
  objs.push({ head: '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj\n' });
  pages.forEach((p, i) => {
    const pid = 5 + i * 2;
    const cid = pid + 1;
    const stream = p.join('\n') + '\n';
    objs.push({
      head: `${pid} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${cid} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >> endobj\n`,
    });
    objs.push({ head: `${cid} 0 obj << /Length ${latin1Bytes(stream).length} >> stream\n`, stream });
  });
  const chunks: Uint8Array[] = [latin1Bytes('%PDF-1.4\n')];
  const offsets: number[] = [];
  let cursor = chunks[0].length;
  for (const o of objs) {
    offsets.push(cursor);
    const parts = [latin1Bytes(o.head)];
    if (o.stream !== undefined) parts.push(latin1Bytes(o.stream), latin1Bytes('endstream\nendobj\n'));
    for (const part of parts) {
      chunks.push(part);
      cursor += part.length;
    }
  }
  const size = objs.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer << /Size ${size} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF`;
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

export function serviceOrderPdfBase64(model: ServiceOrderDocumentModel): string {
  return Buffer.from(buildServiceOrderPdf(model)).toString('base64');
}
