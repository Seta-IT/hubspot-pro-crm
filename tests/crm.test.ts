// ============================================================================
// HubSpot Pro CRM - Comprehensive Automated Test Suite (Node Test Runner)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateEmail,
  normalizeAndValidatePhone,
  validateCnpj,
  normalizeCorporateDomain,
} from '../src/modules/data-health/validators';
import {
  calculateContactCompleteness,
  calculateCompanyCompleteness,
} from '../src/modules/data-health/completeness';
import {
  detectDuplicateContacts,
  detectDuplicateCompanies,
  jaroWinklerSimilarity,
  levenshteinSimilarity,
} from '../src/modules/data-health/deduplication';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';

describe('1. Validação & Padronização (validators.ts)', () => {
  it('valida sintaxe de e-mail, domínios descartáveis e corporativos vs gratuitos', () => {
    const corp = validateEmail('  Marina.Costa@Nubank.com.br ');
    assert.equal(corp.isValid, true);
    assert.equal(corp.normalizedEmail, 'marina.costa@nubank.com.br');
    assert.equal(corp.domain, 'nubank.com.br');
    assert.equal(corp.isCorporate, true);
    assert.equal(corp.isFreeProvider, false);

    const free = validateEmail('joao.silva@gmail.com');
    assert.equal(free.isValid, true);
    assert.equal(free.isFreeProvider, true);
    assert.equal(free.isCorporate, false);

    const disp = validateEmail('lead.falso@mailinator.com');
    assert.equal(disp.isValid, false);
    assert.equal(disp.isDisposable, true);
    assert.equal(disp.reason, 'DISPOSABLE_DOMAIN');

    const bad = validateEmail('email-invalido@@dominio');
    assert.equal(bad.isValid, false);
  });

  it('normaliza telefones para E.164 (incluindo padrão brasileiro +55 DDD 9XXXX-XXXX)', () => {
    const mobile = normalizeAndValidatePhone('(11) 98765-4321');
    assert.equal(mobile.isValid, true);
    assert.equal(mobile.e164, '+5511987654321');
    assert.equal(mobile.formatted, '+55 (11) 98765-4321');
    assert.equal(mobile.isMobile, true);

    const landline = normalizeAndValidatePhone('1132456789');
    assert.equal(landline.isValid, true);
    assert.equal(landline.e164, '+551132456789');
    assert.equal(landline.isMobile, false);

    const repeated = normalizeAndValidatePhone('11999999999');
    assert.equal(repeated.isValid, false);
  });

  it('valida dígitos verificadores de CNPJ brasileiro e formata padrão XX.XXX.XXX/XXXX-XX', () => {
    const validNubank = validateCnpj('18236120000158');
    assert.equal(validNubank.isValid, true);
    assert.equal(validNubank.formatted, '18.236.120/0001-58');

    const validTotvs = validateCnpj('53.113.791/0001-22');
    assert.equal(validTotvs.isValid, true);

    const invalidCheck = validateCnpj('18.236.120/0001-99');
    assert.equal(invalidCheck.isValid, false);
    assert.equal(invalidCheck.reason, 'INVALID_CHECK_DIGITS');

    const repeated = validateCnpj('11.111.111/1111-11');
    assert.equal(repeated.isValid, false);
  });

  it('normaliza domínios corporativos a partir de URLs ou e-mails', () => {
    const d1 = normalizeCorporateDomain('https://www.TOTVS.com.br/erp?utm_source=ads');
    assert.equal(d1.isValid, true);
    assert.equal(d1.domain, 'totvs.com.br');
    assert.equal(d1.isCorporate, true);
  });
});

describe('2. Score de Completude Ponderado (completeness.ts)', () => {
  it('calcula score de 0 a 100 de Contatos respeitando os pesos exatos (25/20/15/15/15/10)', () => {
    const full = calculateContactCompleteness({
      email: 'executivo@totvs.com.br',
      phone: '+55 (11) 98765-4321',
      firstName: 'Ricardo',
      lastName: 'Almeida',
      jobTitle: 'CTO',
      companyId: 'comp-totvs',
      lifecycleStage: 'OPPORTUNITY',
    });
    assert.equal(full.score, 100);
    assert.equal(full.missingFields.length, 0);

    const partial = calculateContactCompleteness({
      email: 'lead@totvs.com.br', // 25
      firstName: 'Lucas',
      lastName: 'Martins', // 15
      lifecycleStage: 'LEAD', // 10
      phone: null,
      jobTitle: null,
      companyId: null,
    });
    assert.equal(partial.score, 50);
    assert.deepEqual(partial.missingFields.sort(), ['companyId', 'jobTitle', 'phone']);
  });

  it('calcula score de 0 a 100 de Empresas respeitando os pesos exatos (30/20/20/15/15)', () => {
    const fullCompany = calculateCompanyCompleteness({
      domain: 'nubank.com.br', // 30
      name: 'Nu Pagamentos S.A.', // 20
      cnpj: '18.236.120/0001-58', // 20
      industry: 'Fintech', // 15
      size: '1000+ funcionários', // 15
    });
    assert.equal(fullCompany.score, 100);

    const partialCompany = calculateCompanyCompleteness({
      domain: 'horizondigital.com.br', // 30
      name: 'Horizon Digital', // 20
      cnpj: null,
      industry: null,
      size: null,
    });
    assert.equal(partialCompany.score, 50);
  });
});

describe('3. Detecção de Duplicados Exata & Fuzzy + Merge Inteligente', () => {
  it('detecta duplicados de contatos (fuzzy nome + mesma empresa/telefone) e empresas (CNPJ/domínio)', () => {
    const repo = createInMemoryRepository();
    const contacts = repo.listContacts();
    const companies = repo.listCompanies();
    const deals = repo.listDeals();
    const timeline = repo.listTimelineEvents();

    const jw = jaroWinklerSimilarity('Marina Costa', 'Marina S. Costa');
    const lev = levenshteinSimilarity('Marina Costa', 'Marina S. Costa');
    assert.ok(jw > 0.85);
    assert.ok(lev > 0.75);

    const dupContacts = detectDuplicateContacts(contacts, deals, timeline);
    assert.ok(dupContacts.length >= 1);
    const marinaPair = dupContacts.find(
      (p) => p.primary.id === 'cont-marina' || p.duplicate.id === 'cont-marina-dup'
    );
    assert.ok(marinaPair, 'Deve encontrar o par duplicado de Marina Costa');
    assert.ok(marinaPair!.confidenceScore >= 85);

    const dupCompanies = detectDuplicateCompanies(companies, contacts, deals, timeline);
    assert.ok(dupCompanies.length >= 1);
    const totvsPair = dupCompanies.find(
      (p) => p.primary.id === 'comp-totvs' && p.duplicate.id === 'comp-totvs-dup'
    );
    assert.ok(totvsPair, 'Deve encontrar o par duplicado da TOTVS');
    assert.equal(totvsPair!.confidenceScore, 100);
  });

  it('executa merge inteligente via API preservando campos mais completos, TimelineEvents e Deals', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // Antes do merge, cont-marina-dup tem 1 evento (evt-2) e customProperties.webinarAttended
    const eventsBefore = repo.listTimelineEvents({ contactId: 'cont-marina' }).length;

    const mergeRes = await router.dispatch({
      method: 'POST',
      path: '/api/data-health/merge',
      body: {
        entityType: 'CONTACT',
        primaryId: 'cont-marina',
        duplicateId: 'cont-marina-dup',
      },
    });

    assert.equal(mergeRes.status, 200);
    const body = mergeRes.body as {
      data: {
        success: boolean;
        timelineEventsMoved: number;
        mergedRecord: { customProperties: Record<string, unknown>; jobTitle: string };
      };
    };
    assert.equal(body.data.success, true);
    assert.equal(body.data.timelineEventsMoved, 1);
    assert.equal(body.data.mergedRecord.jobTitle, 'VP de Operações');
    assert.equal(
      body.data.mergedRecord.customProperties.webinarAttended,
      'AI Revenue Summit 2026'
    );

    // Registro duplicado deve ter sido removido e eventos unificados no primário
    assert.equal(repo.getContactById('cont-marina-dup'), undefined);
    const eventsAfter = repo.listTimelineEvents({ contactId: 'cont-marina' }).length;
    assert.ok(eventsAfter >= eventsBefore + 2); // +1 evento movido +1 evento de auditoria de merge
  });
});

describe('4. Enriquecimento Inteligente por Domínio Corporativo', () => {
  it('enriquece contato corporativo incompleto (@loggi.com), cria/vincula empresa e preserva campos manuais', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const before = repo.getContactById('cont-lucas')!;
    assert.equal(before.companyId, null);
    assert.ok(before.completenessScore < 60);

    const res = await router.dispatch({
      method: 'POST',
      path: '/api/enrichment/run',
      body: { contactId: 'cont-lucas' },
    });

    assert.equal(res.status, 200);
    const payload = res.body as {
      data: {
        isCorporateDomain: boolean;
        domain: string;
        contact: { companyId: string; completenessScore: number; enrichedAt: string };
        company: { name: string; industry: string };
      };
    };

    assert.equal(payload.data.isCorporateDomain, true);
    assert.equal(payload.data.domain, 'loggi.com');
    assert.ok(payload.data.contact.companyId);
    assert.ok(payload.data.contact.completenessScore > before.completenessScore);
    assert.equal(payload.data.company.name, 'Loggi Tecnologia Ltda.');
  });
});

describe('5. Motor de Workflows & Sequências de E-mail (com Pausa Automática na Resposta)', () => {
  it('dispara workflow automaticamente ao criar novo contato corporativo e registra WorkflowExecution', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const createRes = await router.dispatch({
      method: 'POST',
      path: '/api/contacts',
      body: {
        email: 'fernanda.lima@mercadolivre.com.br',
        firstName: 'Fernanda',
        lastName: 'Lima',
        phone: '(11) 98888-7766',
        jobTitle: 'Diretora de Operações',
      },
    });

    assert.equal(createRes.status, 201);
    const data = createRes.body as {
      data: { id: string; companyId: string; leadStatus: string; leadScore: number };
      workflowExecutions: Array<{ status: string }>;
    };

    // O workflow wf-auto-enrich-new-contact deve ter enriquecido e mudado leadStatus para OPEN
    assert.ok(data.workflowExecutions.length >= 1);
    assert.equal(data.workflowExecutions[0].status, 'COMPLETED');
    assert.ok(data.data.companyId, 'Deve ter vinculado automaticamente a empresa Mercado Livre');
    assert.equal(data.data.leadStatus, 'OPEN');
  });

  it('inscreve contato em cadência multi-etapas, avança passo e PAUSA AUTOMATICAMENTE quando o lead responde', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Inscrever Marina na cadência outbound
    const enrollRes = await router.dispatch({
      method: 'POST',
      path: '/api/sequences',
      body: {
        action: 'ENROLL',
        sequenceId: 'seq-outbound-enterprise',
        contactId: 'cont-marina',
      },
    });
    assert.equal(enrollRes.status, 201);
    const enrolled = (enrollRes.body as { data: { enrollment: { id: string; status: string; currentStepOrder: number } } }).data.enrollment;
    assert.equal(enrolled.status, 'ACTIVE');
    assert.equal(enrolled.currentStepOrder, 1);

    // 2. Avançar para o Passo 2
    const advRes = await router.dispatch({
      method: 'POST',
      path: '/api/sequences',
      body: {
        action: 'ADVANCE_STEP',
        enrollmentId: enrolled.id,
      },
    });
    assert.equal(advRes.status, 200);
    const advanced = (advRes.body as { data: { enrollment: { currentStepOrder: number; sentCount: number } } }).data.enrollment;
    assert.equal(advanced.currentStepOrder, 2);
    assert.equal(advanced.sentCount, 2);

    // 3. Simular Resposta do Lead -> Deve pausar automaticamente (PAUSED_ON_REPLY)
    const replyRes = await router.dispatch({
      method: 'POST',
      path: '/api/sequences',
      body: {
        action: 'REPLY',
        enrollmentId: enrolled.id,
        replySnippet: 'Vamos agendar a reunião na terça-feira às 14h!',
      },
    });
    assert.equal(replyRes.status, 200);
    const replyData = (
      replyRes.body as {
        data: {
          autoPaused: boolean;
          enrollment: { status: string; nextStepDueAt: string | null; repliedAt: string };
        };
      }
    ).data;
    assert.equal(replyData.autoPaused, true);
    assert.equal(replyData.enrollment.status, 'PAUSED_ON_REPLY');
    assert.equal(replyData.enrollment.nextStepDueAt, null);
    assert.ok(replyData.enrollment.repliedAt);
  });
});

describe('6. IA Analista de Funil e Base (/api/ai-insights) & Saúde Global (/api/data-health/summary)', () => {
  it('retorna diagnóstico de gargalos por etapa, deals em risco, forecast ponderado, follow-ups e oportunidades ocultas', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const aiRes = await router.dispatch({
      method: 'POST',
      path: '/api/ai-insights',
      body: { question: 'Qual é o maior gargalo do funil e a previsão de receita?' },
    });

    assert.equal(aiRes.status, 200);
    const report = (aiRes.body as {
      data: {
        funnelBottlenecks: unknown[];
        atRiskDeals: Array<{ dealId: string; riskLevel: string }>;
        revenueForecast: { totalOpenPipelineValue: number; weightedPipelineValue: number };
        priorityFollowUps: unknown[];
        hiddenOpportunities: Array<{ entityId: string }>;
        analystAnswer: string;
      };
    }).data;

    assert.ok(report.funnelBottlenecks.length >= 5);
    assert.ok(report.atRiskDeals.length >= 2);
    assert.ok(
      report.atRiskDeals.some((d) => d.dealId === 'deal-creditas-crm' && d.riskLevel === 'CRITICAL')
    );
    assert.ok(report.revenueForecast.totalOpenPipelineValue > 0);
    assert.ok(report.revenueForecast.weightedPipelineValue > 0);
    assert.ok(report.priorityFollowUps.length >= 2);
    assert.ok(report.hiddenOpportunities.some((o) => o.entityId === 'cont-thiago'));
    assert.ok(report.analystAnswer && report.analystAnswer.length > 20);
  });

  it('executa auto-clean em lote na base elevando o Global Health Score', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const summaryBeforeRes = await router.dispatch({
      method: 'GET',
      path: '/api/data-health/summary',
    });
    assert.equal(summaryBeforeRes.status, 200);

    const cleanRes = await router.dispatch({
      method: 'POST',
      path: '/api/data-health/auto-clean',
      body: { minConfidence: 80, autoEnrich: true },
    });
    assert.equal(cleanRes.status, 200);

    const cleanData = (
      cleanRes.body as {
        data: {
          previousHealthScore: number;
          newHealthScore: number;
          contactsMerged: number;
          companiesMerged: number;
        };
      }
    ).data;

    assert.ok(cleanData.contactsMerged >= 1);
    assert.ok(cleanData.companiesMerged >= 1);
    assert.ok(cleanData.newHealthScore >= cleanData.previousHealthScore);
  });
});

describe('7. Cobertura Completa de Endpoints REST (/api/companies, /api/deals, /api/pipelines, /api/timeline, /api/workflows)', () => {
  it('lista e cria empresas, negócios, pipelines e eventos de timeline mantendo integridade relacional', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Pipelines Kanban
    const pipeRes = await router.dispatch({ method: 'GET', path: '/api/pipelines' });
    assert.equal(pipeRes.status, 200);
    const pipes = (pipeRes.body as { data: Array<{ stages: unknown[] }> }).data;
    assert.equal(pipes.length, 3);
    assert.equal(pipes[0].stages.length, 7);

    // 2. Criar Empresa
    const compRes = await router.dispatch({
      method: 'POST',
      path: '/api/companies',
      body: {
        name: 'Stone Pagamentos S.A.',
        domain: 'https://www.stone.com.br',
        industry: 'Fintech',
        size: '1000+ funcionários',
        annualRevenue: 12000000000,
      },
    });
    assert.equal(compRes.status, 201);
    const createdComp = (compRes.body as { data: { id: string; domain: string; completenessScore: number } }).data;
    assert.equal(createdComp.domain, 'stone.com.br');
    assert.equal(createdComp.completenessScore, 80); // 30 domain + 20 name + 15 industry + 15 size (sem CNPJ)

    // 3. Criar Deal e mover de estágio para acionar workflow DEAL_STAGE_CHANGED
    const dealRes = await router.dispatch({
      method: 'POST',
      path: '/api/deals',
      body: {
        title: 'Stone - Expansão Plataforma CRM',
        value: 250000,
        stageId: 'stage-demo',
        companyId: createdComp.id,
        contactId: 'cont-marina',
      },
    });
    assert.equal(dealRes.status, 201);
    const createdDeal = (dealRes.body as { data: { id: string; probability: number } }).data;
    assert.equal(createdDeal.probability, 50);

    // Mover para stage-proposal (70% prob) -> deve disparar workflow wf-deal-proposal-followup
    const moveRes = await router.dispatch({
      method: 'PATCH',
      path: `/api/deals/${createdDeal.id}`,
      body: { stageId: 'stage-proposal' },
    });
    assert.equal(moveRes.status, 200);
    const movedPayload = moveRes.body as {
      data: { probability: number; stageId: string };
      workflowExecutions: Array<{ workflowId: string; status: string }>;
    };
    assert.equal(movedPayload.data.stageId, 'stage-proposal');
    assert.equal(movedPayload.data.probability, 70);
    assert.ok(
      movedPayload.workflowExecutions.some(
        (w) => w.workflowId === 'wf-deal-proposal-followup' && w.status === 'COMPLETED'
      )
    );
  });
});

describe('8. Fase 3 — Marketing Hub (Web Forms), Service Desk (JSM Tickets) & Migração Nativa HubSpot', () => {
  it('submete formulário de Portal de Suporte criando Contato, enriquecendo Empresa e abrindo Ticket JSM com SLA automaticamente', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const formsRes = await router.dispatch({ method: 'GET', path: '/api/forms' });
    assert.equal(formsRes.status, 200);
    const formsBody = formsRes.body as { data: Array<{ id: string }>; summary: { totalForms: number } };
    assert.ok(formsBody.data.length >= 3);

    const submitRes = await router.dispatch({
      method: 'POST',
      path: '/api/forms/submit',
      body: {
        formId: 'form-support-portal',
        values: {
          firstName: 'Carlos',
          lastName: 'Eduardo',
          email: 'carlos.eduardo@nubank.com.br',
          subject: 'Falha de autenticação OAuth2 no Sandbox Enterprise',
          priority: 'CRITICAL',
          description: 'Token expirando antes do TTL configurado de 3600s.',
        },
      },
    });

    assert.equal(submitRes.status, 201);
    const subData = (
      submitRes.body as {
        data: {
          contact: { id: string; companyId: string };
          ticket: { id: string; key: string; priority: string; status: string };
        };
      }
    ).data;

    assert.equal(subData.contact.companyId, 'comp-nubank');
    assert.ok(subData.ticket, 'Deve criar ticket automaticamente a partir do formulário de suporte');
    assert.ok(subData.ticket.key.startsWith('JSM-'));
    assert.equal(subData.ticket.priority, 'CRITICAL');
    assert.equal(subData.ticket.status, 'OPEN');
  });

  it('gerencia ciclo completo de chamado no Service Desk (JSM): resposta pública do agente, nota interna e resolução com SLA', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Listar tickets e KPIs de SLA
    const listRes = await router.dispatch({ method: 'GET', path: '/api/tickets' });
    assert.equal(listRes.status, 200);
    const listBody = listRes.body as {
      data: Array<{ id: string; key: string }>;
      kpis: { totalTickets: number; slaComplianceRate: number };
    };
    assert.ok(listBody.data.length >= 5);
    assert.ok(listBody.kpis.slaComplianceRate > 0);

    // 2. Responder ao cliente no ticket JSM-102 (que ainda não tinha firstRespondedAt)
    const commentRes = await router.dispatch({
      method: 'POST',
      path: '/api/tickets/JSM-102/comments',
      body: {
        author: 'Marcéllo Mira',
        authorRole: 'AGENT',
        isInternal: false,
        body: 'Certificado SAML Okta validado com sucesso no ambiente de produção.',
        newStatus: 'RESOLVED',
      },
    });
    assert.equal(commentRes.status, 201);
    const updatedTicket = (
      commentRes.body as {
        data: {
          status: string;
          firstRespondedAt: string | null;
          resolvedAt: string | null;
          comments: unknown[];
        };
      }
    ).data;

    assert.equal(updatedTicket.status, 'RESOLVED');
    assert.ok(updatedTicket.firstRespondedAt, 'Deve registrar timestamp da primeira resposta ao cliente');
    assert.ok(updatedTicket.resolvedAt, 'Deve registrar timestamp de resolução');
    assert.equal(updatedTicket.comments.length, 2);
  });

  it('importa lote completo do HubSpot CRM v3 (/api/migration/hubspot) criando empresas, contatos, deals e tickets com higienização automática', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const migRes = await router.dispatch({
      method: 'POST',
      path: '/api/migration/hubspot',
      body: {
        accessToken: 'pat-na1-demo-token',
        autoClean: true,
      },
    });

    assert.equal(migRes.status, 200);
    const migData = (
      migRes.body as {
        data: {
          success: boolean;
          companiesImported: number;
          contactsImported: number;
          dealsImported: number;
          ticketsImported: number;
        };
      }
    ).data;

    assert.equal(migData.success, true);
    assert.ok(migData.companiesImported >= 2);
    assert.ok(migData.contactsImported >= 2);
    assert.ok(migData.dealsImported >= 2);
    assert.ok(migData.ticketsImported >= 1);
  });
});

describe('9. Fase 4 — ERP Brasil, Propostas Comerciais, Contratos de Locação & Fiscal (GestãoClick)', () => {
  it('retorna visão geral do ERP Seta Telecom, aprova proposta gerando contrato de locação e emite fatura isenta de ISS (SV 31 STF)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Overview ERP
    const ovRes = await router.dispatch({ method: 'GET', path: '/api/erp/overview' });
    assert.equal(ovRes.status, 200);
    const ov = (ovRes.body as {
      data: {
        kpis: { monthlyRentalMrr: number; activeContractsCount: number; issSavedBySv31Stf: number };
        proposals: Array<{ id: string }>;
        rentalContracts: Array<{ id: string }>;
        invoices: Array<{ id: string; documentType: string; taxBreakdown: { issAmount: number } }>;
      };
    }).data;

    assert.ok(ov.kpis.monthlyRentalMrr > 0);
    assert.equal(ov.kpis.activeContractsCount, 3);
    assert.ok(ov.kpis.issSavedBySv31Stf > 0);

    const locInvoice = ov.invoices.find((i) => i.documentType === 'FATURA_LOCACAO');
    assert.ok(locInvoice);
    assert.equal(locInvoice!.taxBreakdown.issAmount, 0, 'Locação pura de bens móveis não incide ISS (SV 31 STF)');

    // 2. Aprovar Proposta PROP-2026-002 -> Gera Contrato de Locação + Fatura de Locação automaticamente
    const appRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals/prop-seta-002/approve',
    });
    assert.equal(appRes.status, 200);
    const appData = (appRes.body as {
      data: {
        proposal: { status: string };
        contract: { id: string; contractNumber: string };
        invoice: { id: string; documentType: string; taxBreakdown: { issAmount: number } };
      };
    }).data;

    assert.equal(appData.proposal.status, 'CONVERTIDA_CONTRATO');
    assert.ok(appData.contract.contractNumber.startsWith('LOC-'));
    assert.equal(appData.invoice.documentType, 'FATURA_LOCACAO');
    assert.equal(appData.invoice.taxBreakdown.issAmount, 0);

    // 3. Emitir NF-e de Remessa de Locação (CFOP 5.908)
    const remRes = await router.dispatch({
      method: 'POST',
      path: `/api/erp/rental-contracts/${appData.contract.id}/generate-remessa`,
    });
    assert.equal(remRes.status, 201);

    // 4. Reatribuir carteira órfã de ex-vendedores inativos no Data Health
    const reRes = await router.dispatch({
      method: 'POST',
      path: '/api/data-health/reassign-orphans',
      body: { targetOwnerName: 'Marcelo Lopes Mira' },
    });
    assert.equal(reRes.status, 200);
    const reData = (reRes.body as { data: { contactsReassigned: number } }).data;
    assert.ok(reData.contactsReassigned >= 2);
  });

  it('permite editar, atualizar itens e excluir Propostas Comerciais, Contratos de Locação e Documentos Fiscais via CRUD REST', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Editar Proposta Comercial existente (PATCH /api/erp/proposals/:id)
    const editPropRes = await router.dispatch({
      method: 'PATCH',
      path: '/api/erp/proposals/prop-seta-002',
      body: {
        title: 'TOTVS S.A. — Proposta Revisada com 40 Terminais IP & SD-WAN',
        contractMonths: 36,
        discountAmount: 500,
        items: [
          {
            id: 'pi-rev-1',
            sku: 'GC-EQ-00101',
            description: 'Central PABX IP Seta Cloud HA Revisada',
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
            ncmOrServiceCode: 'NCM 8517.62.14',
            quantity: 2,
            unitPrice: 3000,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 6000,
          },
        ],
      },
    });
    assert.equal(editPropRes.status, 200);
    const updatedProp = (editPropRes.body as {
      data: { title: string; monthlyRecurringTotal: number; totalContractValue: number };
    }).data;
    assert.equal(updatedProp.title, 'TOTVS S.A. — Proposta Revisada com 40 Terminais IP & SD-WAN');
    assert.equal(updatedProp.monthlyRecurringTotal, 5500);
    assert.equal(updatedProp.totalContractValue, 5500 * 36);

    // 2. Editar Contrato de Locação (PATCH /api/erp/contracts/:id)
    const editCtrRes = await router.dispatch({
      method: 'PATCH',
      path: '/api/erp/contracts/ctr-loc-101',
      body: {
        title: 'Contrato de Locação Nubank — Aditivo Expansão 2026',
        monthlyValue: 14500,
      },
    });
    assert.equal(editCtrRes.status, 200);
    const updatedCtr = (editCtrRes.body as { data: { title: string; monthlyValue: number } }).data;
    assert.equal(updatedCtr.monthlyValue, 14500);

    // 3. Editar Documento Fiscal / Fatura (PATCH /api/erp/fiscal-documents/:id)
    const editInvRes = await router.dispatch({
      method: 'PATCH',
      path: '/api/erp/fiscal-documents/inv-loc-0002',
      body: {
        grossAmount: 7800,
        status: 'PAGA',
      },
    });
    assert.equal(editInvRes.status, 200);
    const updatedInv = (editInvRes.body as { data: { grossAmount: number; status: string } }).data;
    assert.equal(updatedInv.grossAmount, 7800);
    assert.equal(updatedInv.status, 'PAGA');
  });
});

describe('10. Persistência Multi-Camada, Criação de 2 Contatos Seguidos, Busca sem Acento & Auto-Reconciliação Serverless (/api/bootstrap)', () => {
  it('salva 2 novos contatos seguidos (com e sem e-mail, com acentuação e empresa nova), mantém ambos no topo e encontra na busca com/sem acento e por telefone', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1º Contato: Com acento, telefone e nova empresa digitada na hora
    const res1 = await router.dispatch({
      method: 'POST',
      path: '/api/contacts',
      body: {
        firstName: 'João',
        lastName: 'Gonçalves',
        email: 'joao.goncalves@construtoragoncalves.com.br',
        phone: '(11) 98765-4321',
        jobTitle: 'Diretor de Engenharia',
        companyName: 'Construtora Gonçalves S.A.',
      },
    });
    assert.equal(res1.status, 201);
    const contact1 = (res1.body as { data: { id: string; firstName: string; companyId: string; company: { name: string } } }).data;
    assert.equal(contact1.firstName, 'João');
    assert.ok(contact1.companyId, 'Deve criar e vincular a empresa automaticamente');
    assert.equal(contact1.company.name, 'Construtora Gonçalves S.A.');

    // 2º Contato: Sem e-mail preenchido (apenas nome e WhatsApp)
    const res2 = await router.dispatch({
      method: 'POST',
      path: '/api/contacts',
      body: {
        firstName: 'Cláudia',
        lastName: 'Mendonça',
        phone: '(21) 99876-5432',
        jobTitle: 'Gerente de Compras Telecom',
      },
    });
    assert.equal(res2.status, 201);
    const contact2 = (res2.body as { data: { id: string; firstName: string; email: string } }).data;
    assert.equal(contact2.firstName, 'Cláudia');
    assert.ok(contact2.email.includes('@contato.setatelecom.com.br'));

    // Verificar que ambos estão no TOPO de GET /api/contacts
    const listRes = await router.dispatch({ method: 'GET', path: '/api/contacts' });
    assert.equal(listRes.status, 200);
    const allContacts = (listRes.body as { data: Array<{ id: string }> }).data;
    assert.equal(allContacts[0].id, contact2.id, '2º contato recém-criado deve estar na posição 0');
    assert.equal(allContacts[1].id, contact1.id, '1º contato recém-criado deve estar na posição 1');

    // Busca sem acento (?search=joao goncalves)
    const searchJoao = await router.dispatch({
      method: 'GET',
      path: '/api/contacts?search=joao goncalves',
    });
    const foundJoao = (searchJoao.body as { data: Array<{ id: string }> }).data;
    assert.equal(foundJoao.length, 1);
    assert.equal(foundJoao[0].id, contact1.id);

    // Busca sem acento via ?q=claudia mendonca
    const searchClaudia = await router.dispatch({
      method: 'GET',
      path: '/api/contacts?q=claudia mendonca',
    });
    const foundClaudia = (searchClaudia.body as { data: Array<{ id: string }> }).data;
    assert.equal(foundClaudia.length, 1);
    assert.equal(foundClaudia[0].id, contact2.id);

    // Busca por dígitos do telefone (?search=998765432)
    const searchPhone = await router.dispatch({
      method: 'GET',
      path: '/api/contacts?search=998765432',
    });
    const foundPhone = (searchPhone.body as { data: Array<{ id: string }> }).data;
    assert.equal(foundPhone.length, 1);
    assert.equal(foundPhone[0].id, contact2.id);

    // Simular Cold Start Serverless: nova instância limpa reconciliada via POST /api/bootstrap
    const coldStartRepo = createInMemoryRepository();
    const coldStartRouter = new CrmApiRouter(coldStartRepo);

    const bootstrapRes = await coldStartRouter.dispatch({
      method: 'POST',
      path: '/api/bootstrap',
      body: {
        reconcileJournal: {
          upsertedContacts: [contact2, contact1],
          upsertedCompanies: [contact1.company],
        },
      },
    });
    assert.equal(bootstrapRes.status, 200);
    const bootBody = bootstrapRes.body as {
      data: { contacts: Array<{ id: string }> };
      reconciliation: { reconciled: boolean; appliedCount: number };
    };
    assert.equal(bootBody.reconciliation.reconciled, true);
    assert.ok(bootBody.reconciliation.appliedCount >= 3);
    assert.ok(bootBody.data.contacts.some((c) => c.id === contact1.id));
    assert.ok(bootBody.data.contacts.some((c) => c.id === contact2.id));
  });
});
