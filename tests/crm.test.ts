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
    assert.equal(pipes.length, 1);
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
