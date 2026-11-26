// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 3b — ENVIOS e ACOES COM EFEITO EXTERNO.
// E-mail pela caixa do PROPRIO dono da credencial, inscricao em cadencia ATIVA, follow-up de
// proposta, aceite de proposta, links publicos, ativar/disparar workflow, disparo de campanha e
// envio em lote de cobranca de contratos. Sempre em duas etapas (dangerous.ts).
// ============================================================================
import { z } from 'zod/v4';
import { contactInScope, companyInScope, dealInScope } from '../portfolio';
import { requireAllPortfolio, userHasAccess, userHasErpAccess } from './common';
import { unwrapRead, workflowsData } from './crm-extra';
import { defineDangerous, unwrapDangerous } from './dangerous';
import { collections, findWritableContract, loadWritableProposal, str } from './erp';
import { IdSchema, notFound, text, UseCaseError, type UseCaseContext, type UseCaseDefinition } from './types';

const enc = encodeURIComponent;
const crmBase = { tag: 'CRM' as const, requiredModule: 'crm' as const, domain: 'crm' as const };
const erpBase = { tag: 'ERP' as const, requiredModule: 'erp' as const, domain: 'erp' as const };
const Email = z.string().trim().toLowerCase().email().max(200);

function requireErpEdit(ctx: UseCaseContext, area: 'proposals' | 'contracts' | 'finance'): void {
  if (!userHasErpAccess(ctx.owner, area, 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', `O usuario dono nao tem edicao na area ${area} do ERP.`, { area });
}
function requireMarketingEdit(ctx: UseCaseContext): void {
  if (!userHasAccess(ctx.owner, 'marketing', 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono nao tem edicao em marketing/automacao.');
}
async function crmLinksInScope(ctx: UseCaseContext, ids: { contactId?: string; companyId?: string; dealId?: string }) {
  if (!ids.contactId && !ids.companyId && !ids.dealId) return;
  const snap = await ctx.data.snapshot('crm');
  if (ids.contactId && !snap.contacts.some((c) => c.id === ids.contactId && contactInScope(ctx.portfolio, c))) throw notFound('Contato');
  if (ids.companyId && !snap.companies.some((c) => c.id === ids.companyId && companyInScope(ctx.portfolio, c))) throw notFound('Empresa');
  if (ids.dealId && !snap.deals.some((d) => d.id === ids.dealId && dealInScope(ctx.portfolio, d))) throw notFound('Negocio');
}

// ---------------------------------------------------------------------------
// E-mail pela caixa do dono (Outlook conectado na tela)
// ---------------------------------------------------------------------------
/** CISO 26/11 (Lote 3, 3): limites do envio de e-mail pelo conector. */
export const EMAIL_BODY_MAX_CHARS = 5_000;
export const EMAIL_DAILY_LIMIT_PER_USER = 50;

const commsEmailSend = defineDangerous({
  ...crmBase,
  name: 'comms_email_send',
  operationId: 'comms.email.send',
  path: '/api/v1/comms/email/send',
  pathParams: [],
  requiredScope: 'comms:send',
  op: 'send',
  summary: 'Enviar e-mail pela caixa do usuario',
  description:
    `Envia e-mail pela caixa do Outlook JA conectada pelo proprio usuario dono da credencial (nunca outra caixa) e registra na ficha. Destinatarios (to/cc) SO contatos cadastrados na carteira do usuario; bcc so para usuarios internos ativos; corpo ate ${EMAIL_BODY_MAX_CHARS} caracteres; ate 10 destinatarios; ${EMAIL_DAILY_LIMIT_PER_USER} envios/dia por usuario; sem anexos.`,
  inputSchema: z
    .object({
      to: z.array(Email).min(1).max(10),
      cc: z.array(Email).max(10).default([]),
      bcc: z.array(Email).max(10).default([]),
      subject: text(200).min(1),
      body: z.string().max(EMAIL_BODY_MAX_CHARS),
      bodyFormat: z.enum(['text', 'html']).default('text'),
      contactId: IdSchema.optional(),
      companyId: IdSchema.optional(),
      dealId: IdSchema.optional(),
    })
    .strict(),
  async plan(input, ctx) {
    const total = input.to.length + input.cc.length + input.bcc.length;
    if (total > 10) throw new UseCaseError(422, 'TOO_MANY_RECIPIENTS', 'No maximo 10 destinatarios (to+cc+bcc) por envio pelo conector.');
    await crmLinksInScope(ctx, input);
    // to/cc: so e-mail de contato cadastrado NA CARTEIRA do usuario (fora/desconhecido => mesma recusa, sem oraculo).
    const snap = await ctx.data.snapshot('crm');
    const portfolioEmails = new Set(
      snap.contacts.filter((c) => contactInScope(ctx.portfolio, c)).map((c: any) => String(c.email || '').trim().toLowerCase()).filter(Boolean)
    );
    const outside = [...input.to, ...input.cc].filter((e) => !portfolioEmails.has(e));
    if (outside.length) {
      throw new UseCaseError(422, 'RECIPIENT_NOT_IN_PORTFOLIO', 'Destinatario (to/cc) precisa ser contato cadastrado na carteira do usuario.', { count: outside.length });
    }
    // bcc: nunca externo — so usuarios internos ativos do STI-hub.
    const internal = new Set(ctx.allUsers.filter((u) => u.active).map((u) => u.email.toLowerCase()));
    if (input.bcc.some((e) => !internal.has(e))) {
      throw new UseCaseError(422, 'BCC_EXTERNAL_FORBIDDEN', 'Copia oculta (bcc) so para usuarios internos ativos.');
    }
    return {
      entity: 'comms.email',
      entityId: input.contactId || input.dealId || input.companyId || 'avulso',
      before: null,
      preview: {
        action: 'ENVIAR_EMAIL',
        from: ctx.owner.email,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        bodyChars: input.body.length,
        bodyStart: input.body.slice(0, 280),
        links: { contactId: input.contactId || null, companyId: input.companyId || null, dealId: input.dealId || null },
        dailyLimit: EMAIL_DAILY_LIMIT_PER_USER,
      },
      effects: ['E-mail sai da caixa do Outlook do usuario e nao pode ser desfeito.', 'Registro na linha do tempo da ficha (rastreamento conforme a regra da tela).', `Conta 1 no limite diario (${EMAIL_DAILY_LIMIT_PER_USER}/dia por usuario).`],
      run: async () => {
        // Cota diaria POR USUARIO (todas as credenciais somadas), consumida antes de enviar.
        await ctx.quota.consumeDaily('comms_email_send', EMAIL_DAILY_LIMIT_PER_USER);
        const payload: Record<string, unknown> = { to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, body: input.body, bodyFormat: input.bodyFormat };
        for (const k of ['contactId', 'companyId', 'dealId'] as const) if (input[k]) payload[k] = input[k];
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/mailbox/send', payload, { actorUserId: ctx.owner.id }), 'Caixa');
        return { sent: true, recipients: total, messageId: str(r?.id || r?.messageId) || null };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Cadencia (so ATIVA), follow-up de proposta
// ---------------------------------------------------------------------------
const crmSequencesEnroll = defineDangerous({
  ...crmBase,
  name: 'crm_sequences_enroll',
  operationId: 'crm.sequences.enroll',
  path: '/api/v1/crm/sequences/{sequenceId}/enroll',
  pathParams: ['sequenceId'],
  requiredScope: 'comms:send',
  op: 'enroll',
  summary: 'Inscrever contato em cadencia ativa',
  description: 'Inscreve um contato da carteira numa cadencia ATIVA (dispara os e-mails/tarefas da cadencia). Cadencia inativa/rascunho => 409.',
  inputSchema: z.object({ sequenceId: IdSchema, contactId: IdSchema, dealId: IdSchema.optional() }).strict(),
  async plan(input, ctx) {
    await crmLinksInScope(ctx, { contactId: input.contactId, dealId: input.dealId });
    const body = unwrapRead(await ctx.data.read('/api/sequences'), 'Cadencias');
    const seq = ((Array.isArray(body?.data) ? body.data : []) as any[]).find((s) => s && s.id === input.sequenceId);
    if (!seq) throw notFound('Cadencia');
    if (seq.isActive !== true) throw new UseCaseError(409, 'SEQUENCE_NOT_ACTIVE', 'Cadencia nao esta ativa: o conector so inscreve em cadencia ativa.');
    return {
      entity: 'crm.sequence_enrollment',
      entityId: input.contactId,
      before: null,
      preview: { action: 'INSCREVER_EM_CADENCIA', sequence: { id: seq.id, name: str(seq.name), steps: Array.isArray(seq.steps) ? seq.steps.length : 0 }, contactId: input.contactId, dealId: input.dealId || null },
      effects: ['Os passos da cadencia (e-mails/tarefas) passam a ser executados automaticamente.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/sequences/enroll', { sequenceId: seq.id, contactId: input.contactId, dealId: input.dealId || null }), 'Cadencia');
        return { enrolled: true, enrollmentId: str(r?.id || r?.enrollment?.id) || null, status: str(r?.status || r?.enrollment?.status) || null };
      },
    };
  },
});

const crmProposalFollowup = defineDangerous({
  ...crmBase,
  name: 'crm_proposal_followup_set',
  operationId: 'crm.proposal_followup.set',
  path: '/api/v1/crm/deals/{dealId}/proposal-followup',
  pathParams: ['dealId'],
  requiredScope: 'comms:send',
  op: 'followup',
  summary: 'Pausar ou retomar follow-up automatico de proposta',
  description: 'Pausa ou retoma a sequencia de follow-up por e-mail da proposta vinculada ao negocio (carteira). Retomar com o recurso desligado => 409.',
  inputSchema: z.object({ dealId: IdSchema, action: z.enum(['pause', 'resume']) }).strict(),
  async plan(input, ctx) {
    await crmLinksInScope(ctx, { dealId: input.dealId });
    return {
      entity: 'crm.proposal_followup',
      entityId: input.dealId,
      before: null,
      preview: { action: input.action === 'resume' ? 'RETOMAR_FOLLOWUP' : 'PAUSAR_FOLLOWUP', dealId: input.dealId },
      effects: input.action === 'resume' ? ['E-mails de follow-up voltam a sair automaticamente.'] : ['Nenhum e-mail de follow-up sai enquanto pausado.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/deals/${enc(input.dealId)}/proposal-followup`, { action: input.action }), 'Negocio');
        return { action: input.action, status: str(r?.status || r?.state) || null };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Proposta: link publico (o aceite e do cliente, no link); link publico de fatura
// ---------------------------------------------------------------------------
// CISO 26/11 (Lote 3, item 7): o conector NAO registra aceite de proposta (signatario/CPF) nem aceite de
// termos em nome do cliente. O aceite so acontece pelo proprio cliente no link publico.

const erpProposalsPublicLink = defineDangerous({
  ...erpBase,
  name: 'erp_proposals_public_link',
  operationId: 'erp.proposals.public_link',
  path: '/api/v1/erp/proposals/{id}/public-link',
  pathParams: ['id'],
  requiredScope: 'erp:public_links:write',
  op: 'public_link',
  summary: 'Gerar link publico da proposta para o cliente',
  description: 'Gera o link assinado (com expiracao) para o cliente ver e aceitar a proposta. RASCUNHO passa a ENVIADA (regra da tela). Proposta da carteira; edicao de propostas.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireErpEdit(ctx, 'proposals');
    const p: any = await loadWritableProposal(ctx, input.id);
    const draft = String(p.status || '').toUpperCase() === 'RASCUNHO';
    return {
      entity: 'erp.proposal',
      entityId: p.id,
      before: { status: str(p.status) },
      preview: { action: 'GERAR_LINK_PUBLICO', id: p.id, code: str(p.code) || null, status: str(p.status), becomesSent: draft },
      effects: ['Quem tiver o link ve a proposta e pode aceita-la ate expirar.', ...(draft ? ['Status muda de RASCUNHO para ENVIADA.'] : [])],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/proposals/${enc(p.id)}/public-link`, {}, { actorUserId: ctx.owner.id }), 'Proposta');
        return { url: str(r?.url) || null, expiresAt: str(r?.expiresAt) || null };
      },
    };
  },
});

const erpInvoicesPublicLink = defineDangerous({
  ...erpBase,
  name: 'erp_invoices_public_link',
  operationId: 'erp.invoices.public_link',
  path: '/api/v1/erp/invoices/{id}/public-link',
  pathParams: ['id'],
  requiredScope: 'erp:public_links:write',
  op: 'public_link',
  summary: 'Gerar link publico da fatura para o cliente',
  description: 'Gera o link assinado (com expiracao) da fatura EMITIDA para o cliente pagar. Carteira TODOS + edicao do financeiro.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Link publico de fatura');
    requireErpEdit(ctx, 'finance');
    const inv: any = (await collections(ctx)).invoices.find((i) => i.id === input.id || str(i.documentNumber) === input.id);
    if (!inv) throw notFound('Fatura');
    return {
      entity: 'erp.invoice',
      entityId: inv.id,
      before: null,
      preview: { action: 'GERAR_LINK_PUBLICO', id: inv.id, documentNumber: str(inv.documentNumber) || null, companyName: str(inv.companyName) || null, netAmount: Number(inv.netAmount) || 0, status: str(inv.status) },
      effects: ['Quem tiver o link ve a fatura (boleto/PIX) ate expirar.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/invoices/${enc(inv.id)}/public-link`, {}, { actorUserId: ctx.owner.id }), 'Fatura');
        return { url: str(r?.url) || null, expiresAt: str(r?.expiresAt) || null };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Workflows: ativar e disparar
// ---------------------------------------------------------------------------
async function findWorkflow(ctx: UseCaseContext, id: string): Promise<any> {
  const w = (await workflowsData(ctx)).workflows.find((x) => x && x.id === id);
  if (!w) throw notFound('Workflow');
  return w;
}

const automationWorkflowsActivate = defineDangerous({
  ...crmBase,
  name: 'automation_workflows_activate',
  operationId: 'automation.workflows.activate',
  path: '/api/v1/automation/workflows/{id}/activate',
  pathParams: ['id'],
  requiredScope: 'crm:automation:activate',
  op: 'activate',
  summary: 'Ativar workflow',
  description: 'Ativa um workflow (passa a rodar sozinho nos gatilhos sobre a base inteira). Carteira TODOS + edicao de marketing/automacao.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Ativar workflow');
    requireMarketingEdit(ctx);
    const w = await findWorkflow(ctx, input.id);
    if (w.isActive === true) throw new UseCaseError(409, 'WORKFLOW_ALREADY_ACTIVE', 'Workflow ja esta ativo.');
    return {
      entity: 'automation.workflow',
      entityId: w.id,
      before: { isActive: false },
      preview: { action: 'ATIVAR_WORKFLOW', id: w.id, name: str(w.name), triggerType: str(w.triggerType), steps: Array.isArray(w.steps) ? w.steps.length : 0 },
      effects: ['O workflow passa a executar automaticamente (e-mails, tarefas, atualizacoes) a cada gatilho.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('PATCH', `/api/workflows/${enc(w.id)}`, { isActive: true }), 'Workflow');
        return { id: w.id, isActive: r?.isActive === true };
      },
    };
  },
});

const automationWorkflowsTrigger = defineDangerous({
  ...crmBase,
  name: 'automation_workflows_trigger',
  operationId: 'automation.workflows.trigger',
  path: '/api/v1/automation/workflows/{workflowId}/trigger',
  pathParams: ['workflowId'],
  requiredScope: 'crm:automation:activate',
  op: 'trigger',
  summary: 'Disparar workflow para um registro',
  description: 'Executa agora um workflow ATIVO para um contato/empresa/negocio da carteira (edicao de marketing/automacao).',
  inputSchema: z.object({ workflowId: IdSchema, entityType: z.enum(['CONTACT', 'COMPANY', 'DEAL']), entityId: IdSchema }).strict(),
  async plan(input, ctx) {
    requireMarketingEdit(ctx);
    const w = await findWorkflow(ctx, input.workflowId);
    if (w.isActive !== true) throw new UseCaseError(409, 'WORKFLOW_NOT_ACTIVE', 'So workflow ativo pode ser disparado.');
    const link = input.entityType === 'CONTACT' ? { contactId: input.entityId } : input.entityType === 'COMPANY' ? { companyId: input.entityId } : { dealId: input.entityId };
    await crmLinksInScope(ctx, link);
    return {
      entity: 'automation.workflow',
      entityId: w.id,
      before: null,
      preview: { action: 'DISPARAR_WORKFLOW', workflow: { id: w.id, name: str(w.name), triggerType: str(w.triggerType) }, entityType: input.entityType, entityId: input.entityId },
      effects: ['Os passos do workflow rodam agora para o registro (podem enviar e-mail/criar tarefas).'],
      run: async () => {
        const r = await ctx.data.dangerous('POST', '/api/workflows/trigger', { triggerType: str(w.triggerType), entityType: input.entityType, entityId: input.entityId, workflowId: w.id, context: {} });
        unwrapDangerous(r, 'Workflow');
        const count = Number((r.body as any)?.count) || 0;
        return { workflowId: w.id, executions: count };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Campanha: disparo
// ---------------------------------------------------------------------------
const marketingCampaignsDispatch = defineDangerous({
  ...crmBase,
  name: 'marketing_campaigns_dispatch',
  operationId: 'marketing.campaigns.dispatch',
  path: '/api/v1/marketing/campaigns/{campaignId}/dispatch',
  pathParams: ['campaignId'],
  requiredScope: 'crm:marketing:dispatch',
  op: 'dispatch',
  summary: 'Disparar campanha de e-mail marketing',
  description:
    'Dispara (ou agenda) a campanha para um segmento ou lista de contatos com um modelo aprovado. Envio real so se o envio real estiver ligado no app (senao simulado). Carteira TODOS + edicao de marketing.',
  inputSchema: z
    .object({
      campaignId: IdSchema,
      templateId: IdSchema,
      segmentId: IdSchema.optional(),
      contactIds: z.array(IdSchema).min(1).max(500).optional(),
      scheduleAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/).optional(),
    })
    .strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Disparo de campanha');
    requireMarketingEdit(ctx);
    if (Boolean(input.segmentId) === Boolean(input.contactIds)) throw new UseCaseError(422, 'VALIDATION_ERROR', 'Informe segmentId OU contactIds.');
    const body = unwrapRead(await ctx.data.read('/api/marketing/campaigns'), 'Campanhas');
    const c = ((Array.isArray(body?.data) ? body.data : []) as any[]).find((x) => x && x.id === input.campaignId);
    if (!c) throw notFound('Campanha');
    return {
      entity: 'marketing.campaign',
      entityId: c.id,
      before: { status: str(c.status) },
      preview: { action: input.scheduleAt ? 'AGENDAR_CAMPANHA' : 'DISPARAR_CAMPANHA', campaign: { id: c.id, name: str(c.name), status: str(c.status) }, templateId: input.templateId, segmentId: input.segmentId || null, contacts: input.contactIds?.length ?? null, scheduleAt: input.scheduleAt || null },
      effects: ['E-mails em massa saem para os destinatarios (respeitando descadastro/consentimento do app). Nao ha desfazer.'],
      run: async () => {
        const payload: Record<string, unknown> = { campaignId: c.id, templateId: input.templateId };
        if (input.segmentId) payload.segmentId = input.segmentId;
        if (input.contactIds) payload.contactIds = input.contactIds;
        if (input.scheduleAt) payload.scheduleAt = input.scheduleAt;
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/marketing/campaigns/dispatch', payload), 'Campanha');
        return { dispatched: true, queued: Number(r?.queued ?? r?.sent ?? r?.recipients ?? r?.total) || 0, scheduled: Boolean(input.scheduleAt) };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Contratos: e-mail de cobranca em lote
// ---------------------------------------------------------------------------
const erpContractsBatchEmail = defineDangerous({
  ...erpBase,
  name: 'erp_contracts_batch_email',
  operationId: 'erp.contracts.batch_email',
  path: '/api/v1/erp/contracts/batch-email',
  pathParams: [],
  requiredScope: 'comms:send',
  op: 'send',
  summary: 'Enviar e-mail de cobranca em lote dos contratos',
  description: 'Envia o e-mail de cobranca da competencia para ate 50 contratos da carteira (edicao de contratos).',
  inputSchema: z
    .object({
      contractIds: z.array(IdSchema).min(1).max(50),
      competenceMonth: z.string().regex(/^\d{2}\/\d{4}$/, 'competencia MM/AAAA').optional(),
      customMessage: text(2000).optional(),
    })
    .strict(),
  async plan(input, ctx) {
    requireErpEdit(ctx, 'contracts');
    const unique = [...new Set(input.contractIds)];
    const list: any[] = [];
    for (const id of unique) list.push(await findWritableContract(ctx, id));
    return {
      entity: 'erp.contract',
      entityId: list.map((c) => c.id).join(',').slice(0, 120),
      before: null,
      preview: { action: 'ENVIAR_COBRANCA_EM_LOTE', competenceMonth: input.competenceMonth || null, contracts: list.map((c) => ({ id: c.id, contractNumber: str(c.contractNumber), companyName: str(c.companyName) })) },
      effects: [`${list.length} e-mail(s) de cobranca para os clientes dos contratos.`],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/erp/rental-contracts/batch-email', { contractIds: list.map((c) => c.id), competenceMonth: input.competenceMonth, customMessage: input.customMessage }), 'Contratos');
        return { sent: Number(r?.sentCount ?? r?.sent ?? (Array.isArray(r?.results) ? r.results.length : 0)) || 0, failed: Number(r?.failedCount ?? r?.failed) || 0 };
      },
    };
  },
});

export const lote3bUseCases: UseCaseDefinition[] = [
  ...commsEmailSend,
  ...crmSequencesEnroll,
  ...crmProposalFollowup,
  ...erpProposalsPublicLink,
  ...erpInvoicesPublicLink,
  ...automationWorkflowsActivate,
  ...automationWorkflowsTrigger,
  ...marketingCampaignsDispatch,
  ...erpContractsBatchEmail,
];
