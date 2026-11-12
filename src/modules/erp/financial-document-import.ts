// ============================================================================
// Conciliação bancária: importação de documentos PDF e XML para Contas a Pagar.
// - XML: NF-e (nfeProc/NFe) com duplicatas de <cobr>, ou XML genérico com lançamentos.
// - PDF (texto já extraído): fatura de cartão (linhas data/descrição/valor, total e vencimento)
//   ou documento simples (boleto/fatura: valor, vencimento, beneficiário).
// - Pareamento com títulos a pagar: mesmo valor (diferença < R$ 0,01) e vencimento mais próximo,
//   a mesma regra da conciliação OFX.
// Nada aqui grava dados: só gera sugestões para o usuário revisar e confirmar.
// ============================================================================
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type FinancialDocumentKind =
  | 'NFE_XML'
  | 'XML_GENERICO'
  | 'FATURA_CARTAO'
  | 'DOCUMENTO_SIMPLES'
  | 'DESCONHECIDO';

export type FinancialDocumentFileType = 'pdf' | 'xml';

export interface ExtractedFinancialItem {
  ref: string;
  /** TOTAL = valor a pagar do documento; LINHA = lançamento de detalhe (ex.: compra na fatura). */
  role: 'TOTAL' | 'LINHA' | 'PARCELA';
  description: string;
  companyName: string;
  companyCnpj?: string;
  amount: number;
  /** AAAA-MM-DD */
  dueDate: string;
  /** Data da compra/emissão (AAAA-MM-DD), quando houver. */
  date?: string;
  documentNumber?: string;
}

export interface FinancialDocumentParseResult {
  kind: FinancialDocumentKind;
  issuerName?: string;
  issuerCnpj?: string;
  documentNumber?: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: number;
  items: ExtractedFinancialItem[];
  warnings: string[];
}

export interface PayableCandidate {
  id: string;
  type: string;
  status: string;
  amount: number;
  dueDate: string;
  description?: string;
  companyName?: string;
}

export type SuggestedAction = 'MATCH' | 'CREATE' | 'IGNORE';

export interface FinancialItemSuggestion extends ExtractedFinancialItem {
  suggestedAction: SuggestedAction;
  match: { entryId: string; description: string; companyName: string; amount: number; dueDate: string } | null;
}

export const MAX_IMPORT_ITEMS = 500;

// ---------------------------------------------------------------------------
// Utilitários de valor e data (formato brasileiro)
// ---------------------------------------------------------------------------

/** "1.234,56" | "R$ 1.234,56" | "-389,90" | "1234.56" => número (NaN se inválido). */
export function parseBrMoney(raw: string): number {
  let s = String(raw || '').replace(/R\$|\s/gi, '').trim();
  if (!s) return NaN;
  let negative = false;
  if (s.startsWith('-') || s.endsWith('-')) {
    negative = true;
    s = s.replace(/^-|-$/g, '');
  }
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(s) || /^\d+,\d{2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return NaN;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((negative ? -n : n) * 100) / 100;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function validYmd(y: number, m: number, d: number): string {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * "15/12/2026" | "15/12/26" | "2026-12-15" | "2026-12-15T10:00:00-03:00" => "2026-12-15".
 * "03/11" (sem ano) usa `refDate` (AAAA-MM-DD): mesmo ano, ou o anterior se o mês for posterior.
 */
export function parseBrDate(raw: string, refDate?: string): string {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return validYmd(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const ref = refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate) ? refDate : new Date().toISOString().slice(0, 10);
    const refY = Number(ref.slice(0, 4));
    const refM = Number(ref.slice(5, 7));
    const mm = Number(m[2]);
    return validYmd(mm > refM ? refY - 1 : refY, mm, Number(m[1]));
  }
  return '';
}

const cleanText = (v: unknown, max = 160): string =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const formatCnpj = (raw: string): string => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------
type XmlNode = Record<string, unknown>;

function decodeBasicXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, ent: string) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    const code = ent.startsWith('#x') ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const SAFE_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  trimValues: true,
  allowBooleanAttributes: false,
  isArray: (name) => name === 'dup',
  tagValueProcessor: (_tagName, tagValue) => decodeBasicXmlEntities(String(tagValue)),
});

function parseSafeXml(rawXml: string): XmlNode {
  // DOCTYPE/ENTITY nunca são aceitos (sem expansão de entidades externas).
  if (/<!DOCTYPE|<!ENTITY/i.test(rawXml)) throw new Error('XML com DOCTYPE/ENTITY não é aceito.');
  const valid = XMLValidator.validate(rawXml, { allowBooleanAttributes: false });
  if (valid !== true) {
    const err = (valid as { err?: { msg?: string; line?: number } }).err;
    throw new Error(`XML malformado: ${err?.msg || 'estrutura inválida'}${err?.line ? ` (linha ${err.line})` : ''}.`);
  }
  const parsed = SAFE_XML_PARSER.parse(rawXml) as XmlNode;
  if (!parsed || typeof parsed !== 'object') throw new Error('XML vazio ou inválido.');
  return parsed;
}

const obj = (v: unknown): XmlNode | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? (x as XmlNode) : undefined;
};
const txt = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    const t = (v as XmlNode)['#text'];
    return t === undefined ? '' : String(t).trim();
  }
  return String(v).trim();
};

function findInfNFe(root: XmlNode): XmlNode | undefined {
  const nfeProc = obj(root.nfeProc);
  const nfe = obj(nfeProc?.NFe) || obj(root.NFe);
  return obj(nfe?.infNFe);
}

/** NF-e (modelo 55): emitente, número, emissão, total vNF e duplicatas de <cobr>. */
export function parseNfeXml(xml: string): FinancialDocumentParseResult {
  const root = parseSafeXml(xml);
  const inf = findInfNFe(root);
  if (!inf) throw new Error('XML não é uma NF-e (nfeProc/NFe/infNFe não encontrado).');
  const warnings: string[] = [];
  const emit = obj(inf.emit) || {};
  const ide = obj(inf.ide) || {};
  const total = obj(obj(inf.total)?.ICMSTot) || {};
  const issuerName = cleanText(txt(emit.xNome) || txt(emit.xFant) || 'Emitente da NF-e');
  const issuerCnpj = formatCnpj(txt(emit.CNPJ) || txt(emit.CPF));
  const documentNumber = txt(ide.nNF);
  const serie = txt(ide.serie);
  const issueDate = parseBrDate(txt(ide.dhEmi) || txt(ide.dEmi));
  const totalAmount = parseBrMoney(txt(total.vNF));
  const cobr = obj(inf.cobr);
  const dups = (Array.isArray(cobr?.dup) ? (cobr?.dup as unknown[]) : []).map(obj).filter(Boolean) as XmlNode[];
  const nfLabel = `NF-e ${documentNumber}${serie ? `/${serie}` : ''}`;
  const items: ExtractedFinancialItem[] = [];
  dups.forEach((d, i) => {
    const amount = parseBrMoney(txt(d.vDup));
    const dueDate = parseBrDate(txt(d.dVenc));
    if (!(amount > 0) || !dueDate) {
      warnings.push(`Duplicata ${txt(d.nDup) || i + 1} ignorada: valor ou vencimento inválido.`);
      return;
    }
    const nDup = txt(d.nDup) || String(i + 1).padStart(3, '0');
    items.push({
      ref: `nfe-${documentNumber}-dup-${nDup}`,
      role: 'PARCELA',
      description: cleanText(`${nfLabel} parcela ${nDup} (${dups.length}x) - ${issuerName}`),
      companyName: issuerName,
      companyCnpj: issuerCnpj || undefined,
      amount,
      dueDate,
      date: issueDate || undefined,
      documentNumber: `${documentNumber}-${nDup}`,
    });
  });
  if (items.length === 0) {
    if (totalAmount > 0) {
      if (dups.length === 0) warnings.push('NF-e sem duplicatas em <cobr>: vencimento sugerido = data de emissão.');
      items.push({
        ref: `nfe-${documentNumber}-total`,
        role: 'TOTAL',
        description: cleanText(`${nfLabel} - ${issuerName}`),
        companyName: issuerName,
        companyCnpj: issuerCnpj || undefined,
        amount: totalAmount,
        dueDate: issueDate || new Date().toISOString().slice(0, 10),
        date: issueDate || undefined,
        documentNumber,
      });
    } else {
      warnings.push('NF-e sem valor total (vNF) nem duplicatas.');
    }
  } else if (totalAmount > 0) {
    const sum = Math.round(items.reduce((a, it) => a + it.amount, 0) * 100) / 100;
    if (Math.abs(sum - totalAmount) >= 0.01) {
      warnings.push(`Soma das duplicatas (${sum.toFixed(2)}) difere do total da nota (${totalAmount.toFixed(2)}).`);
    }
  }
  return {
    kind: 'NFE_XML',
    issuerName,
    issuerCnpj: issuerCnpj || undefined,
    documentNumber,
    issueDate: issueDate || undefined,
    dueDate: items[0]?.dueDate,
    totalAmount: totalAmount > 0 ? totalAmount : undefined,
    items,
    warnings,
  };
}

const AMOUNT_KEY = /^(valor|vlr|amount|value|total|vdup|vliq|valorliquido|valordocumento|valortotal|trnamt)$/i;
const DATE_KEY = /^(vencimento|datavencimento|dtvencimento|dvenc|duedate|due|data|date|dtposted)$/i;
const DESC_KEY = /^(descricao|descrição|historico|histórico|memo|description|nome|name|fornecedor|beneficiario|beneficiário)$/i;

/** XML genérico: nós com valor + data (vencimento) e, opcionalmente, descrição. */
export function parseGenericXml(xml: string): FinancialDocumentParseResult {
  const root = parseSafeXml(xml);
  const items: ExtractedFinancialItem[] = [];
  const warnings: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || items.length >= MAX_IMPORT_ITEMS) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const rec = node as XmlNode;
    const keys = Object.keys(rec);
    const plain = (k: string) => (typeof rec[k] === 'object' && !(rec[k] as XmlNode)['#text'] ? '' : txt(rec[k]));
    const amtKey = keys.find((k) => AMOUNT_KEY.test(k.replace(/^@_/, '')) && plain(k));
    const dateKey =
      keys.find((k) => /venc|due/i.test(k) && plain(k)) || keys.find((k) => DATE_KEY.test(k.replace(/^@_/, '')) && plain(k));
    if (amtKey && dateKey) {
      const amount = Math.abs(parseBrMoney(plain(amtKey)));
      const dueDate = parseBrDate(plain(dateKey));
      if (amount > 0 && dueDate) {
        const descKey = keys.find((k) => DESC_KEY.test(k.replace(/^@_/, '')) && plain(k));
        const description = cleanText(descKey ? plain(descKey) : `Lançamento ${items.length + 1}`);
        items.push({
          ref: `xml-${items.length + 1}`,
          role: 'LINHA',
          description,
          companyName: description,
          amount,
          dueDate,
        });
        return;
      }
    }
    keys.forEach((k) => walk(rec[k], depth + 1));
  };
  walk(root, 0);
  if (items.length === 0) warnings.push('Nenhum lançamento reconhecido no XML (esperado: valor e data/vencimento).');
  return { kind: items.length ? 'XML_GENERICO' : 'DESCONHECIDO', items, warnings };
}

export function parseFinancialXml(xml: string): FinancialDocumentParseResult {
  const root = parseSafeXml(xml);
  if (findInfNFe(root)) return parseNfeXml(xml);
  return parseGenericXml(xml);
}

// ---------------------------------------------------------------------------
// PDF (texto extraído)
// ---------------------------------------------------------------------------
const MONEY_RE = '-?\\s?(?:R\\$\\s?)?-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}-?';
const LINE_RE = new RegExp(`^(\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?)\\s+(.+?)\\s+(${MONEY_RE})\\s*$`);
const NON_PURCHASE = /\b(total|saldo|limite|vencimento|pagamento\s+(efetuado|recebido|realizado)|pagto|estorno|cr[eé]dito\s+de|encargos\s+financeiros\s+futuros|anuidade\s+pr[oó]xima)\b/i;

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function findDueDate(text: string): string {
  const raw = firstMatch(text, [
    /vencimento(?:\s+da\s+fatura)?\s*[:\-]?\s*(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/i,
    /vence\s+em\s*[:\-]?\s*(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/i,
    /data\s+de\s+vencimento\s*[:\-]?\s*(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/i,
    /pagar\s+at[eé]\s*[:\-]?\s*(\d{1,2}[/.]\d{1,2}[/.]\d{2,4})/i,
  ]);
  return raw ? parseBrDate(raw.replace(/\./g, '/')) : '';
}

function findTotal(text: string, patterns: RegExp[]): number {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const n = parseBrMoney(m[1]);
      if (n > 0) return n;
    }
  }
  return NaN;
}

function detectCardIssuer(text: string): string {
  const t = text.toLowerCase();
  if (/\bbanco inter\b|\binter\b|inter&co/.test(t)) return 'Banco Inter';
  if (/\bita[uú]\b|itaucard/.test(t)) return 'Banco Itaú';
  if (/nubank|nu pagamentos/.test(t)) return 'Nubank';
  if (/bradesco/.test(t)) return 'Bradesco';
  if (/santander/.test(t)) return 'Santander';
  if (/\bc6\s?bank\b|\bc6\b/.test(t)) return 'C6 Bank';
  if (/caixa econ[oô]mica/.test(t)) return 'Caixa';
  if (/banco do brasil|ourocard/.test(t)) return 'Banco do Brasil';
  return 'Cartão de crédito';
}

export function looksLikeCardStatement(text: string): boolean {
  const t = text.toLowerCase();
  const cardWords = /fatura|cart[aã]o\s+de\s+cr[eé]dito|cart[aã]o|mastercard|visa|elo\b|amex/.test(t);
  const lines = text.split(/\r?\n/).filter((l) => LINE_RE.test(l.trim())).length;
  return cardWords && lines >= 1;
}

/** Fatura de cartão: total + vencimento (TOTAL) e as compras (LINHA). */
export function parseCardStatementText(text: string): FinancialDocumentParseResult {
  const warnings: string[] = [];
  const issuer = detectCardIssuer(text);
  const dueDate = findDueDate(text);
  const totalAmount = findTotal(text, [
    /total\s+(?:desta|da)\s+fatura\s*[:\-]?\s*(?:R\$\s*)?(-?[\d.]+,\d{2})/i,
    /valor\s+total\s+(?:da\s+fatura\s*)?[:\-]?\s*(?:R\$\s*)?(-?[\d.]+,\d{2})/i,
    /total\s+a\s+pagar\s*[:\-]?\s*(?:R\$\s*)?(-?[\d.]+,\d{2})/i,
    /valor\s+(?:a\s+pagar|da\s+fatura)\s*[:\-]?\s*(?:R\$\s*)?(-?[\d.]+,\d{2})/i,
  ]);
  if (!dueDate) warnings.push('Vencimento da fatura não encontrado: confira a data antes de confirmar.');
  const effectiveDue = dueDate || new Date().toISOString().slice(0, 10);
  const items: ExtractedFinancialItem[] = [];
  const lines: ExtractedFinancialItem[] = [];
  let skipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const m = line.match(LINE_RE);
    if (!m) continue;
    const desc = cleanText(m[2]);
    const amount = parseBrMoney(m[3]);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (amount < 0 || NON_PURCHASE.test(desc)) {
      skipped += 1;
      continue;
    }
    const date = parseBrDate(m[1].replace(/\./g, '/'), effectiveDue);
    lines.push({
      ref: `card-${lines.length + 1}`,
      role: 'LINHA',
      description: cleanText(`${desc} (${issuer})`),
      companyName: desc,
      amount,
      dueDate: effectiveDue,
      date: date || undefined,
    });
    if (lines.length >= MAX_IMPORT_ITEMS - 1) break;
  }
  if (skipped > 0) warnings.push(`${skipped} linha(s) de pagamento, estorno ou crédito ignorada(s).`);
  const sum = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const total = totalAmount > 0 ? totalAmount : sum;
  if (!(totalAmount > 0) && lines.length) warnings.push('Total da fatura não encontrado: usado a soma das compras.');
  if (totalAmount > 0 && lines.length && Math.abs(sum - totalAmount) >= 0.01) {
    warnings.push(`Soma das compras lidas (${sum.toFixed(2)}) difere do total da fatura (${totalAmount.toFixed(2)}).`);
  }
  if (total > 0) {
    const [y, mo, d] = effectiveDue.split('-');
    items.push({
      ref: 'card-total',
      role: 'TOTAL',
      description: cleanText(`Fatura cartão ${issuer} venc. ${d}/${mo}/${y}`),
      companyName: issuer,
      amount: total,
      dueDate: effectiveDue,
    });
  }
  items.push(...lines);
  return {
    kind: 'FATURA_CARTAO',
    issuerName: issuer,
    dueDate: dueDate || undefined,
    totalAmount: total > 0 ? total : undefined,
    items,
    warnings,
  };
}

/** Linha digitável de boleto (47 dígitos): valor e vencimento do campo 5. */
export function parseBoletoDigitableLine(text: string): { amount: number; dueDate: string } | null {
  const m = text.match(/(\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+(\d{14}))/);
  if (!m) return null;
  const f5 = m[2];
  const factor = Number(f5.slice(0, 4));
  const amount = Number(f5.slice(4)) / 100;
  let dueDate = '';
  if (factor >= 1000) {
    // Fator de vencimento: desde 22/02/2025 o fator reinicia em 1000 (base anterior: 07/10/1997).
    const base = Date.UTC(2025, 1, 22);
    dueDate = new Date(base + (factor - 1000) * 86400000).toISOString().slice(0, 10);
  }
  return amount > 0 ? { amount, dueDate } : null;
}

/** Boleto ou fatura simples: valor, vencimento e beneficiário. */
export function parseSimpleDocumentText(text: string): FinancialDocumentParseResult {
  const warnings: string[] = [];
  let amount = findTotal(text, [
    /valor\s+(?:do\s+documento|cobrado|a\s+pagar|total|l[ií]quido)\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /total\s+a\s+pagar\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /valor\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i,
    /total\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i,
  ]);
  let dueDate = findDueDate(text);
  const boleto = parseBoletoDigitableLine(text);
  if (boleto) {
    if (!(amount > 0)) amount = boleto.amount;
    if (!dueDate && boleto.dueDate) dueDate = boleto.dueDate;
  }
  let beneficiary = cleanText(
    firstMatch(text, [
      /benefici[aá]rio\s*(?:final)?\s*[:\-]?\s*([^\n\r]{3,120})/i,
      /cedente\s*[:\-]?\s*([^\n\r]{3,120})/i,
      /raz[aã]o\s+social\s*[:\-]?\s*([^\n\r]{3,120})/i,
      /emitente\s*[:\-]?\s*([^\n\r]{3,120})/i,
      /prestador\s*(?:de\s+servi[cç]os)?\s*[:\-]?\s*([^\n\r]{3,120})/i,
    ]).replace(/\s*(CNPJ|CPF)[\s\S]*$/i, ''),
    120,
  );
  const cnpjMatch = text.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/);
  const issuerCnpj = cnpjMatch ? cnpjMatch[1] : undefined;
  const documentNumber = cleanText(
    firstMatch(text, [/(?:n[uú]mero\s+do\s+documento|n[ºo°]\s*(?:do\s+)?documento|fatura\s+n[ºo°]?)\s*[:\-]?\s*([A-Za-z0-9./-]{1,30})/i]),
    30,
  );
  if (!beneficiary) {
    const first = text.split(/\r?\n/).map((l) => cleanText(l)).find((l) => l.length >= 3 && !/^\d/.test(l));
    beneficiary = first || 'Fornecedor';
    warnings.push('Beneficiário não identificado: confira o fornecedor antes de confirmar.');
  }
  if (!dueDate) warnings.push('Vencimento não encontrado: confira a data antes de confirmar.');
  const items: ExtractedFinancialItem[] = [];
  if (amount > 0) {
    items.push({
      ref: 'doc-total',
      role: 'TOTAL',
      description: cleanText(`${/boleto/i.test(text) || boleto ? 'Boleto' : 'Fatura'} ${documentNumber ? `${documentNumber} ` : ''}- ${beneficiary}`),
      companyName: beneficiary,
      companyCnpj: issuerCnpj,
      amount,
      dueDate: dueDate || new Date().toISOString().slice(0, 10),
      documentNumber: documentNumber || undefined,
    });
  } else {
    warnings.push('Valor do documento não encontrado.');
  }
  return {
    kind: items.length ? 'DOCUMENTO_SIMPLES' : 'DESCONHECIDO',
    issuerName: beneficiary,
    issuerCnpj,
    documentNumber: documentNumber || undefined,
    dueDate: dueDate || undefined,
    totalAmount: amount > 0 ? amount : undefined,
    items,
    warnings,
  };
}

export function parseFinancialPdfText(text: string): FinancialDocumentParseResult {
  const t = String(text || '');
  if (t.replace(/\s/g, '').length < 20) {
    return {
      kind: 'DESCONHECIDO',
      items: [],
      warnings: ['O PDF não tem texto legível (provavelmente escaneado). Envie o PDF original do banco ou o XML.'],
    };
  }
  if (looksLikeCardStatement(t)) return parseCardStatementText(t);
  return parseSimpleDocumentText(t);
}

// ---------------------------------------------------------------------------
// Pareamento com Contas a Pagar (mesma regra da conciliação OFX)
// ---------------------------------------------------------------------------
const dayDiff = (a: string, b: string) =>
  a && b ? Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000 : 999;

export function suggestPayableMatches(
  items: ExtractedFinancialItem[],
  entries: PayableCandidate[],
): FinancialItemSuggestion[] {
  const used = new Set<string>();
  const hasTotalWithLines = items.some((i) => i.role === 'TOTAL') && items.some((i) => i.role === 'LINHA');
  return items.map((it) => {
    const detailOnly = hasTotalWithLines && it.role === 'LINHA';
    const candidate = detailOnly ? undefined : entries
      .filter(
        (e) =>
          e.type === 'PAGAR' &&
          e.status !== 'PAGO' &&
          !used.has(e.id) &&
          Math.abs(Math.abs(it.amount) - Number(e.amount || 0)) < 0.01,
      )
      .sort((a, b) => dayDiff(a.dueDate, it.dueDate) - dayDiff(b.dueDate, it.dueDate))[0];
    if (candidate) used.add(candidate.id);
    // Fatura de cartão: o título é o total; as compras ficam como detalhe (ignoradas por padrão).
    const suggestedAction: SuggestedAction = candidate
      ? 'MATCH'
      : hasTotalWithLines && it.role === 'LINHA'
        ? 'IGNORE'
        : 'CREATE';
    return {
      ...it,
      suggestedAction,
      match: candidate
        ? {
            entryId: candidate.id,
            description: String(candidate.description || ''),
            companyName: String(candidate.companyName || ''),
            amount: Number(candidate.amount || 0),
            dueDate: String(candidate.dueDate || ''),
          }
        : null,
    };
  });
}
