// ============================================================================
// SetaDesk - Entrada de e-mail (Graph + processamento + outbox + primeira abertura).
// Somente dados sinteticos (dominios example.com / example.net). Sem rede: o fetch do
// Graph e falso e injetado. O bloco "Postgres real" so roda com
// SETADESK_TEST_DATABASE_URL (banco descartavel).
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import forge from 'node-forge';
import {
  allowedIntakeMailboxes,
  isSetaDeskAnalysisNoticeEnabled,
  isSetaDeskEmailIntakeEnabled,
  parseGraphPfx,
  resolveSetaDeskGraphConfig,
  SETADESK_EMAIL_ENV_NAMES,
  SETADESK_GRAPH_DOCUMENTED_IDS,
} from '../src/modules/setadesk-email/config';
import {
  buildClientAssertion,
  createSetaDeskGraphClient,
  SETADESK_GRAPH_TIMEOUT_MS,
  isTrustedGraphCursor,
  type GraphMessage,
  type SetaDeskFetch,
} from '../src/modules/setadesk-email/graph-app-client';
import {
  classifyIgnorable,
  extractSubjectTicketKeys,
  isOutboundPublic,
  normalizeGraphMessage,
  parseMessageIdList,
  resolveRequesterLink,
} from '../src/modules/setadesk-email/parse';
import { processInboundEmail } from '../src/modules/setadesk-email/processor';
import { createMemorySetaDeskEmailStore, type IntakePipeline } from '../src/modules/setadesk-email/store';
import { processSetaDeskOutbox, nextAttemptDelayMinutes, OUTBOX_MAX_ATTEMPTS } from '../src/modules/setadesk-email/outbox';
import { markSetaDeskTicketViewed } from '../src/modules/setadesk-email/first-view';
import { runSetaDeskEmailIntake } from '../src/modules/setadesk-email/intake';
import { buildAnalysisNoticeEmail, buildConfirmationEmail } from '../src/modules/setadesk-email/templates';
import { isSetaDeskEmailDirectRoute, matchMarkViewedPath } from '../src/modules/setadesk-email/routes';
import { SETADESK_MIGRATIONS } from '../src/db/setadesk-schema';
import { CrmApiRouter, shouldLoadSetaDeskTicketsForRoute, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { createInMemoryRepository } from '../src/db/repository';

const TEC_BOX = 'suporte@desk.example.com';
const FIN_BOX = 'financeiro@desk.example.com';
const PIPELINES: IntakePipeline[] = [
  { id: 'pl-tec', name: 'Suporte Técnico', prefix: 'TEC', mailbox: TEC_BOX, sequenceName: 'setadesk_ticket_seq_tec', isActive: true },
  { id: 'pl-fin', name: 'Financeiro', prefix: 'FIN', mailbox: FIN_BOX, sequenceName: 'setadesk_ticket_seq_fin', isActive: true },
];
const ON = { SETADESK_EMAIL_INTAKE_ENABLED: 'true', SETADESK_EMAIL_INTAKE_MAILBOXES: `${TEC_BOX},${FIN_BOX}` };
const NOW = new Date('2026-11-12T15:00:00.000Z');

function store(extra?: Parameters<typeof createMemorySetaDeskEmailStore>[0]) {
  const s = createMemorySetaDeskEmailStore({ pipelines: PIPELINES, ...extra });
  s.state.sequences.set('setadesk_ticket_seq_tec', 248);
  s.state.sequences.set('setadesk_ticket_seq_fin', 1030);
  return s;
}

let seq = 0;
function graphMsg(over: Partial<GraphMessage> & { headers?: Record<string, string>; from?: string; to?: string[] } = {}): GraphMessage {
  seq += 1;
  const headers = { 'Message-ID': `<msg-${seq}@mail.example.com>`, ...(over.headers || {}) };
  const { headers: _h, from, to, ...rest } = over;
  return {
    id: `AAMk-${seq}`,
    internetMessageId: headers['Message-ID'],
    subject: 'Equipamento sem sinal na filial',
    from: { emailAddress: { address: from || 'cliente@example.com', name: 'Cliente Exemplo' } },
    toRecipients: (to || [TEC_BOX]).map((address) => ({ emailAddress: { address } })),
    ccRecipients: [],
    receivedDateTime: NOW.toISOString(),
    internetMessageHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
    body: { contentType: 'html', content: '<p>Bom dia, o equipamento <b>parou</b>.</p><script>alert(1)</script>' },
    attachments: [{ id: 'att1', name: 'foto.jpg', contentType: 'image/jpeg', size: 1234, isInline: false }],
    ...rest,
  };
}

const ctx = (mailbox = TEC_BOX) => ({ mailbox, pipelines: PIPELINES, now: () => NOW });


/** PFX sintetico (autoassinado, CN=setadesk-teste.example.com) para os testes. */
function makeTestPfx(password: string, opts: { notAfter?: Date; notBefore?: Date } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fKey = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const fPub = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = fPub;
  cert.serialNumber = '01';
  cert.validity.notBefore = opts.notBefore || new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = opts.notAfter || new Date('2028-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'setadesk-teste.example.com' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(fKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(fKey, [cert], password, { algorithm: '3des' });
  const b64 = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64');
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const thumb = crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
  return { b64, thumb, privateKey, publicKey };
}
const TEST_PFX_PASSWORD = 'senha-pfx-de-teste-987';
const TEST_PFX = makeTestPfx(TEST_PFX_PASSWORD);
const PFX_ENV = {
  SETADESK_GRAPH_CERT_THUMBPRINT: TEST_PFX.thumb,
  SETADESK_GRAPH_CERT_PFX_BASE64: TEST_PFX.b64,
  SETADESK_GRAPH_CERT_PASSWORD: TEST_PFX_PASSWORD,
};
const CFG_NOW = Date.parse('2026-11-12T15:00:00Z');

describe('SetaDesk e-mail - configuracao e flag', () => {
  it('flag desligada por padrao; aviso de analise exige as duas flags', () => {
    assert.equal(isSetaDeskEmailIntakeEnabled({}), false);
    assert.equal(isSetaDeskEmailIntakeEnabled({ SETADESK_EMAIL_INTAKE_ENABLED: 'true' }), true);
    assert.equal(isSetaDeskAnalysisNoticeEnabled({ SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED: 'true' }), false);
    assert.equal(isSetaDeskAnalysisNoticeEnabled({ SETADESK_EMAIL_INTAKE_ENABLED: '1', SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED: '1' }), true);
    assert.deepEqual(allowedIntakeMailboxes({ SETADESK_EMAIL_INTAKE_MAILBOXES: ` ${TEC_BOX.toUpperCase()}, invalido, ${TEC_BOX}` }), [TEC_BOX]);
  });

  it('config do Graph por PFX: codigos sem valores; confere thumbprint, senha e validade', () => {
    const base = {
      SETADESK_GRAPH_TENANT_ID: '11111111-2222-3333-4444-555555555555',
      SETADESK_GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ...PFX_ENV,
    };
    assert.deepEqual(resolveSetaDeskGraphConfig({}), { ok: false, code: 'GRAPH_TENANT_MISSING' });
    assert.deepEqual(resolveSetaDeskGraphConfig({ ...base, SETADESK_GRAPH_TENANT_ID: 'common' }), { ok: false, code: 'GRAPH_TENANT_MISSING' });
    assert.deepEqual(resolveSetaDeskGraphConfig({ ...base, SETADESK_GRAPH_CERT_THUMBPRINT: '' }, CFG_NOW), { ok: false, code: 'GRAPH_THUMBPRINT_MISSING' });
    assert.deepEqual(resolveSetaDeskGraphConfig({ ...base, SETADESK_GRAPH_CERT_PFX_BASE64: '' }, CFG_NOW), { ok: false, code: 'GRAPH_CERT_PFX_MISSING' });
    const wrong = resolveSetaDeskGraphConfig({ ...base, SETADESK_GRAPH_CERT_PASSWORD: 'errada' }, CFG_NOW);
    assert.deepEqual(wrong, { ok: false, code: 'GRAPH_CERT_PFX_INVALID_OR_WRONG_PASSWORD' });
    assert.equal(JSON.stringify(wrong).includes('errada'), false);
    assert.deepEqual(
      resolveSetaDeskGraphConfig({ ...base, SETADESK_GRAPH_CERT_THUMBPRINT: SETADESK_GRAPH_DOCUMENTED_IDS.certThumbprintSha1 }, CFG_NOW),
      { ok: false, code: 'GRAPH_THUMBPRINT_MISMATCH' }
    );
    assert.deepEqual(resolveSetaDeskGraphConfig(base, Date.parse('2030-01-01T00:00:00Z')), { ok: false, code: 'GRAPH_CERT_EXPIRED_OR_NOT_YET_VALID' });
    // Thumbprint com dois-pontos/minusculas (como alguns painéis exibem) tambem vale.
    const pretty = TEST_PFX.thumb.toLowerCase().match(/../g)!.join(':');
    const ok = resolveSetaDeskGraphConfig({ ...base, SETADESK_GRAPH_CERT_THUMBPRINT: pretty }, CFG_NOW);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.config.thumbprintHeader.name, 'x5t');
      assert.equal(ok.config.thumbprintHeader.value, Buffer.from(TEST_PFX.thumb, 'hex').toString('base64url'));
      assert.equal(ok.config.privateKey.asymmetricKeyType, 'rsa');
    }
    const parsed = parseGraphPfx(TEST_PFX.b64, TEST_PFX_PASSWORD);
    assert.equal(parsed.ok && parsed.pfx.thumbprintSha1, TEST_PFX.thumb);
  });

  it('nomes das env vars e ids documentados (nao secretos)', () => {
    assert.deepEqual([...SETADESK_EMAIL_ENV_NAMES], [
      'SETADESK_EMAIL_INTAKE_ENABLED',
      'SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED',
      'SETADESK_EMAIL_INTAKE_MAILBOXES',
      'SETADESK_GRAPH_TENANT_ID',
      'SETADESK_GRAPH_CLIENT_ID',
      'SETADESK_GRAPH_CERT_THUMBPRINT',
      'SETADESK_GRAPH_CERT_PFX_BASE64',
      'SETADESK_GRAPH_CERT_PASSWORD',
    ]);
    assert.equal(SETADESK_GRAPH_DOCUMENTED_IDS.tenantId, '05c800b3-8c5b-448b-912d-e1e51d667588');
    assert.equal(SETADESK_GRAPH_DOCUMENTED_IDS.clientId, '9b5ce520-d659-4348-8044-70827160b247');
  });

  it('client assertion: JWT RS256 com x5t, aud do tenant, iss/sub = client id e assinatura valida', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cfg = {
      tenantId: '11111111-2222-3333-4444-555555555555',
      clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      thumbprintHeader: { name: 'x5t' as const, value: 'q83vEjRWeJA' },
      privateKey,
    };
    const jwt = buildClientAssertion(cfg, NOW.getTime());
    const [h, p, sig] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(header.alg, 'RS256');
    assert.equal(header.x5t, 'q83vEjRWeJA');
    assert.equal(payload.aud, `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`);
    assert.equal(payload.iss, cfg.clientId);
    assert.equal(payload.sub, cfg.clientId);
    assert.ok(payload.exp - payload.iat <= 600);
    assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url')), true);
  });

  it('cursor delta so e aceito se for URL do proprio Graph', () => {
    assert.equal(isTrustedGraphCursor('https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?$deltatoken=a'), true);
    assert.equal(isTrustedGraphCursor('https://evil.example.com/v1.0/users/x'), false);
    assert.equal(isTrustedGraphCursor('http://graph.microsoft.com/v1.0/users/x'), false);
  });
});

describe('SetaDesk e-mail - regras puras', () => {
  it('normaliza mensagem: HTML sanitizado, texto puro, anexos so metadados, ids <...> minusculos', () => {
    const e = normalizeGraphMessage(graphMsg({ headers: { 'In-Reply-To': '<A@x.example.com>', References: '<r1@x.example.com> <A@x.example.com>' } }));
    assert.equal(e.inReplyTo, '<a@x.example.com>');
    assert.deepEqual(e.references, ['<r1@x.example.com>', '<a@x.example.com>']);
    assert.doesNotMatch(e.bodyHtml || '', /script/i);
    assert.match(e.bodyText, /equipamento parou/);
    assert.deepEqual(e.attachments, [{ name: 'foto.jpg', contentType: 'image/jpeg', size: 1234, isInline: false }]);
    assert.deepEqual(parseMessageIdList('<a@b> lixo <a@b> <c@d>'), ['<a@b>', '<c@d>']);
  });

  it('anti-loop: auto-reply, bounce, propria caixa e listas', () => {
    const own = [TEC_BOX, FIN_BOX];
    const n = (o: Parameters<typeof graphMsg>[0]) => classifyIgnorable(normalizeGraphMessage(graphMsg(o)), own);
    assert.equal(n({}), null);
    assert.equal(n({ headers: { 'Auto-Submitted': 'auto-replied' } }), 'AUTO_REPLY');
    assert.equal(n({ headers: { 'Auto-Submitted': 'no' } }), null);
    assert.equal(n({ headers: { 'X-Auto-Response-Suppress': 'All' } }), 'AUTO_REPLY');
    assert.equal(n({ headers: { Precedence: 'bulk' } }), 'AUTO_REPLY');
    assert.equal(n({ headers: { Precedence: 'auto_reply' } }), 'AUTO_REPLY');
    assert.equal(n({ subject: 'Resposta automática: chamado' }), 'AUTO_REPLY');
    assert.equal(n({ from: 'MAILER-DAEMON@mail.example.net' }), 'BOUNCE');
    assert.equal(n({ subject: 'Undeliverable: teste' }), 'BOUNCE');
    assert.equal(n({ headers: { 'Content-Type': 'multipart/report; report-type=delivery-status' } }), 'BOUNCE');
    assert.equal(n({ from: FIN_BOX }), 'OWN_MAILBOX');
  });

  it('chaves no assunto: so prefixos de filas conhecidas', () => {
    assert.deepEqual(extractSubjectTicketKeys('RE: [TEC-249] [fin-12] [ABC-1] [TEC-249]', ['TEC', 'FIN']), ['TEC-249', 'FIN-12']);
    assert.deepEqual(extractSubjectTicketKeys('TEC-249 sem colchetes', ['TEC']), []);
  });

  it('pacote H: saida publica so se todos os destinatarios forem solicitante ou contato', () => {
    const p = { requesterEmail: 'cliente@example.com', contactEmail: 'contato@example.com' };
    assert.equal(isOutboundPublic({ to: ['cliente@example.com'] }, p), true);
    assert.equal(isOutboundPublic({ to: ['cliente@example.com'], cc: ['contato@example.com'] }, p), true);
    assert.equal(isOutboundPublic({ to: ['cliente@example.com'], bcc: ['outro@example.net'] }, p), false);
    assert.equal(isOutboundPublic({ to: [] }, p), false);
  });

  it('vinculo de solicitante: so e-mail exato; empresas diferentes => sem vinculo', () => {
    const companies = [{ id: 'co1', cnpj: '11.111.111/0001-11' }, { id: 'co2', cnpj: '22.222.222/0001-22' }];
    assert.deepEqual(resolveRequesterLink('a@example.com', [{ id: 'c1', email: 'A@example.com', companyId: 'co1' }], companies), { contactId: 'c1', companyId: 'co1' });
    assert.deepEqual(resolveRequesterLink('a@example.com', [{ id: 'c1', email: 'a@example.com.br', companyId: 'co1' }], companies), { contactId: null, companyId: null });
    assert.deepEqual(
      resolveRequesterLink('a@example.com', [{ id: 'c1', email: 'a@example.com', companyId: 'co1' }, { id: 'c2', email: 'a@example.com', companyId: 'co2' }], companies),
      { contactId: null, companyId: null }
    );
    assert.deepEqual(
      resolveRequesterLink('a@example.com', [{ id: 'c1', email: 'a@example.com', companyId: 'co1' }, { id: 'c2', email: 'a@example.com', companyId: 'co1' }], companies),
      { contactId: null, companyId: 'co1' }
    );
  });

  it('textos: confirmacao e aviso "Chamado em atendimento" aprovados, com a chave real', () => {
    const c = buildConfirmationEmail('TEC-249');
    assert.equal(c.subject, '[TEC-249] Recebemos sua solicitação');
    assert.equal(
      c.bodyText,
      'Olá, recebemos seu e-mail e abrimos o chamado TEC-249. Para acompanhar ou enviar mais informações, basta responder a este e-mail mantendo o número no assunto. Equipe de Suporte Seta Telecom.'
    );
    assert.equal(buildAnalysisNoticeEmail('FIN-1031').subject, '[FIN-1031] Chamado em atendimento');
    const a = buildAnalysisNoticeEmail('TEC-249');
    assert.equal(a.subject, '[TEC-249] Chamado em atendimento');
    assert.equal(
      a.bodyText,
      'Olá, o chamado TEC-249 já está com um técnico da nossa equipe e está sendo tratado dentro do prazo de atendimento. Vamos responder por este e-mail com o andamento ou a solução. Se tiver mais informações, responda mantendo o número no assunto. Equipe de Suporte Seta Telecom.'
    );
    assert.match(a.bodyHtml, /já está com um técnico da nossa equipe/);
    assert.equal(isSetaDeskAnalysisNoticeEnabled({ SETADESK_EMAIL_INTAKE_ENABLED: 'true' }), false);
  });
});

describe('SetaDesk e-mail - timeout do Graph', () => {
  it('cada chamada ao Graph tem timeout (15 s por padrao); estouro vira GRAPH_TIMEOUT e aborta o fetch', async () => {
    assert.equal(SETADESK_GRAPH_TIMEOUT_MS, 15_000);
    const cfg = resolveSetaDeskGraphConfig(
      { SETADESK_GRAPH_TENANT_ID: '11111111-2222-3333-4444-555555555555', SETADESK_GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ...PFX_ENV },
      CFG_NOW
    );
    assert.equal(cfg.ok, true);
    let signal: AbortSignal | undefined;
    const hanging: SetaDeskFetch = (_url, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    };
    const graph = createSetaDeskGraphClient({ config: (cfg as any).config, fetch: hanging, timeoutMs: 30 });
    await assert.rejects(graph.getMessage(TEC_BOX, 'AAMk-x'), (err: any) => err.code === 'GRAPH_TIMEOUT' && err.status === 504);
    assert.equal(signal?.aborted, true);
  });
});

describe('SetaDesk e-mail - processamento', () => {
  it('caso novo: abre TEC-249, origem EMAIL, confirmacao enfileirada uma vez como resposta ao original', async () => {
    const s = store();
    const e = normalizeGraphMessage(graphMsg());
    const r = await processInboundEmail(s, e, ctx());
    assert.equal(r.action, 'CREATED');
    assert.equal(r.action === 'CREATED' && r.ticketKey, 'TEC-249');
    const t = s.state.tickets[0];
    assert.equal(t.channel, 'EMAIL');
    assert.equal(t.pipelineId, 'pl-tec');
    assert.equal(t.requesterEmail, 'cliente@example.com');
    assert.equal(s.state.outbox.length, 1);
    const o = s.state.outbox[0];
    assert.equal(o.kind, 'CONFIRMATION');
    assert.equal(o.subject, '[TEC-249] Recebemos sua solicitação');
    assert.deepEqual(o.to, ['cliente@example.com']);
    assert.equal(o.fromMailbox, TEC_BOX);
    assert.equal(o.inReplyTo, e.messageId);
    assert.equal(o.replyToProviderMessageId, e.providerMessageId);
    assert.equal(s.state.emailMessages[0].linkedBy, 'NEW_TICKET');
    assert.equal(s.state.emailMessages[0].attachments.length, 1);
  });

  it('roteamento FIN: caixa do financeiro abre FIN- com categoria BILLING', async () => {
    const s = store();
    const r = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ to: [FIN_BOX], subject: 'Segunda via de boleto' })), ctx(FIN_BOX));
    assert.equal(r.action === 'CREATED' && r.ticketKey, 'FIN-1031');
    assert.equal(s.state.tickets[0].pipelineId, 'pl-fin');
    assert.equal(s.state.tickets[0].category, 'BILLING');
    assert.equal(s.state.outbox[0].fromMailbox, FIN_BOX);
  });

  it('duplicado por Message-ID: nao abre outro chamado nem outra confirmacao (inclusive vindo pela outra caixa)', async () => {
    const s = store();
    const m = graphMsg();
    await processInboundEmail(s, normalizeGraphMessage(m), ctx());
    const again = await processInboundEmail(s, normalizeGraphMessage({ ...m, id: 'outro-id' }), ctx(FIN_BOX));
    assert.equal(again.action, 'DUPLICATE');
    assert.equal(s.state.tickets.length, 1);
    assert.equal(s.state.outbox.length, 1);
  });

  it('resposta por In-Reply-To: comentario publico CUSTOMER no mesmo chamado, sem nova confirmacao', async () => {
    const s = store();
    const first = normalizeGraphMessage(graphMsg());
    const c = await processInboundEmail(s, first, ctx());
    s.state.tickets[0].status = 'WAITING_CUSTOMER';
    const reply = normalizeGraphMessage(graphMsg({ subject: 'RE: Equipamento sem sinal', headers: { 'In-Reply-To': first.messageId, References: first.messageId } }));
    const r = await processInboundEmail(s, reply, ctx());
    assert.equal(r.action, 'APPENDED');
    assert.equal(r.action === 'APPENDED' && r.linkedBy, 'IN_REPLY_TO');
    assert.equal(r.action === 'APPENDED' && c.action === 'CREATED' && r.ticketId, c.action === 'CREATED' ? c.ticketId : '');
    assert.equal(s.state.comments.length, 1);
    assert.equal(s.state.comments[0].authorRole, 'CUSTOMER');
    assert.equal(s.state.comments[0].isInternal, false);
    assert.equal(s.state.tickets[0].status, 'IN_PROGRESS');
    assert.equal(s.state.outbox.length, 1, 'resposta nunca gera confirmacao');
  });

  it('resposta por References (In-Reply-To desconhecido, ex.: resposta a nossa confirmacao)', async () => {
    const s = store();
    const first = normalizeGraphMessage(graphMsg());
    await processInboundEmail(s, first, ctx());
    const reply = normalizeGraphMessage(graphMsg({ headers: { 'In-Reply-To': '<nossa-confirmacao@desk.example.com>', References: `${first.messageId} <nossa-confirmacao@desk.example.com>` } }));
    const r = await processInboundEmail(s, reply, ctx());
    assert.equal(r.action === 'APPENDED' && r.linkedBy, 'REFERENCES');
  });

  it('resposta por [TEC-n] no assunto (remetente participante)', async () => {
    const s = store();
    await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx());
    const r = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ subject: 'RE: [TEC-249] Recebemos sua solicitação' })), ctx());
    assert.equal(r.action === 'APPENDED' && r.linkedBy, 'SUBJECT_KEY');
    assert.equal(s.state.tickets.length, 1);
  });

  it('[TEC-n] de remetente que nao participa: abre chamado novo com sugestao de relacao (nunca anexa)', async () => {
    const s = store();
    await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx());
    const r = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ from: 'terceiro@example.net', subject: '[TEC-249] outro assunto' })), ctx());
    assert.equal(r.action, 'CREATED');
    assert.equal(s.state.related.length, 1);
    assert.equal(s.state.related[0].reason, 'SUBJECT_KEY_SENDER_NOT_PARTICIPANT');
    assert.equal(s.state.comments.length, 0);
  });

  it('In-Reply-To de remetente que nao participa: chamado novo + sugestao; o chamado original fica intacto', async () => {
    const s = store();
    const first = normalizeGraphMessage(graphMsg());
    const c = await processInboundEmail(s, first, ctx());
    s.state.tickets[0].status = 'WAITING_CUSTOMER';
    const reply = normalizeGraphMessage(graphMsg({ from: 'terceiro@example.net', subject: 'RE: Equipamento sem sinal na filial', headers: { 'In-Reply-To': first.messageId, References: first.messageId } }));
    const r = await processInboundEmail(s, reply, ctx());
    assert.equal(r.action, 'CREATED');
    assert.equal(s.state.tickets.length, 2);
    assert.equal(s.state.comments.length, 0, 'nunca entra no chamado existente');
    assert.equal(s.state.tickets[0].status, 'WAITING_CUSTOMER');
    const rel = s.state.related.filter((x) => x.relatedId === (c.action === 'CREATED' ? c.ticketId : ''));
    assert.equal(rel.length, 1);
    assert.equal(rel[0].reason, 'THREAD_SENDER_NOT_PARTICIPANT');
    assert.equal(rel[0].ticketId, r.action === 'CREATED' ? r.ticketId : '');
  });

  it('References de remetente que nao participa: chamado novo + sugestao (nunca anexa)', async () => {
    const s = store();
    const first = normalizeGraphMessage(graphMsg());
    await processInboundEmail(s, first, ctx());
    const reply = normalizeGraphMessage(graphMsg({ from: 'outro@example.net', headers: { 'In-Reply-To': '<desconhecida@desk.example.com>', References: `${first.messageId} <desconhecida@desk.example.com>` } }));
    const r = await processInboundEmail(s, reply, ctx());
    assert.equal(r.action, 'CREATED');
    assert.equal(s.state.comments.length, 0);
    assert.equal(s.state.related.some((x) => x.reason === 'THREAD_SENDER_NOT_PARTICIPANT'), true);
  });

  it('In-Reply-To de quem esta em cc do chamado: participa, entra como comentario publico', async () => {
    const s = store();
    const first = normalizeGraphMessage(graphMsg({ ccRecipients: [{ emailAddress: { address: 'colega@example.com' } }] }));
    await processInboundEmail(s, first, ctx());
    const reply = normalizeGraphMessage(graphMsg({ from: 'colega@example.com', headers: { 'In-Reply-To': first.messageId } }));
    const r = await processInboundEmail(s, reply, ctx());
    assert.equal(r.action === 'APPENDED' && r.linkedBy, 'IN_REPLY_TO');
    assert.equal(r.action === 'APPENDED' && r.isInternal, false);
    assert.equal(s.state.tickets.length, 1);
  });

  it('mesmo cliente, assunto parecido, e-mail novo: chamados separados + sugestao (sem fusao)', async () => {
    const s = store();
    await processInboundEmail(s, normalizeGraphMessage(graphMsg({ subject: 'Equipamento sem sinal na filial centro' })), ctx());
    const r = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ subject: 'Equipamento sem sinal na filial' })), ctx());
    assert.equal(r.action, 'CREATED');
    assert.equal(s.state.tickets.length, 2);
    assert.equal(s.state.related[0].reason, 'SIMILAR_SUBJECT_SAME_REQUESTER');
    assert.equal(s.state.outbox.length, 2);
  });

  it('auto-reply e bounce ignorados: registrados sem corpo, sem chamado e sem confirmacao', async () => {
    const s = store();
    const a = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ headers: { 'Auto-Submitted': 'auto-replied' } })), ctx());
    const b = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ from: 'postmaster@mail.example.net' })), ctx());
    assert.deepEqual(a, { action: 'IGNORED', reason: 'AUTO_REPLY' });
    assert.deepEqual(b, { action: 'IGNORED', reason: 'BOUNCE' });
    assert.equal(s.state.tickets.length, 0);
    assert.equal(s.state.outbox.length, 0);
    assert.equal(s.state.emailMessages.every((m) => m.bodyText === null && m.processingStatus.startsWith('IGNORED_')), true);
  });

  it('caixa desconhecida: ignorada sem gravar nada', async () => {
    const s = store();
    const r = await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx('outra@desk.example.com'));
    assert.deepEqual(r, { action: 'IGNORED', reason: 'UNKNOWN_MAILBOX' });
    assert.equal(s.state.emailMessages.length, 0);
  });
});

describe('SetaDesk e-mail - outbox e aviso de analise', () => {
  function fakeGraph(fail = 0) {
    const sent: Array<{ mailbox: string; providerMessageId: string | null; to: string[]; subject: string }> = [];
    let failures = fail;
    return {
      sent,
      client: {
        async deltaPage() {
          return { items: [], nextLink: null, deltaLink: null };
        },
        async getMessage(): Promise<GraphMessage> {
          throw new Error('nao usado');
        },
        async sendReply(i: { mailbox: string; providerMessageId: string | null; to: string[]; subject: string }) {
          if (failures > 0) {
            failures -= 1;
            throw new Error('falha simulada');
          }
          sent.push(i);
          return { mode: 'REPLY' as const };
        },
      },
    };
  }

  it('confirmacao: enviada uma unica vez e registrada como comentario publico AGENT', async () => {
    const s = store();
    await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx());
    const g = fakeGraph();
    const r1 = await processSetaDeskOutbox(s, g.client, { now: () => NOW });
    const r2 = await processSetaDeskOutbox(s, g.client, { now: () => NOW });
    assert.equal(r1.sent, 1);
    assert.equal(r2.sent, 0);
    assert.equal(g.sent.length, 1);
    assert.equal(g.sent[0].mailbox, TEC_BOX);
    assert.equal(s.state.outbox[0].status, 'SENT');
    const cm = s.state.comments.find((c) => c.authorRole === 'AGENT')!;
    assert.equal(cm.isInternal, false);
  });

  it('retry com backoff e FAILED apos o maximo de tentativas', async () => {
    assert.equal(nextAttemptDelayMinutes(1), 1);
    assert.equal(nextAttemptDelayMinutes(OUTBOX_MAX_ATTEMPTS), null);
    const s = store();
    await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx());
    const g = fakeGraph(100);
    let t = NOW.getTime();
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i += 1) {
      await processSetaDeskOutbox(s, g.client, { now: () => new Date(t) });
      t += 7 * 3600_000;
    }
    assert.equal(s.state.outbox[0].status, 'FAILED');
    assert.equal(s.state.outbox[0].attempts, OUTBOX_MAX_ATTEMPTS);
    assert.equal(s.state.outbox[0].lastError, 'SEND_FAILED');
  });

  it('aviso de analise: so com as duas flags, uma unica vez, grava first_viewed e quem abriu', async () => {
    const s = store();
    const c = await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx());
    const id = c.action === 'CREATED' ? c.ticketId : '';
    const env = { ...ON, SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED: 'true' };
    const r1 = await markSetaDeskTicketViewed(s, 'TEC-249', 'tecnico@example.com', { env, now: () => NOW });
    const r2 = await markSetaDeskTicketViewed(s, id, 'outro@example.com', { env, now: () => NOW });
    assert.deepEqual(r1, { recorded: true, firstTime: true, analysisQueued: true });
    assert.deepEqual(r2, { recorded: true, firstTime: false, analysisQueued: false });
    const notices = s.state.outbox.filter((o) => o.kind === 'ANALYSIS_NOTICE');
    assert.equal(notices.length, 1);
    assert.equal(notices[0].subject, '[TEC-249] Chamado em atendimento');
    assert.equal(notices[0].replyToProviderMessageId, s.state.emailMessages[0].providerMessageId);
    assert.equal(s.state.tickets[0].firstViewedBy, 'tecnico@example.com');
    assert.equal(s.state.tickets[0].firstViewedAt, NOW.toISOString());
  });

  it('aviso de analise: sem a flag propria registra a abertura mas nao enfileira; chamado nao-email nunca recebe', async () => {
    const s = store();
    await processInboundEmail(s, normalizeGraphMessage(graphMsg()), ctx());
    const r = await markSetaDeskTicketViewed(s, 'TEC-249', 'tecnico@example.com', { env: ON, now: () => NOW });
    assert.deepEqual(r, { recorded: true, firstTime: true, analysisQueued: false });
    s.state.tickets.push({ ...s.state.tickets[0], id: 'tkt-web', key: 'TEC-1', channel: 'WEB_PORTAL', source: 'STIHUB', firstViewedAt: null });
    const r2 = await markSetaDeskTicketViewed(s, 'TEC-1', 'x', { env: { ...ON, SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED: '1' }, now: () => NOW });
    assert.deepEqual(r2, { recorded: true, firstTime: true, analysisQueued: false });
    assert.equal(s.state.outbox.filter((o) => o.kind === 'ANALYSIS_NOTICE').length, 0);
  });
});

describe('SetaDesk e-mail - ciclo de entrada (Graph falso) e flag desligada', () => {
  const tenant = '11111111-2222-3333-4444-555555555555';
  const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const SECRET_TOKEN = 'token-super-secreto-de-teste-123';

  function fakeFetch(messages: GraphMessage[]) {
    const calls: Array<{ url: string; method: string }> = [];
    const f: SetaDeskFetch = async (url, init) => {
      const method = init?.method || 'GET';
      calls.push({ url, method });
      const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
      if (url.startsWith('https://login.microsoftonline.com/')) return json({ access_token: SECRET_TOKEN, expires_in: 3600 });
      if (url.includes('/messages/delta')) {
        const box = decodeURIComponent(url.split('/users/')[1].split('/')[0]);
        const items = box === TEC_BOX ? messages.map((m) => ({ id: m.id, receivedDateTime: m.receivedDateTime })) : [];
        return json({ value: items, '@odata.deltaLink': `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box)}/mailFolders('inbox')/messages/delta?$deltatoken=t1` });
      }
      const mm = url.match(/\/messages\/([^/?]+)\?/);
      if (mm && method === 'GET') {
        const m = messages.find((x) => x.id === decodeURIComponent(mm[1]));
        return m ? json(m) : json({ error: { code: 'ErrorItemNotFound' } }, 404);
      }
      if (/\/reply$/.test(url) && method === 'POST') return json(null, 202);
      return json({ error: { code: 'Unexpected' } }, 400);
    };
    return { f, calls };
  }

  it('flag desligada: nenhuma chamada ao Graph e nada gravado', async () => {
    const s = store();
    const { f, calls } = fakeFetch([graphMsg()]);
    const cfg = resolveSetaDeskGraphConfig({ SETADESK_GRAPH_TENANT_ID: tenant, SETADESK_GRAPH_CLIENT_ID: client, ...PFX_ENV }, CFG_NOW);
    assert.equal(cfg.ok, true);
    const r = await runSetaDeskEmailIntake({ store: s, graph: createSetaDeskGraphClient({ config: (cfg as any).config, fetch: f }), env: {} });
    assert.deepEqual(r, { enabled: false });
    assert.equal(calls.length, 0);
    assert.equal(s.state.emailMessages.length, 0);
    assert.equal(s.state.sync.size, 0);
  });

  it('ciclo completo: le delta (so GET), abre chamado, responde por /reply, guarda cursor; nenhum segredo nos logs', async () => {
    const s = store();
    const msgs = [graphMsg(), graphMsg({ headers: { 'Auto-Submitted': 'auto-replied' } }), graphMsg({ receivedDateTime: '2026-01-01T00:00:00Z' })];
    const { f, calls } = fakeFetch(msgs);
    const env = { ...ON, SETADESK_GRAPH_TENANT_ID: tenant, SETADESK_GRAPH_CLIENT_ID: client, ...PFX_ENV };
    const cfg = resolveSetaDeskGraphConfig(env, CFG_NOW);
    assert.equal(cfg.ok, true);
    const lines: string[] = [];
    const orig = { log: console.log, info: console.info, error: console.error, warn: console.warn };
    const capture = (...a: unknown[]) => lines.push(a.map(String).join(' '));
    console.log = capture; console.info = capture; console.error = capture; console.warn = capture;
    let r;
    try {
      r = await runSetaDeskEmailIntake({ store: s, graph: createSetaDeskGraphClient({ config: (cfg as any).config, fetch: f }), env, now: () => NOW });
    } finally {
      Object.assign(console, orig);
    }
    assert.equal(r!.enabled, true);
    const tec = (r as any).mailboxes.find((m: any) => m.prefix === 'TEC');
    assert.equal(tec.created, 1);
    assert.equal(tec.ignored, 1);
    assert.equal(tec.skippedBeforeStart, 1);
    assert.equal((r as any).outbox.sent, 1);
    // Mail.Read: nenhuma escrita na caixa alem do /reply (Mail.Send); nunca PATCH/move/delete.
    assert.equal(calls.some((c) => c.method === 'PATCH' || c.method === 'DELETE' || /\/move|\/copy/.test(c.url)), false);
    assert.equal(calls.filter((c) => c.method === 'POST' && c.url.includes('graph.microsoft.com')).every((c) => /\/reply$/.test(c.url)), true);
    assert.match(s.state.sync.get(TEC_BOX)!.deltaLink || '', /deltatoken=t1/);
    const blob = lines.join('\n');
    assert.ok(lines.length >= 1);
    for (const secret of [SECRET_TOKEN, tenant, client, 'PRIVATE KEY', TEST_PFX.b64.slice(0, 40), TEST_PFX_PASSWORD, TEST_PFX.thumb, 'cliente@example.com', TEC_BOX, 'Equipamento']) {
      assert.equal(blob.includes(secret), false, `log contem dado sensivel: ${secret.slice(0, 12)}`);
    }
  });

  it('segunda execucao reaproveita o cursor e nao reabre o mesmo e-mail', async () => {
    const s = store();
    const msgs = [graphMsg()];
    const { f } = fakeFetch(msgs);
    const env = { ...ON, SETADESK_GRAPH_TENANT_ID: tenant, SETADESK_GRAPH_CLIENT_ID: client, ...PFX_ENV };
    const graph = createSetaDeskGraphClient({ config: (resolveSetaDeskGraphConfig(env, CFG_NOW) as any).config, fetch: f });
    const log = () => undefined;
    await runSetaDeskEmailIntake({ store: s, graph, env, now: () => NOW, log });
    const r2 = await runSetaDeskEmailIntake({ store: s, graph, env, now: () => NOW, log });
    assert.equal((r2 as any).mailboxes.find((m: any) => m.prefix === 'TEC').duplicates, 1);
    assert.equal(s.state.tickets.length, 1);
    assert.equal(s.state.outbox.length, 1);
  });
});

describe('SetaDesk e-mail - router, rotas e migracao', () => {
  it('rotas diretas nao carregam a lista de chamados', () => {
    assert.equal(isSetaDeskEmailDirectRoute('POST', '/api/tickets/email-intake/poll'), true);
    assert.equal(isSetaDeskEmailDirectRoute('POST', '/api/tickets/TEC-249/mark-viewed'), true);
    assert.equal(isSetaDeskEmailDirectRoute('GET', '/api/tickets/TEC-249'), false);
    assert.equal(matchMarkViewedPath('/api/tickets/TEC-249/mark-viewed'), 'TEC-249');
    assert.equal(shouldLoadSetaDeskTicketsForRoute('POST', '/api/tickets/TEC-249/mark-viewed'), false);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('GET', '/api/tickets/TEC-249'), true);
  });

  it('flag desligada no router: poll 409 e mark-viewed sem efeito; sem sessao => 401', async () => {
    const saved = process.env.SETADESK_EMAIL_INTAKE_ENABLED;
    delete process.env.SETADESK_EMAIL_INTAKE_ENABLED;
    try {
      const router = new CrmApiRouter(createInMemoryRepository());
      const poll = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/tickets/email-intake/poll', query: {}, body: {} });
      assert.equal(poll.status, 409);
      assert.equal((poll.body as any).code, 'EMAIL_INTAKE_DISABLED');
      const mv = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/tickets/TEC-1/mark-viewed', query: {}, body: {} });
      assert.equal(mv.status, 200);
      assert.deepEqual((mv.body as any).data, { recorded: false, reason: 'INTAKE_DISABLED' });
      const anon = await router.dispatch({ method: 'POST', path: '/api/tickets/email-intake/poll', query: {}, body: {} });
      assert.equal(anon.status, 401);
    } finally {
      if (saved !== undefined) process.env.SETADESK_EMAIL_INTAKE_ENABLED = saved;
    }
  });

  it('migracao 0006 e idempotente e nao apaga nada', () => {
    const m = SETADESK_MIGRATIONS.find((x) => x.id === '0006_email_intake');
    assert.ok(m);
    assert.doesNotMatch(m!.sql, /\b(DROP|DELETE|TRUNCATE)\b/i);
    for (const stmt of m!.sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      assert.match(stmt, /IF NOT EXISTS/i);
    }
  });
});

describe('SetaDesk e-mail - Postgres real (opcional)', { skip: !process.env.SETADESK_TEST_DATABASE_URL }, () => {
  let pool: import('pg').Pool;
  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.SETADESK_TEST_DATABASE_URL });
    const { applySetaDeskMigrations } = await import('../src/db/setadesk-schema');
    await applySetaDeskMigrations(pool);
    await pool.query(`UPDATE setadesk_pipelines SET mailbox = CASE id WHEN 'pl-tec' THEN $1 WHEN 'pl-fin' THEN $2 END WHERE id IN ('pl-tec','pl-fin')`, [TEC_BOX, FIN_BOX]);
  });
  after(async () => {
    await pool?.end();
  });

  it('fluxo completo no banco: novo, duplicado, resposta, outbox e first_viewed', async () => {
    const { createPostgresSetaDeskEmailStore } = await import('../src/modules/setadesk-email/store-postgres');
    const s = createPostgresSetaDeskEmailStore(pool);
    const pipelines = await s.listPipelines();
    const c2 = { mailbox: TEC_BOX, pipelines, now: () => NOW };
    const run = crypto.randomBytes(6).toString('hex');
    const m = graphMsg({ id: `pg-${run}-1`, from: `pg-${run}@example.com`, headers: { 'Message-ID': `<pg-${run}-1@mail.example.com>` } });
    const first = normalizeGraphMessage(m);
    const r = await processInboundEmail(s, first, c2);
    assert.equal(r.action, 'CREATED');
    assert.equal((await processInboundEmail(s, normalizeGraphMessage(m), c2)).action, 'DUPLICATE');
    const rep = await processInboundEmail(s, normalizeGraphMessage(graphMsg({ id: `pg-${run}-2`, from: m.from!.emailAddress!.address, headers: { 'Message-ID': `<pg-${run}-2@mail.example.com>`, 'In-Reply-To': first.messageId } })), c2);
    assert.equal(rep.action, 'APPENDED');
    const key = r.action === 'CREATED' ? r.ticketKey : '';
    const env = { ...ON, SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED: '1' };
    const v1 = await markSetaDeskTicketViewed(s, key, 'tecnico@example.com', { env, now: () => NOW });
    const v2 = await markSetaDeskTicketViewed(s, key, 'tecnico@example.com', { env, now: () => NOW });
    assert.deepEqual(v1, { recorded: true, firstTime: true, analysisQueued: true });
    assert.deepEqual(v2, { recorded: true, firstTime: false, analysisQueued: false });
    const sent: string[] = [];
    const out = await processSetaDeskOutbox(s, {
      deltaPage: async () => ({ items: [], nextLink: null, deltaLink: null }),
      getMessage: async () => { throw new Error('x'); },
      sendReply: async (i) => { sent.push(i.subject); return { mode: 'REPLY' }; },
    }, { now: () => new Date(Date.now() + 60_000) });
    assert.ok(out.sent >= 2);
    assert.ok(sent.includes(`[${key}] Recebemos sua solicitação`));
    await s.saveSyncState(TEC_BOX, { intakeStartedAt: NOW.toISOString() });
    await s.saveSyncState(TEC_BOX, { deltaLink: 'https://graph.microsoft.com/v1.0/users/x/delta?t=1', errorCode: null });
    const st = await s.getSyncState(TEC_BOX);
    assert.equal(st!.deltaLink, 'https://graph.microsoft.com/v1.0/users/x/delta?t=1');
    assert.ok(st!.intakeStartedAt);
  });
});
