import {
  CRM_MODULE_ITEMS_CATALOG,
  CRM_ROLES_CATALOG,
  ERP_MODULE_ITEMS_CATALOG,
  ERP_ROLES_CATALOG,
  MODULE_ITEMS_CRUD_CATALOG,
  RBAC_ROLES_CATALOG,
  buildDefaultCrmItemPermissions,
  buildDefaultErpItemPermissions,
} from '../src/app/lib/rbac';
import { generateTotpCodeSync } from '../src/app/lib/auth';
import { isPublicStiHubPath, evaluateStiHubRouteProtection, classifyRouteRequiredModule } from '../src/middleware';
import { resolveStiHubSigningSecret, signMfaChallengeToken, signStiHubSessionToken, STIHUB_TOTP_ROTATION_EPOCH, verifyStiHubSessionToken } from '../src/app/lib/auth';
import { filterGlobalSearchEntries, SEARCH_CATEGORY_PILLS, SearchCategoryKey, SearchResultEntry } from '../src/app/components/GlobalHeaderSearch';
import fs from 'node:fs';
import path from 'node:path';
// ============================================================================
// HubSpot Pro CRM - Comprehensive Automated Test Suite (Node Test Runner)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateEmail,
  normalizeAndValidatePhone,
  validateCnpj,
  validateCpf,
  formatDocumentByPersonType,
  validateDocumentByPersonType,
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

  it('bloqueia detecção de duplicidade e rejeita merge (400) entre empresas com CNPJs diferentes mesmo com mesmo domínio (Matriz e Filial)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // Cria uma Filial da TOTVS com o mesmo domínio totvs.com.br mas CNPJ filial /0002-03
    const filialRes = await router.dispatch({
      method: 'POST',
      path: '/api/companies',
      body: {
        name: 'TOTVS S.A. - Filial Rio de Janeiro',
        domain: 'totvs.com.br',
        cnpj: '53.113.791/0002-03',
        city: 'Rio de Janeiro',
        state: 'RJ',
      },
    });
    assert.equal(filialRes.status, 201);
    const filial = (filialRes.body as { data: { id: string; cnpj: string } }).data;

    // 1. Verifica que detectDuplicateCompanies NÃO lista Matriz (53.113.791/0001-22) + Filial (53.113.791/0002-03) como duplicadas
    const dups = detectDuplicateCompanies(repo.listCompanies());
    const conflictingPair = dups.find(
      (p) =>
        (p.primary.id === 'comp-totvs' && p.duplicate.id === filial.id) ||
        (p.primary.id === filial.id && p.duplicate.id === 'comp-totvs')
    );
    assert.equal(
      conflictingPair,
      undefined,
      'Empresas com CNPJs diferentes jamais devem ser listadas como duplicadas'
    );

    // 2. Verifica que tentativa forçada de merge via API retorna 400 Bad Request (Bloqueio Fiscal)
    const mergeAttempt = await router.dispatch({
      method: 'POST',
      path: '/api/data-health/merge',
      body: {
        entityType: 'COMPANY',
        primaryId: 'comp-totvs',
        duplicateId: filial.id,
      },
    });
    assert.equal(mergeAttempt.status, 400);
    const errBody = mergeAttempt.body as { error: string };
    assert.ok(errBody.error.includes('Bloqueio Fiscal'));
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
    assert.ok(pipes.length >= 3);
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
    assert.ok(ov.kpis.activeContractsCount >= 3);
    assert.ok(ov.kpis.issSavedBySv31Stf > 0);

    const locInvoice = ov.invoices.find((i) => i.documentType === 'FATURA_LOCACAO');
    assert.ok(locInvoice);
    assert.equal(locInvoice!.taxBreakdown.issAmount, 0, 'Locação pura de bens móveis não incide ISS (SV 31 STF)');

    // 2. Aprovar Proposta PROP-2026-002 -> Gera Contrato de Locação + Fatura de Locação automaticamente
    const appRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals/prop-seta-002/approve',
      body: {
        signerName: 'Carlos Eduardo Almeida',
        signerCpf: '529.982.247-25',
        signerRole: 'Diretor / Representante Legal',
        modality: 'ICP_BRASIL_A1',
        acceptedTerms: true,
      },
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

    // 4. Enviar E-mail via STI-hub Mailer (POST /api/communications/send-email)
    const mailRes = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      body: {
        docType: 'PROPOSAL',
        to: 'marialuiza@mundivox.com.br',
        cc: 'comercial@setatelecom.com.br',
        subject: '[Seta Telecom] Proposta Comercial #4695 — MUNDIVOX COMUNICACOES LTDA',
        body: 'Segue proposta comercial #4695 com link PDF A4.',
        companyName: 'MUNDIVOX COMUNICACOES LTDA',
        documentCode: '4695',
        amountBrl: 4320,
      },
    });
    assert.equal(mailRes.status, 200);
    const mailData = (mailRes.body as { data: { success: boolean; protocol: string } }).data;
    assert.equal(mailData.success, true);
    assert.ok(mailData.protocol.startsWith('STI-MAIL-'));

    // 4. Emitir NF-e de Venda de Produto (CFOP 5.102), NFC-e Consumidor (Mod. 65) e NFS-e com retenções (IRRF 1,5% + CSRF 4,65%)
    const nfeVendaRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/invoices',
      body: {
        documentType: 'NFE_VENDA_PRODUTO',
        companyName: 'FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA',
        companyCnpj: '07.308.605/0001-80',
        grossAmount: 10000,
      },
    });
    assert.equal(nfeVendaRes.status, 201);
    const nfeVenda = (nfeVendaRes.body as {
      data: {
        documentType: string;
        cfop: string;
        netAmount: number;
        taxBreakdown: { icmsRatePercent: number; icmsAmount: number; totalWithheld: number };
      };
    }).data;
    assert.equal(nfeVenda.documentType, 'NFE_VENDA_PRODUTO');
    assert.ok(nfeVenda.cfop.includes('5.102'));
    assert.equal(nfeVenda.taxBreakdown.icmsRatePercent, 18);
    assert.equal(nfeVenda.taxBreakdown.icmsAmount, 1800);
    assert.equal(nfeVenda.taxBreakdown.totalWithheld, 0);
    assert.equal(nfeVenda.netAmount, 10000);

    const nfseRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/invoices',
      body: {
        documentType: 'NFSE_SERVICO',
        companyName: 'TOTVS S.A.',
        companyCnpj: '53.113.791/0001-22',
        grossAmount: 10000,
      },
    });
    assert.equal(nfseRes.status, 201);
    const nfse = (nfseRes.body as {
      data: {
        netAmount: number;
        taxBreakdown: { irrfWithheldAmount: number; csrfWithheldAmount: number; totalWithheld: number };
      };
    }).data;
    assert.equal(nfse.taxBreakdown.irrfWithheldAmount, 150);
    assert.equal(nfse.taxBreakdown.csrfWithheldAmount, 465);
    assert.equal(nfse.taxBreakdown.totalWithheld, 615);
    assert.equal(nfse.netAmount, 9385);

    // 5. Criar Nota de Compra / Entrada de Ativo Imobilizado (CFOP 1.551) em /api/erp/records/purchaseOrders
    const poRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/records/purchaseOrders',
      body: {
        id: 'po-test-1551',
        code: '39',
        nfeNumber: '000.019.551',
        supplierName: 'AGIS EQUIPAMENTOS E SERVICOS DE INFORMATICA LTDA.',
        cfopEntrada: '1.551 — Compra de bem para o Ativo Imobilizado (Parque de Locação)',
        totalAmount: 15000,
        status: 'Confirmada',
      },
    });
    assert.equal(poRes.status, 200);

    // 6. Emissor NF-e de Importação 4.01 Sebrae (Simples Nacional CRT=1 / CSOSN 900) + Firewall Fiscal TXT (NE000007)
    const analyzeRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-importacao/analyze-txt',
      body: {
        filename: 'NE000007.txt',
        txt: [
          'NOTA FISCAL|1|',
          'B|35|01020100|IMPORTACAO|55|1|7|2026-09-01T15:30:00-03:00',
          'C|RAZAO|FANTASIA|IE||||1',
          'I|SKU|SEM GTIN||PRODUTO|73079900||3102|UN.|1.0000|10.00',
          'N10h|1|900|3|21924.76|0.00|18.00|3946.46||||||',
        ].join('\n'),
      },
    });
    assert.equal(analyzeRes.status, 200);
    const analysis = (analyzeRes.body as {
      data: {
        noteNumber: string;
        crt: string;
        itemsCount: number;
        correctedTxt: string;
        findings: Array<{ autoFix: boolean }>;
      };
    }).data;
    assert.equal(analysis.noteNumber, '7');
    assert.equal(analysis.crt, '1');
    assert.equal(analysis.itemsCount, 1);
    assert.ok(analysis.correctedTxt.includes('|3102|UN|'), 'Deve normalizar UN. -> UN e alinhar CFOP 3102');
    assert.ok(analysis.correctedTxt.includes('N10h|1|900|3|21924.76|0.00|18.00|3946.46||||||'), 'Deve preservar CSOSN 900 e valores fiscais');

    const emitImpRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-importacao/emit',
      body: {
        serie: '1',
        nNF: '15',
        natOp: 'IMPORTACAO DE MERCADORIA PARA COMERCIALIZACAO',
        crt: '1',
        di: {
          nDI: '26/1998012-3',
          dDI: '2026-10-20',
          xLocDesemb: 'VIRACOPOS - CAMPINAS',
          UFDesemb: 'SP',
          dDesemb: '2026-10-22',
          tpViaTransp: '4',
          vAFRMM: 0,
          tpIntermedio: '1',
          cExportador: 'FORTINET-US',
          currency: 'USD',
          exchangeRatePtax: 5.5,
          fobTotalForeign: 2000,
          freteInternacionalBrl: 1000,
          seguroInternacionalBrl: 200,
          taxaSiscomexTotalBrl: 214.5,
          outrasDespesasAduaneirasBrl: 385.5,
          somarTributosEmVOutroSimples: true,
          exporterIdEstrangeiro: 'US-CA-94086-FGT',
          exporterName: 'FORTINET, INC.',
          exporterAddress: '899 Kifer Road, Sunnyvale, CA',
          exporterCountryCodeBacen: '2496',
          exporterCountryName: 'ESTADOS UNIDOS',
          additions: [{ nAdicao: '1', nSeqAdic: '1', cFabricante: 'FORTINET-US', vDescDI: 0 }],
        },
        rawItems: [
          {
            id: 'imp-fgt-1',
            cProd: 'GC-EQ-00102',
            xProd: 'APPLIANCE FIREWALL SD-WAN FORTIGATE 100F',
            ncm: '85176259',
            cfop: '3.551',
            uCom: 'UN.',
            qCom: 2,
            fobUnitForeign: 1000,
            iiRatePercent: 10,
            ipiRatePercent: 5,
            pisRatePercent: 2.1,
            cofinsRatePercent: 9.65,
            icmsRatePercent: 18,
            nAdicao: '1',
            nSeqAdic: '1',
            cFabricante: 'FORTINET-US',
          },
        ],
      },
    });
    assert.equal(emitImpRes.status, 201);
    const emittedImp = (emitImpRes.body as {
      data: { documentNumber: string; documentType: string; grossAmount: number };
      importMetadata: {
        totals: { vProd: number; vAduaneiro: number; vBC_ICMS: number; vICMS: number; vNF: number };
        sebraeTxtContent: string;
        sefazXmlContent: string;
      };
    });
    assert.equal(emittedImp.data.documentType, 'NFE_IMPORTACAO');
    assert.equal(emittedImp.importMetadata.totals.vProd, 11000);
    assert.equal(emittedImp.importMetadata.totals.vAduaneiro, 12200);
    assert.ok(emittedImp.importMetadata.totals.vBC_ICMS > emittedImp.importMetadata.totals.vAduaneiro);
    assert.ok(emittedImp.importMetadata.sebraeTxtContent.includes('N10h|1|900|3|'));
    assert.ok(emittedImp.importMetadata.sefazXmlContent.includes('<ICMSSN900>'));
    assert.ok(emittedImp.importMetadata.sefazXmlContent.includes('<nDI>26/1998012-3</nDI>'));

    // 7. Importar arquivo .TXT (Sebrae 4.01) e .XML (SEFAZ 4.00) via POST /api/erp/nfe-importacao/parse-file para preencher todas as abas e emitir
    const parseTxtRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-importacao/parse-file',
      body: {
        filename: 'NE000007.txt',
        content: emittedImp.importMetadata.sebraeTxtContent,
      },
    });
    assert.equal(parseTxtRes.status, 200);
    const parsedTxtDraft = (parseTxtRes.body as {
      data: {
        sourceFormat: string;
        nNF: string;
        crt: string;
        di: { nDI: string };
        rawItems: Array<{ cProd: string; cfop: string; uCom: string }>;
        computedMeta: { totals: { vNF: number; vBC_ICMS: number } };
      };
    }).data;
    assert.equal(parsedTxtDraft.sourceFormat, 'SEBRAE_TXT_401');
    assert.equal(parsedTxtDraft.nNF, '15');
    assert.equal(parsedTxtDraft.crt, '1');
    assert.equal(parsedTxtDraft.di.nDI, '26/1998012-3');
    assert.equal(parsedTxtDraft.rawItems.length, 1);
    assert.equal(parsedTxtDraft.rawItems[0].cfop, '3.551');
    assert.equal(parsedTxtDraft.rawItems[0].uCom, 'UN');

    const parseXmlRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-importacao/parse-file',
      body: {
        filename: 'NFE_IMP_15_SEFAZ_400.xml',
        content: emittedImp.importMetadata.sefazXmlContent,
      },
    });
    assert.equal(parseXmlRes.status, 200);
    const parsedXmlDraft = (parseXmlRes.body as {
      data: {
        sourceFormat: string;
        nNF: string;
        crt: string;
        di: { nDI: string; exporterName: string };
        rawItems: Array<{ cProd: string; cfop: string }>;
      };
    }).data;
    assert.equal(parsedXmlDraft.sourceFormat, 'SEFAZ_XML_400');
    assert.equal(parsedXmlDraft.nNF, '15');
    assert.equal(parsedXmlDraft.crt, '1');
    assert.equal(parsedXmlDraft.di.nDI, '26/1998012-3');
    assert.equal(parsedXmlDraft.di.exporterName, 'FORTINET, INC.');
    assert.equal(parsedXmlDraft.rawItems[0].cfop, '3.551');

    // Bloqueio de segurança contra XXE (<!DOCTYPE / <!ENTITY)
    const xxeRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-importacao/parse-file',
      body: {
        filename: 'malicious.xml',
        content: '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><nfeProc>&xxe;</nfeProc>',
      },
    });
    assert.equal(xxeRes.status, 400);
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

describe('11. Pacotes NOC Telecom Seta: Filas N1/N2/N3, Conversão em O.S. ERP, Motor Dinâmico de SLA & Portal do Cliente (/api/portal/tickets)', () => {
  it('calcula SLA dinâmico em tempo real, recalcula prazos ao alterar prioridade e gera O.S. Técnica no GestãoClick a partir do ticket', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Verificar KPIs reais (avgFirstResponseMinutes, avgResolutionMinutes) e filas NOC Seta
    const listRes = await router.dispatch({ method: 'GET', path: '/api/tickets' });
    assert.equal(listRes.status, 200);
    const listBody = listRes.body as {
      data: Array<{ key: string; assignee: string; slaStatus: string; equipmentSerial?: string }>;
      kpis: { avgFirstResponseMinutes: number; avgResolutionMinutes: number; breachedCount: number };
    };
    assert.ok(listBody.kpis.avgFirstResponseMinutes > 0);
    assert.ok(listBody.kpis.avgResolutionMinutes > 0);
    const jsm101 = listBody.data.find((t) => t.key === 'JSM-101');
    assert.ok(jsm101);
    assert.ok(jsm101!.assignee.includes('NOC N2'));
    assert.ok(jsm101!.equipmentSerial?.includes('SN-FGT100F'));

    // 2. Alterar prioridade e fila NOC em JSM-102 via PATCH e validar recálculo de SLA
    const before102 = repo.getServiceTicketById('JSM-102')!;
    const oldResolveDue = before102.slaResolutionDueAt;

    const patchRes = await router.dispatch({
      method: 'PATCH',
      path: '/api/tickets/JSM-102',
      body: {
        priority: 'CRITICAL',
        assignee: 'NOC N3 - Engenharia Core & Entroncamento E1',
        equipmentSerial: 'SN-SETA-SBC-CORE-01',
      },
    });
    assert.equal(patchRes.status, 200);
    const patched102 = (patchRes.body as {
      data: { priority: string; assignee: string; slaResolutionDueAt: string; equipmentSerial: string };
    }).data;
    assert.equal(patched102.priority, 'CRITICAL');
    assert.equal(patched102.assignee, 'NOC N3 - Engenharia Core & Entroncamento E1');
    assert.equal(patched102.equipmentSerial, 'SN-SETA-SBC-CORE-01');
    assert.notEqual(patched102.slaResolutionDueAt, oldResolveDue, 'Deve recalcular prazo de resolução ao mudar prioridade');

    // 3. Gerar Ordem de Serviço (O.S.) no GestãoClick ERP a partir do ticket JSM-102
    const osRes = await router.dispatch({
      method: 'POST',
      path: '/api/tickets/JSM-102/create-os',
      body: {
        technicianName: 'NOC N3 - Engenharia Core & Entroncamento E1',
      },
    });
    assert.equal(osRes.status, 201);
    const osData = (osRes.body as {
      data: {
        ticket: { serviceOrderId: string; status: string };
        serviceOrder: { id: string; code: string; status: string };
      };
    }).data;
    assert.ok(osData.serviceOrder.id);
    assert.ok(Number(osData.serviceOrder.code) >= 1519);
    assert.equal(osData.ticket.serviceOrderId, osData.serviceOrder.id);
    assert.equal(osData.ticket.status, 'IN_PROGRESS');
  });

  it('opera Portal Externo do Cliente (/api/portal/tickets): oculta notas internas do NOC, abre novo protocolo com SLA, responde e registra avaliação CSAT', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Consultar protocolo JSM-101 no Portal e garantir que notas internas (isInternal: true) NÃO aparecem
    const getPortalRes = await router.dispatch({
      method: 'GET',
      path: '/api/portal/tickets?key=JSM-101',
    });
    assert.equal(getPortalRes.status, 200);
    const portalTickets = (getPortalRes.body as {
      data: Array<{ key: string; comments: Array<{ isInternal: boolean; body: string }> }>;
    }).data;
    assert.equal(portalTickets.length, 1);
    assert.equal(portalTickets[0].key, 'JSM-101');
    assert.ok(
      portalTickets[0].comments.every((c) => c.isInternal === false),
      'Portal público nunca deve expor notas internas do NOC'
    );

    // 2. Abrir novo chamado técnico pelo Portal do Cliente
    const createPortalRes = await router.dispatch({
      method: 'POST',
      path: '/api/portal/tickets',
      body: {
        name: 'Roberto Mendes',
        email: 'roberto.mendes@bemisa.com.br',
        companyName: 'BEMISA PARTICIPACOES S.A.',
        phone: '(31) 98811-2233',
        category: 'INCIDENT',
        priority: 'CRITICAL',
        equipmentSerial: 'SN-SETA-PABX-BM01',
        subject: 'Indisponibilidade de Tronco SIP DDR na Matriz BH',
        description: 'Chamadas entrantes retornando ocupado desde as 13h.',
      },
    });
    assert.equal(createPortalRes.status, 201);
    const createdPortalTicket = (createPortalRes.body as {
      data: { key: string; assignee: string; priority: string; equipmentSerial: string };
    }).data;
    assert.ok(createdPortalTicket.key.startsWith('JSM-'));
    assert.equal(createdPortalTicket.priority, 'CRITICAL');
    assert.equal(createdPortalTicket.equipmentSerial, 'SN-SETA-PABX-BM01');
    assert.ok(createdPortalTicket.assignee.includes('NOC N2'));

    // 3. Cliente responde em chamado que estava WAITING_CUSTOMER (JSM-103) -> volta para IN_PROGRESS
    const replyRes = await router.dispatch({
      method: 'POST',
      path: '/api/portal/tickets/JSM-103/reply',
      body: {
        author: 'Camila Ferreira (VTEX)',
        body: 'Janela de manutenção no Data Center aprovada para hoje às 22h.',
      },
    });
    assert.equal(replyRes.status, 201);
    const repliedTicket = (replyRes.body as { data: { status: string; comments: unknown[] } }).data;
    assert.equal(repliedTicket.status, 'IN_PROGRESS');

    // 4. Cliente avalia atendimento CSAT (1 a 5 estrelas)
    const csatRes = await router.dispatch({
      method: 'POST',
      path: `/api/portal/tickets/${createdPortalTicket.key}/csat`,
      body: {
        score: 5,
        feedback: 'Atendimento impecável do NOC Seta Telecom, tronco SIP restabelecido em 12 minutos!',
      },
    });
    assert.equal(csatRes.status, 200);
    const ratedTicket = (csatRes.body as { data: { csatScore: number } }).data;
    assert.equal(ratedTicket.csatScore, 5);
  });
});

describe('11. Pacote Completo de Contratos & Locação (Modalidades, Patrimônios S/N, Vigência, Reajuste IPCA/IGP-M e Conversão)', () => {
  it('converte proposta preservando S/N e índice de reajuste, renova vigência (+12m) e aplica reajuste anual (IPCA/IGP-M) em contratos', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Aprovar prop-seta-003 (que tem readjustmentIndex: IGP-M e S/N pré-alocados)
    const appRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals/prop-seta-003/approve',
      body: {
        signerName: 'Carlos Eduardo Almeida',
        signerCpf: '529.982.247-25',
        signerRole: 'Diretor / Representante Legal',
        modality: 'ICP_BRASIL_A1',
        acceptedTerms: true,
      },
    });
    assert.equal(appRes.status, 200);
    const appContract = (appRes.body as {
      data: {
        contract: {
          id: string;
          readjustmentIndex: string;
          modality: string;
          equipments: Array<{ serialNumber: string }>;
        };
      };
    }).data.contract;
    assert.equal(appContract.readjustmentIndex, 'IGP-M');
    assert.equal(appContract.modality, 'LOCACAO');
    assert.equal(appContract.equipments[0].serialNumber, 'SN-FGT100F-CR8810');

    // 2. Renovar vigência de ctr-loc-103 (que estava em RENOVACAO_PROXIMA)
    const renewRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/rental-contracts/ctr-loc-103/renew',
      body: { months: 12 },
    });
    assert.equal(renewRes.status, 200);
    const renewedCtr = (renewRes.body as {
      data: { status: string; contractMonths: number; endDate: string };
    }).data;
    assert.equal(renewedCtr.status, 'ATIVO');
    assert.equal(renewedCtr.contractMonths, 24);

    // 3. Aplicar reajuste anual de 4.50% (IPCA) ao contrato ctr-loc-101 (mensalidade R$ 12.000 -> R$ 12.540)
    const readjRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/rental-contracts/ctr-loc-101/readjust',
      body: { index: 'IPCA', percentage: 4.5, note: 'Reajuste anual IPCA 12m' },
    });
    assert.equal(readjRes.status, 200);
    const readjustedCtr = (readjRes.body as {
      data: {
        monthlyValue: number;
        lastReadjustmentPercent: number;
        readjustmentHistory: Array<{ previousMonthlyValue: number; newMonthlyValue: number }>;
      };
    }).data;
    assert.equal(readjustedCtr.monthlyValue, 12540);
    assert.equal(readjustedCtr.lastReadjustmentPercent, 4.5);
    assert.ok(readjustedCtr.readjustmentHistory.length >= 1);
    assert.equal(readjustedCtr.readjustmentHistory[0].previousMonthlyValue, 12000);
    assert.equal(readjustedCtr.readjustmentHistory[0].newMonthlyValue, 12540);
  });
});

describe('12. Segmentação ABM, Buying Role, Composer de E-mail nos Cards (Templates & Snippets) e Tarefas HubSpot', () => {
  it('persiste buyingRole, ownerName e isUnworked em Contatos e isTargetAccount e icpTier em Empresas', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Criar Empresa Conta Alvo ABM Tier 1
    const compRes = await router.dispatch({
      method: 'POST',
      path: '/api/companies',
      body: {
        name: 'B3 Brasil Bolsa Balcão S.A.',
        domain: 'b3.com.br',
        industry: 'Mercado Financeiro & Infraestrutura',
        size: '1000+ funcionários',
        annualRevenue: 10000000000,
        isTargetAccount: true,
        icpTier: 'TIER_1',
        ownerName: 'Evelyn Ternero Seta Telecom',
      },
    });
    assert.equal(compRes.status, 201);
    const createdComp = (compRes.body as {
      data: { id: string; isTargetAccount: boolean; icpTier: string; ownerName: string };
    }).data;
    assert.equal(createdComp.isTargetAccount, true);
    assert.equal(createdComp.icpTier, 'TIER_1');
    assert.equal(createdComp.ownerName, 'Evelyn Ternero Seta Telecom');

    // 2. Criar Contato com buyingRole COMPRADOR_ECONOMICO e isUnworked true
    const contRes = await router.dispatch({
      method: 'POST',
      path: '/api/contacts',
      body: {
        firstName: 'Henrique',
        lastName: 'Meirelles',
        email: 'henrique@b3.com.br',
        phone: '(11) 97777-8899',
        jobTitle: 'VP Financeiro',
        companyId: createdComp.id,
        buyingRole: 'COMPRADOR_ECONOMICO',
        ownerName: 'Evelyn Ternero Seta Telecom',
        isUnworked: true,
      },
    });
    assert.equal(contRes.status, 201);
    const createdContact = (contRes.body as {
      data: { id: string; buyingRole: string; ownerName: string; isUnworked: boolean };
    }).data;
    assert.equal(createdContact.buyingRole, 'COMPRADOR_ECONOMICO');
    assert.equal(createdContact.ownerName, 'Evelyn Ternero Seta Telecom');
    assert.equal(createdContact.isUnworked, true);

    // 3. Atualizar Contato mudando buyingRole para DECISOR e isUnworked para false
    const patchRes = await router.dispatch({
      method: 'PATCH',
      path: `/api/contacts/${createdContact.id}`,
      body: {
        buyingRole: 'DECISOR',
        isUnworked: false,
      },
    });
    assert.equal(patchRes.status, 200);
    const updatedContact = (patchRes.body as {
      data: { buyingRole: string; isUnworked: boolean };
    }).data;
    assert.equal(updatedContact.buyingRole, 'DECISOR');
    assert.equal(updatedContact.isUnworked, false);
  });

  it('envia e-mail de dentro do card usando Template e Snippet, registra na Timeline e cria Tarefa de Follow-up HubSpot automaticamente', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Listar Templates e Snippets
    const tplListRes = await router.dispatch({ method: 'GET', path: '/api/email-templates' });
    assert.equal(tplListRes.status, 200);
    const templates = (tplListRes.body as { data: Array<{ id: string }> }).data;
    assert.ok(templates.length >= 4);

    const snipListRes = await router.dispatch({ method: 'GET', path: '/api/snippets' });
    assert.equal(snipListRes.status, 200);
    const snippets = (snipListRes.body as { data: Array<{ id: string; shortcut: string }> }).data;
    assert.ok(snippets.length >= 5);

    // 2. Disparar e-mail com createFollowUpTask = true para contato vinculado + outro destinatário
    const sendRes = await router.dispatch({
      method: 'POST',
      path: '/api/emails/send',
      body: {
        to: 'marina.costa@nubank.com.br, ricardo.almeida@totvs.com.br',
        cc: 'comercial@setatelecom.com.br',
        subject: '[Seta Telecom] Proposta Cluster PABX IP + SD-WAN (Nubank)',
        body: 'Olá Marina, segue proposta comercial com SLA 99,95% e isenção de ISS (SV 31 STF).',
        senderName: 'Marcelo Lopes Mira',
        contactId: 'cont-marina',
        companyId: 'comp-nubank',
        templateId: templates[0].id,
        snippetIds: [snippets[0].id],
        createFollowUpTask: true,
        followUpDays: 3,
        followUpDueTime: '10:30',
        followUpType: 'CALL',
        followUpPriority: 'HIGH',
        followUpQueueName: 'Prospecção ABM Tier 1',
      },
    });
    assert.equal(sendRes.status, 201);
    const sendData = (sendRes.body as {
      data: {
        protocol: string;
        toList: string[];
        timelineEvent: { id: string; type: string };
        followUpTask: {
          id: string;
          type: string;
          priority: string;
          queueName: string;
          status: string;
          contactId: string;
        };
      };
    }).data;

    assert.ok(sendData.protocol.startsWith('HS-MAIL-'));
    assert.equal(sendData.toList.length, 2);
    assert.equal(sendData.timelineEvent.type, 'EMAIL');
    assert.ok(sendData.followUpTask, 'Deve criar automaticamente a tarefa de follow-up');
    assert.equal(sendData.followUpTask.type, 'CALL');
    assert.equal(sendData.followUpTask.priority, 'HIGH');
    assert.equal(sendData.followUpTask.queueName, 'Prospecção ABM Tier 1');
    assert.equal(sendData.followUpTask.status, 'NOT_STARTED');
    assert.equal(sendData.followUpTask.contactId, 'cont-marina');

    // 3. Concluir a tarefa de follow-up via POST /api/tasks/:id/complete
    const completeRes = await router.dispatch({
      method: 'POST',
      path: `/api/tasks/${sendData.followUpTask.id}/complete`,
    });
    assert.equal(completeRes.status, 200);
    const completedTask = (completeRes.body as {
      data: { status: string; completedAt: string | null };
    }).data;
    assert.equal(completedTask.status, 'COMPLETED');
    assert.ok(completedTask.completedAt);
  });
});


describe('13. Segurança Corporativa STI-hub: Login com MFA 2FA, Proteção de Rotas & Matriz RBAC (9 Perfis + 22 Usuários Seta Telecom)', () => {
  it('retorna matriz RBAC completa com 9 perfis, 22 usuários da Seta Telecom, subdomínios oficiais e Custom Properties 4369067', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const rbacRes = await router.dispatch({ method: 'GET', path: '/api/admin/rbac' });
    assert.equal(rbacRes.status, 200);
    const rbacData = (rbacRes.body as {
      data: {
        roles: Array<{ id: string; actionGuards: Record<string, boolean> }>;
        users: Array<{ id: string; name: string; email: string; roleId: string; scope: string; active: boolean }>;
        securityConfig: {
          enforceMfaOnAllLogins: boolean;
          subdomains: Array<{ domain: string }>;
          customProperties: Array<{ internalName: string }>;
        };
        summary: { totalRoles: number; totalUsers: number; activeUsersCount: number };
      };
    }).data;

    assert.equal(rbacData.summary.totalRoles, 9);
    assert.equal(rbacData.roles.length, 9);
    assert.ok(rbacData.users.length >= 22);
    assert.equal(rbacData.securityConfig.enforceMfaOnAllLogins, true);
    assert.ok(rbacData.securityConfig.subdomains.some((s) => s.domain === 'sti-hub.vercel.app'));
    assert.ok(rbacData.securityConfig.subdomains.some((s) => s.domain === 'stihub.setatelecom.com.br'));
    assert.ok(rbacData.securityConfig.customProperties.some((p) => p.internalName === 'hs_buying_role'));

    // Atualizar escopo e perfil de um usuário via PUT /api/admin/users/:id
    const updUserRes = await router.dispatch({
      method: 'PUT',
      path: '/api/admin/users/usr-seta-03',
      body: {
        roleId: 'GERENTE_COMERCIAL',
        scope: 'EQUIPE',
      },
    });
    assert.equal(updUserRes.status, 200);
    const updatedUser = (updUserRes.body as { data: { roleId: string; scope: string } }).data;
    assert.equal(updatedUser.roleId, 'GERENTE_COMERCIAL');
    assert.equal(updatedUser.scope, 'EQUIPE');
  });

  it('autentica usuário Seta Telecom em 2 etapas obrigatórias (Login + Código MFA 2FA de 6 dígitos) e emite sessão HttpOnly', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    // Contencao 29/10/2026: sem senha-mestra; o usuario precisa de senha propria (hash).
    repo.upsertRbacUser({ email: 'marcelo.mira@setatelecom.com.br', password: 'Seta@2026#StiHub' });

    // Etapa 1: Credenciais corporativas -> Desafio MFA
    const loginRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'marcelo.mira@setatelecom.com.br',
        password: 'Seta@2026#StiHub',
      },
    });
    assert.equal(loginRes.status, 200);
    const loginData = (loginRes.body as {
      data: {
        mfaRequired: boolean;
        challengeId: string;
        demoTotpCode: string;
        user: { id: string; roleId: string };
      };
    }).data;
    assert.equal(loginData.mfaRequired, true);
    assert.ok(loginData.challengeId.startsWith('MFA-'));
    assert.equal(loginData.user.roleId, 'SUPER_ADMIN');

    // Etapa 2a: Rejeita código MFA incorreto (401)
    const badMfaRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'marcelo.mira@setatelecom.com.br',
        code: '000000',
      },
    });
    assert.equal(badMfaRes.status, 401);

    // Etapa 2b: Aprova código MFA correto (436906) e emite Set-Cookie HttpOnly
    const okMfaRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'marcelo.mira@setatelecom.com.br',
        code: loginData.demoTotpCode,
      },
    });
    assert.equal(okMfaRes.status, 200);
    assert.ok(okMfaRes.headers?.['Set-Cookie']?.includes('stihub_session='));
    assert.ok(okMfaRes.headers?.['Set-Cookie']?.includes('HttpOnly'));

    const mfaSession = (okMfaRes.body as {
      data: { authenticated: boolean; mfaVerified: boolean; sessionToken: string };
    }).data;
    assert.equal(mfaSession.authenticated, true);
    assert.equal(mfaSession.mfaVerified, true);

    // Etapa 3: Valida resolução da sessão via GET /api/auth/session
    const sessRes = await router.dispatch({
      method: 'GET',
      path: '/api/auth/session',
      query: { token: mfaSession.sessionToken },
    });
    assert.equal(sessRes.status, 200);
    const sessData = (sessRes.body as {
      data: { authenticated: boolean; mfaVerified: boolean; user: { email: string } };
    }).data;
    assert.equal(sessData.authenticated, true);
    assert.equal(sessData.mfaVerified, true);
    assert.equal(sessData.user.email, 'marcelo.mira@setatelecom.com.br');
  });
});

describe('12. Devolução Parcial com Rateio Proporcional (Pro-Rata Die s/ Pausar Contrato), Faturamento em Massa & Consulta CNPJ/Serasa', () => {
  it('executa devolução parcial de 2 entre 14 equipamentos (Pro-Rata 15/30 dias) mantendo o contrato ATIVO, gera faturamento em massa e consulta CNPJ na RFB + Serasa', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Devolução parcial de 2 terminais Yealink (unitMonthlyRent = 240, 15/30 dias) no contrato ctr-loc-101 (mensalidade R$ 12.000)
    // Redução mensal = 2 * 240 = R$ 480 -> Novo MRR recorrente = R$ 11.520
    // Pro-rata dos 2 devolvidos neste ciclo (15 dias) = R$ 240 -> Fatura deste mês com rateio = 11.520 + 240 = R$ 11.760
    const partialRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/rental-contracts/ctr-loc-101/partial-return',
      body: {
        returnDate: '2026-10-25',
        cycleDaysUsed: 15,
        itemsToReturn: [{ equipmentIdx: 2, quantityReturned: 2 }],
        emitReturnNfe: true,
        emitProRataInvoice: true,
        reason: 'Redução de 2 ramais físicos mantendo contrato ATIVO',
      },
    });
    assert.equal(partialRes.status, 200);
    const partialData = (partialRes.body as {
      data: {
        contract: {
          status: string;
          monthlyValue: number;
          equipments: Array<{ quantity: number }>;
          partialReturns: Array<{
            previousMonthlyValue: number;
            newRecurringMonthlyValue: number;
            currentCycleProRataTotalBrl: number;
          }>;
        };
        returnNfe: { documentType: string; cfop: string } | null;
        proRataInvoice: { grossAmount: number; taxBreakdown: { issAmount: number } } | null;
      };
    }).data;

    assert.equal(partialData.contract.status, 'ATIVO', 'Contrato NÃO deve ser pausado na devolução parcial');
    assert.equal(partialData.contract.monthlyValue, 11520);
    assert.equal(partialData.contract.equipments[2].quantity, 8, 'Deve restar 8 terminais ativos de 10');
    assert.equal(partialData.contract.partialReturns[0].previousMonthlyValue, 12000);
    assert.equal(partialData.contract.partialReturns[0].newRecurringMonthlyValue, 11520);
    assert.equal(partialData.contract.partialReturns[0].currentCycleProRataTotalBrl, 11760);
    assert.ok(partialData.returnNfe?.cfop.startsWith('5.909'));
    assert.equal(partialData.proRataInvoice?.grossAmount, 11760);
    assert.equal(partialData.proRataInvoice?.taxBreakdown.issAmount, 0);

    // 2. Faturamento de Locação em Massa + Envio de E-mails em Massa
    const batchRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/rental-contracts/batch-billing',
      body: {
        competenceMonth: '11/2026',
        items: [
          {
            contractId: 'ctr-loc-101',
            customAmountBrl: 11520,
            discountBrl: 20,
            extraBrl: 0,
            sendEmail: true,
            recipientEmail: 'financeiro@nubank.com.br',
          },
          {
            contractId: 'ctr-loc-102',
            customAmountBrl: 6600,
            sendEmail: true,
            recipientEmail: 'financeiro@rdstation.com.br',
          },
        ],
      },
    });
    assert.equal(batchRes.status, 201);
    const batchData = (batchRes.body as {
      data: { invoicesGenerated: number; emailsDispatched: number; totalBilledBrl: number };
    }).data;
    assert.equal(batchData.invoicesGenerated, 2);
    assert.equal(batchData.emailsDispatched, 2);
    assert.equal(batchData.totalBilledBrl, 11500 + 6600);

    // 3. Consulta CNPJ na Receita Federal + Serasa Experian (Digisystem 01.936.069/0001-94)
    const cnpjRes = await router.dispatch({
      method: 'GET',
      path: '/api/erp/cnpj/01.936.069/0001-94',
    });
    assert.equal(cnpjRes.status, 200);
    const cnpjData = (cnpjRes.body as {
      data: {
        legalName: string;
        cep: string;
        street: string;
        serasa: { score: number; protestosCount: number };
      };
    }).data;
    assert.equal(cnpjData.legalName, 'Digisystem Servicos Especializados LTDA');
    assert.equal(cnpjData.cep, '01311-926');
    assert.ok(cnpjData.serasa.score >= 850);
    assert.equal(cnpjData.serasa.protestosCount, 0);
  });
  it('executa conciliação bancária OFX (Inter 077 / Itaú 341), DRE Gerencial Vertical, importação XML NF-e (SEFAZ Mod. 55 com S/N), assinatura ICP-Brasil / Gov.br em propostas e sincronização diária incremental', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Conciliação Bancária OFX (Banco Inter 077)
    const sampleOfx = `OFXHEADER:100
DATA:OFXSGML
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <BANKACCTFROM><BANKID>077</BANKID><ACCTID>237906</ACCTID></BANKACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>CREDIT
            <DTPOSTED>20261026
            <TRNAMT>6600.00
            <FITID>INTER-20261026-001
            <MEMO>LIQ PIX/BOLETO FATURA LOCACAO RD STATION
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>DEBIT
            <DTPOSTED>20261026
            <TRNAMT>-843.15
            <FITID>INTER-20261026-002
            <MEMO>PAGTO DARF PIS COFINS CUMULATIVO
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;

    const ofxRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/financial/reconcile-ofx',
      body: {
        bankId: 'Banco Inter',
        ofxContent: sampleOfx,
        autoPayMatched: true,
      },
    });
    assert.equal(ofxRes.status, 200);
    const ofxBody = ofxRes.body as {
      matchedCount: number;
      data: {
        bankCode: string;
        companyCnpj: string;
        totalTransactionsParsed: number;
        totalCreditsBrl: number;
        totalDebitsBrl: number;
      };
    };
    assert.equal(ofxBody.data.bankCode, '077');
    assert.equal(ofxBody.data.companyCnpj, '14.806.925/0001-32');
    assert.equal(ofxBody.data.totalTransactionsParsed, 2);
    assert.equal(ofxBody.data.totalCreditsBrl, 6600);
    assert.equal(ofxBody.data.totalDebitsBrl, 843.15);
    assert.ok(ofxBody.matchedCount >= 1);

    // 2. DRE Gerencial Vertical (GET /api/erp/financial/dre)
    const dreRes = await router.dispatch({
      method: 'GET',
      path: '/api/erp/financial/dre',
      query: { competenceMonth: '10/2026' },
    });
    assert.equal(dreRes.status, 200);
    const dreData = (dreRes.body as {
      data: {
        companyCnpj: string;
        storeId: string;
        grossRevenueRentalSv31: number;
        grossRevenueServicesLc116: number;
        grossRevenueHardwareSales: number;
        grossRevenueTotal: number;
        issSavedBySv31Stf: number;
        netOperatingRevenue: number;
        ebitda: number;
        netProfit: number;
        lines: Array<{ code: string; label: string; monthlyBrl: number }>;
      };
    }).data;
    assert.equal(dreData.companyCnpj, '14.806.925/0001-32');
    assert.equal(dreData.storeId, '118887');
    assert.ok(dreData.grossRevenueRentalSv31 > 0);
    assert.ok(dreData.grossRevenueServicesLc116 > 0);
    assert.ok(dreData.grossRevenueHardwareSales > 0);
    assert.ok(dreData.issSavedBySv31Stf > 0);
    assert.ok(dreData.ebitda > 0);
    assert.ok(dreData.netProfit > 0);
    assert.ok(dreData.lines.length >= 15);

    // 3. Importação de XML SEFAZ NF-e Mod. 55 em Compras/Estoque (POST /api/erp/purchases/import-xml)
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="NFe35261068993641000802550010000109991000109994">
      <ide><nNF>10999</nNF><dhEmi>2026-10-26T10:00:00-03:00</dhEmi></ide>
      <emit>
        <CNPJ>68993641000802</CNPJ>
        <xNome>AGIS EQUIPAMENTOS E SERVICOS DE INFORMATICA LTDA.</xNome>
      </emit>
      <det nItem="1">
        <prod>
          <cProd>GC-EQ-00103</cProd>
          <xProd>Kit Terminais IP Gigabit Yealink SIP-T43U PoE</xProd>
          <NCM>85171899</NCM>
          <CFOP>5102</CFOP>
          <qCom>3</qCom>
          <vUnCom>1500.00</vUnCom>
          <vProd>4500.00</vProd>
        </prod>
        <infAdProd>S/N: SN-YLK-XML-01, SN-YLK-XML-02, SN-YLK-XML-03</infAdProd>
      </det>
      <total><ICMSTot><vNF>4500.00</vNF><vICMS>810.00</vICMS><vPIS>29.25</vPIS><vCOFINS>135.00</vCOFINS></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

    const xmlRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/purchases/import-xml',
      body: {
        xmlContent: sampleXml,
        cfopEntrada: '1.551 — Compra de bem para o Ativo Imobilizado (Parque de Locação)',
        autoReceiveStock: true,
      },
    });
    assert.equal(xmlRes.status, 201);
    const xmlData = (xmlRes.body as {
      data: {
        purchaseOrder: {
          nfeAccessKey: string;
          cfopEntrada: string;
          totalAmount: number;
          serialNumbers: string[];
        };
        updatedCatalogItems: Array<{ gestaoClickCode: string; stockAvailable: number }>;
      };
    }).data;
    assert.equal(xmlData.purchaseOrder.nfeAccessKey, '35261068993641000802550010000109991000109994');
    assert.ok(xmlData.purchaseOrder.cfopEntrada.startsWith('1.551'));
    assert.equal(xmlData.purchaseOrder.totalAmount, 4500);
    assert.equal(xmlData.purchaseOrder.serialNumbers.length, 3);
    assert.ok(xmlData.updatedCatalogItems.length >= 1);

    // 4. Assinatura Eletrônica ICP-Brasil / Gov.br na aprovação de proposta (/api/erp/proposals/:id/approve)
    const approveRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals/prop-seta-002/approve',
      body: {
        signerName: 'Maria Luiza Fontes',
        signerCpf: '111.444.777-35',
        signerRole: 'Diretora de TI & Compras',
        modality: 'ICP_BRASIL_A1',
        acceptedTerms: true,
      },
    });
    assert.equal(approveRes.status, 200);
    const approveData = (approveRes.body as {
      data: {
        proposal: { status: string; digitalSignature: { signerName: string; signatureHashSha256: string; modality: string } };
        digitalSignature: { signerName: string; signerCpf: string; signatureHashSha256: string; timestampToken: string };
      };
    }).data;
    assert.equal(approveData.proposal.status, 'CONVERTIDA_CONTRATO');
    assert.equal(approveData.digitalSignature.signerName, 'Maria Luiza Fontes');
    assert.equal(approveData.digitalSignature.signerCpf, '111.444.777-35');
    assert.equal(approveData.digitalSignature.signatureHashSha256.length, 64);
    assert.ok(approveData.digitalSignature.timestampToken.startsWith('ACT-ITI-'));

    // 5. Sincronização Diária Incremental (/api/erp/daily-sync)
    const syncRes = await router.dispatch({
      method: 'GET',
      path: '/api/erp/daily-sync',
    });
    assert.equal(syncRes.status, 200);
    const syncData = (syncRes.body as {
      data: { storeId: string; companyCnpj: string; fictitiousDataPurged: boolean };
    }).data;
    assert.equal(syncData.storeId, '118887');
    assert.equal(syncData.companyCnpj, '14.806.925/0001-32');
    assert.equal(syncData.fictitiousDataPurged, true);
  });
});

describe('14. Responsividade Mobile (Drawers & Quick Bars) e 5 Modos de Visualização em Negócios e Chamados', () => {
  it('garante drawers mobile deslizantes nas sidebars CRM e ERP, barra rápida horizontal e 3 itens de topo sem emojis', () => {
    const rootDir = process.cwd();
    const pageSrc = fs.readFileSync(path.join(rootDir, 'src/app/page.tsx'), 'utf8');
    const crmSidebarSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/CrmSidebar.tsx'), 'utf8');
    const gcSidebarSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/GestaoClickSidebar.tsx'), 'utf8');
    const erpTabSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');

    // 1. Drawers mobile em CrmSidebar e GestaoClickSidebar
    assert.ok(crmSidebarSrc.includes('mobileDrawerOpen'));
    assert.ok(crmSidebarSrc.includes('onCloseMobileDrawer'));
    assert.ok(crmSidebarSrc.includes('hidden md:flex'));
    assert.ok(gcSidebarSrc.includes('mobileDrawerOpen'));
    assert.ok(gcSidebarSrc.includes('onCloseMobileDrawer'));
    assert.ok(gcSidebarSrc.includes('hidden md:flex'));

    // 2. Botões Menu CRM e Menu ERP + barras rápidas mobile
    assert.ok(pageSrc.includes('Menu CRM'));
    assert.ok(pageSrc.includes('crmMobileDrawerOpen'));
    assert.ok(erpTabSrc.includes('Menu ERP'));
    assert.ok(erpTabSrc.includes('erpMobileDrawerOpen'));

    // 3. Zero emojis na barra principal
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(pageSrc), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(crmSidebarSrc), false);
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(gcSidebarSrc), false);
  });

  it('disponibiliza os 5 modos de visualização corporativos tanto nos Pipelines de Negócios quanto em Chamados NOC com persistência localStorage', () => {
    const rootDir = process.cwd();
    const dealsSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/DealsKanbanTab.tsx'), 'utf8');
    const ticketsSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ServiceDeskTab.tsx'), 'utf8');

    // 5 modos em Pipelines de Negócios + persistência stihub_deals_view_mode
    for (const mode of ['KANBAN', 'LIST', 'COMPACT_GRID', 'TIMELINE_FORECAST', 'BY_OWNER_PRIORITY']) {
      assert.ok(dealsSrc.includes(`'${mode}'`), `DealsKanbanTab deve conter o modo ${mode}`);
    }
    assert.ok(dealsSrc.includes('stihub_deals_view_mode'));

    // 5 modos em Chamados NOC + persistência stihub_tickets_view_mode
    for (const mode of ['KANBAN', 'LIST', 'COMPACT_GRID', 'SLA_TIMELINE', 'BY_QUEUE_TECH']) {
      assert.ok(ticketsSrc.includes(`'${mode}'`), `ServiceDeskTab deve conter o modo ${mode}`);
    }
    assert.ok(ticketsSrc.includes('stihub_tickets_view_mode'));
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ticketsSrc), false);
  });
});


describe('15. Hardening CISO: 2FA Real (Google Authenticator RFC 6238 TOTP + E-mail OTP), Sessão HMAC-SHA256, IAM 2 Painéis & Escopo Modular (CRM / ERP / Chamados)', () => {
  it('valida TOTP RFC 6238 (Base32 + otpauth:// + QR SVG), OTP por E-mail com uso único e rejeita tokens falsificados', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Setup Google Authenticator TOTP RFC 6238
    const setupRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/setup-totp',
      body: { email: 'marcelo.mira@setatelecom.com.br' },
    });
    assert.equal(setupRes.status, 200);
    const setupData = (setupRes.body as {
      data: {
        totpSecret: string;
        otpauthUri: string;
        qrCodeSvgDataUrl: string;
        currentTotpCode: string;
      };
    }).data;
    assert.ok(setupData.totpSecret.length >= 16);
    assert.ok(setupData.otpauthUri.startsWith('otpauth://totp/'));
    assert.ok(setupData.qrCodeSvgDataUrl.startsWith('data:image/svg+xml'));
    assert.equal(setupData.currentTotpCode.length, 6);

    // 2. Verifica TOTP RFC 6238 e emite token assinado HMAC-SHA256
    const mfaTotpRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'marcelo.mira@setatelecom.com.br',
        code: setupData.currentTotpCode,
      },
    });
    assert.equal(mfaTotpRes.status, 200);
    const totpSession = (mfaTotpRes.body as {
      data: { sessionToken: string; verifiedVia: string };
    }).data;
    assert.equal(totpSession.verifiedVia, 'RFC6238_TOTP');
    assert.ok(totpSession.sessionToken.includes('.'), 'Token deve conter assinatura HMAC-SHA256 separada por ponto');

    // 3. Disparo e validação de Código OTP por E-mail (uso único)
    const sendOtpRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/send-email-otp',
      body: { email: 'fiscal@setatelecom.com.br' },
    });
    assert.equal(sendOtpRes.status, 200);
    const otpPayload = (sendOtpRes.body as {
      data: { devOtpPreview: string; protocol: string; ttlSeconds: number };
    }).data;
    assert.equal(otpPayload.devOtpPreview.length, 6);
    assert.ok(otpPayload.protocol.startsWith('STI-OTP-'));
    assert.equal(otpPayload.ttlSeconds, 300);

    const verifyEmailOtpRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'fiscal@setatelecom.com.br',
        code: otpPayload.devOtpPreview,
        mfaMethod: 'EMAIL_OTP',
      },
    });
    assert.equal(verifyEmailOtpRes.status, 200);
    const emailOtpSession = (verifyEmailOtpRes.body as {
      data: { verifiedVia: string; sessionToken: string; enabledModules: string[] };
    }).data;
    assert.equal(emailOtpSession.verifiedVia, 'EMAIL_OTP');
    assert.deepEqual(emailOtpSession.enabledModules, ['ERP']);

    // Reutilização do mesmo código OTP de e-mail deve falhar (replay protection)
    const replayOtpRes = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'fiscal@setatelecom.com.br',
        code: otpPayload.devOtpPreview,
        mfaMethod: 'EMAIL_OTP',
      },
    });
    assert.equal(replayOtpRes.status, 401);
  });

  it('aplica isolamento estrito de módulos (CRM, ERP, Chamados) e os 2 painéis IAM (Permissões CRM vs Permissões ERP)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Usuário exclusivo de Chamados (henrique.noc@setatelecom.com.br -> ['CHAMADOS'])
    const nocSetup = repo.setupUserTotp('henrique.noc@setatelecom.com.br');
    const nocLogin = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'henrique.noc@setatelecom.com.br',
        code: nocSetup.currentTotpCode,
      },
    });
    assert.equal(nocLogin.status, 200);
    const nocToken = (nocLogin.body as { data: { sessionToken: string; enabledModules: string[] } }).data.sessionToken;

    // Acesso permitido a Chamados (/api/tickets)
    const ticketsOk = await router.dispatch({
      method: 'GET',
      path: '/api/tickets',
      query: { _sessionToken: nocToken },
    });
    assert.equal(ticketsOk.status, 200);

    // Acesso bloqueado a ERP (/api/erp/overview) -> 403 MODULE_ERP_FORBIDDEN
    const erpBlocked = await router.dispatch({
      method: 'GET',
      path: '/api/erp/overview',
      query: { _sessionToken: nocToken },
    });
    assert.equal(erpBlocked.status, 403);

    // Acesso bloqueado a CRM (/api/deals) -> 403 MODULE_CRM_FORBIDDEN
    const crmBlocked = await router.dispatch({
      method: 'GET',
      path: '/api/deals',
      query: { _sessionToken: nocToken },
    });
    assert.equal(crmBlocked.status, 403);

    // 2. Usuário exclusivo de CRM (marketing@setatelecom.com.br -> ['CRM'])
    const mktSetup = repo.setupUserTotp('marketing@setatelecom.com.br');
    const mktLogin = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      body: {
        email: 'marketing@setatelecom.com.br',
        code: mktSetup.currentTotpCode,
      },
    });
    const mktToken = (mktLogin.body as { data: { sessionToken: string } }).data.sessionToken;

    const crmAllowed = await router.dispatch({
      method: 'GET',
      path: '/api/deals',
      query: { _sessionToken: mktToken },
    });
    assert.equal(crmAllowed.status, 200);

    const mktErpBlocked = await router.dispatch({
      method: 'GET',
      path: '/api/erp/overview',
      query: { _sessionToken: mktToken },
    });
    assert.equal(mktErpBlocked.status, 403);

    // 3. Proteção da Trava Fiscal do CNPJ Matriz 14.806.925/0001-32 e Audit Logs SHA-256
    const badEmitterCnpj = await router.dispatch({
      method: 'PUT',
      path: '/api/admin/settings',
      body: {
        companyEmitter: {
          cnpj: '07.228.550/0001-19',
        },
      },
    });
    assert.equal(badEmitterCnpj.status, 400);

    const auditRes = await router.dispatch({
      method: 'GET',
      path: '/api/admin/audit-logs',
    });
    assert.equal(auditRes.status, 200);
    const auditData = (auditRes.body as {
      data: { total: number; chainIntegrityVerified: boolean; logs: Array<{ integrityHashSha256: string }> };
    }).data;
    assert.equal(auditData.chainIntegrityVerified, true);
    assert.ok(auditData.total >= 5);
    assert.equal(auditData.logs[0].integrityHashSha256.length, 64);

    // 4. Verifica QR Code ISO/IEC 18004 real (<path d="M...), Base32 puro em todos os usuários, janela +-60s e remoção de PDV dos menus
    const rbacState = repo.getRbacState();
    for (const u of rbacState.users) {
      assert.ok(u.totpSecret && /^[A-Z2-7]{16,64}$/.test(u.totpSecret), `Segredo Base32 puro obrigatório para ${u.email}`);
    }
    const marceloSetup = repo.setupUserTotp("marcelo.mira@setatelecom.com.br");
    const decodedSvg = decodeURIComponent(marceloSetup.qrCodeSvgDataUrl!.replace(/^data:image\/svg\+xml;utf8,/, ""));
    assert.ok(decodedSvg.includes("<path d=\"M"), "SVG deve conter path ISO/IEC 18004 real gerado por QRCode.create");
    assert.ok(marceloSetup.totpSecretFormatted?.includes(" "), "Deve retornar segredo Base32 formatado em blocos de 4 caracteres");

    const sidebarSrc = fs.readFileSync(path.join(process.cwd(), "src/app/components/GestaoClickSidebar.tsx"), "utf8");
    assert.equal(sidebarSrc.includes("VENDAS_BALCAO"), false, "Item Balcão (PDV) deve estar removido da sidebar do ERP");
  });
  it('valida matematicamente CNPJ (14 dígitos Mod-11) e CPF (11 dígitos Mod-11), aplica máscara dinâmica PJ/PF e bloqueia CNPJ/CPF inválido na API (400)', async () => {
    // 1. Validação e autoformatação de CNPJ (PJ)
    assert.equal(formatDocumentByPersonType('14806925000132', 'Pessoa Jurídica'), '14.806.925/0001-32');
    const validCnpjCheck = validateDocumentByPersonType('01.936.069/0001-94', 'Pessoa Jurídica');
    assert.equal(validCnpjCheck.isValid, true);
    assert.equal(validCnpjCheck.docKind, 'CNPJ');
    assert.equal(validCnpjCheck.message, 'CNPJ válido');

    const badCnpjCheck = validateDocumentByPersonType('14.806.925/0001-99', 'Pessoa Jurídica');
    assert.equal(badCnpjCheck.isValid, false);
    assert.equal(badCnpjCheck.message, 'CNPJ inválido (dígitos verificadores incorretos)');

    const repeatedCnpjCheck = validateDocumentByPersonType('11.111.111/1111-11', 'Pessoa Jurídica');
    assert.equal(repeatedCnpjCheck.isValid, false);

    // 2. Validação e autoformatação de CPF (PF)
    assert.equal(formatDocumentByPersonType('52998224725', 'Pessoa Física'), '529.982.247-25');
    const validCpf = validateCpf('529.982.247-25');
    assert.equal(validCpf.isValid, true);
    assert.equal(validCpf.formatted, '529.982.247-25');

    const invalidCpf = validateDocumentByPersonType('529.982.247-99', 'Pessoa Física');
    assert.equal(invalidCpf.isValid, false);
    assert.equal(invalidCpf.docKind, 'CPF');
    assert.equal(invalidCpf.message, 'CPF inválido (dígitos verificadores incorretos)');

    const repeatedCpf = validateCpf('000.000.000-00');
    assert.equal(repeatedCpf.isValid, false);

    // 3. Bloqueio HTTP 400 na API ao tentar cadastrar empresa/cliente ou fornecedor com CNPJ inválido
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const badCompRes = await router.dispatch({
      method: 'POST',
      path: '/api/companies',
      body: {
        name: 'Empresa Teste CNPJ Inválido LTDA',
        cnpj: '14.806.925/0001-99',
      },
    });
    assert.equal(badCompRes.status, 400);

    const goodCompRes = await router.dispatch({
      method: 'POST',
      path: '/api/companies',
      body: {
        name: 'Empresa Teste CNPJ Válido LTDA',
        cnpj: '33000167000101',
      },
    });
    assert.equal(goodCompRes.status, 201);
    assert.equal((goodCompRes.body as { data: { cnpj: string } }).data.cnpj, '33.000.167/0001-01');

    const badLookupRes = await router.dispatch({
      method: 'GET',
      path: '/api/erp/cnpj/14.806.925/0001-99',
    });
    assert.equal(badLookupRes.status, 400);
  });

  it('substitui o botão textual "Editar / Abrir Cadastro" por ícone de Lupa (Consultar Cadastro) e ícone de Lápis (Editar Cadastro) sem botão deletar nas listagens', () => {
    const rootDir = process.cwd();
    const ccSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ContactsCompaniesTab.tsx'), 'utf8');
    const erpSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const modalSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/GestaoClickCompanyModal.tsx'), 'utf8');

    // Nenhum botão "Editar / Abrir Cadastro" residual
    assert.equal(ccSrc.includes('Editar / Abrir Cadastro'), false);
    assert.equal(erpSrc.includes('Editar / Abrir Cadastro'), false);

    // Presença dos botões de Lupa (Consultar Cadastro) e Lápis (Editar Cadastro)
    assert.ok(ccSrc.includes('aria-label="Consultar Cadastro"'));
    assert.ok(ccSrc.includes('aria-label="Editar Cadastro"'));
    assert.ok(erpSrc.includes('aria-label="Consultar Cadastro"'));
    assert.ok(erpSrc.includes('aria-label="Editar Cadastro"'));

    // Suporte a readOnly (modo Consulta) com botão Habilitar Edição no modal
    assert.ok(modalSrc.includes('isReadOnly'));
    assert.ok(modalSrc.includes('Habilitar Edição'));
  });

  it('garante que Adicionar Proposta / Novo Orçamento inicia com todos os campos de cliente, A/C, título, itens e valores em branco (sem dados pré-preenchidos)', () => {
    const rootDir = process.cwd();
    const erpSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const modalsSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpEditModals.tsx'), 'utf8');

    // Extrai o corpo de openFullNewProposalModal
    const fnStart = erpSrc.indexOf('const openFullNewProposalModal =');
    const fnSlice = erpSrc.slice(fnStart, fnStart + 2400);

    // Deve iniciar com campos de cliente, título, careOf e itens vazios
    assert.ok(fnSlice.includes("title: ''"), 'title deve iniciar vazio em openFullNewProposalModal');
    assert.ok(fnSlice.includes('companyId: null'), 'companyId deve iniciar null');
    assert.ok(fnSlice.includes("companyName: ''"), 'companyName deve iniciar vazio');
    assert.ok(fnSlice.includes("companyCnpj: ''"), 'companyCnpj deve iniciar vazio');
    assert.ok(fnSlice.includes("careOf: ''"), 'careOf (Aos cuidados de) deve iniciar vazio');
    assert.ok(fnSlice.includes('items: []'), 'items deve iniciar como array vazio []');
    assert.ok(fnSlice.includes('totalContractValue: 0'), 'totalContractValue deve iniciar zerado');

    // Ao adicionar linha em branco no ProposalEditModal sem selecionar SKU, não deve injetar item pré-preenchido
    assert.ok(modalsSrc.includes("sku: found?.gestaoClickCode || ''"));
    assert.ok(modalsSrc.includes("description: found?.name || ''"));
  });

  it('implementa busca autocomplete no campo Cliente * da proposta, alerta quando cliente não está cadastrado e botão verde "+ Adicionar novo" com vínculo imediato na própria tela da proposta', () => {
    const rootDir = process.cwd();
    const modalsSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpEditModals.tsx'), 'utf8');

    // 1. Campo Cliente * com placeholder "Digite para buscar" e cabeçalho fiel ao print GestãoClick
    assert.ok(modalsSrc.includes('placeholder="Digite para buscar"'));
    assert.ok(modalsSrc.includes('Nenhum cliente cadastrado encontrado para'));

    // 2. Botão verde "+ Adicionar novo" (#10b981) no rodapé do dropdown
    assert.ok(modalsSrc.includes('+ Adicionar novo'));
    assert.ok(modalsSrc.includes('bg-[#10b981]'));

    // 3. Modal inline de cadastro rápido na própria tela de proposta com consulta Receita Federal e "Salvar e Vincular à Proposta"
    assert.ok(modalsSrc.includes('showQuickClientModal'));
    assert.ok(modalsSrc.includes('handleSaveAndLinkQuickClient'));
    assert.ok(modalsSrc.includes('Salvar e Vincular à Proposta'));
    assert.ok(modalsSrc.includes('Preencha os <span className="text-[#1e3a6e]">campos extras</span> da sua empresa'));
  });
  it('permite selecionar e desmarcar livremente orçamentos, clientes e itens do catálogo (sem travar no primeiro item)', () => {
    const erpTabSrc = fs.readFileSync(
      path.join(__dirname, '../../src/app/components/ErpGestaoClickTab.tsx'),
      'utf8'
    );
    assert.ok(
      !erpTabSrc.includes('(selectedProposalId || filteredProposals[0]?.id)'),
      'Não deve forçar fallback para filteredProposals[0]?.id quando selectedProposalId for null'
    );
    assert.ok(
      !erpTabSrc.includes('(selectedCadastroId || companies[0]?.id)'),
      'Não deve forçar fallback para companies[0]?.id quando selectedCadastroId for null'
    );
    assert.ok(
      !erpTabSrc.includes('(selectedItemId || filteredCatalogItems[0]?.id)'),
      'Não deve forçar fallback para filteredCatalogItems[0]?.id quando selectedItemId for null'
    );
    assert.equal(
      erpTabSrc.includes("Editar Selecionado ("),
      false,
      "Botões de seleção (Editar Selecionado / Desmarcar) e coluna de checkbox devem estar removidos da tabela de Orçamentos"
    );

    // Verifica que o CNPJ canônico da Matriz Seta Telecom (14.806.925/0001-32) é aceito e CNPJs incorretos continuam rejeitados
    assert.equal(validateDocumentByPersonType('14.806.925/0001-32', 'Pessoa Jurídica').isValid, true);
    assert.equal(validateDocumentByPersonType('14.806.925/0001-99', 'Pessoa Jurídica').isValid, false);
  });

  it('garante isolamento estrito dos 3 Dashboards (CRM, ERP, Chamados), Data Health individual por sistema e Pesquisa Global estilo HubSpot (GlobalHeaderSearch)', () => {
    const rootDir = process.cwd();
    const crmDashSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/OverviewAiCopilotTab.tsx'), 'utf8');
    const crmSidebarSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/CrmSidebar.tsx'), 'utf8');
    const gcSidebarSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/GestaoClickSidebar.tsx'), 'utf8');
    const dhSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/DataHealthTab.tsx'), 'utf8');
    const sdSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ServiceDeskTab.tsx'), 'utf8');
    const globalSearchSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/GlobalHeaderSearch.tsx'), 'utf8');

    // 1. Dashboard do CRM não contém informações do ERP (zero saldo bancário, fluxo de caixa ERP, contratos de locação ou orçamentos)
    assert.equal(crmDashSrc.includes('Saldo Disponível Hoje'), false);
    assert.equal(crmDashSrc.includes('Saldo das contas bancárias'), false);
    assert.equal(crmDashSrc.includes('Acompanhe o <span className="text-[#1e3a6e]">fluxo de caixa</span>'), false);
    assert.equal(crmDashSrc.includes('344 Contratos'), false);
    assert.equal(crmDashSrc.includes('2.077 Orçamentos'), false);
    assert.ok(crmDashSrc.includes('Pipeline Total em Aberto (CRM)'));
    assert.ok(crmDashSrc.includes('Forecast Ponderado (Sales Hub)'));
    assert.ok(crmDashSrc.includes('+ Novo Negócio (Deal)'));

    // 2. Sidebar do CRM não contém "Auditoria Base ERP" e Sidebar do ERP contém "Data Health (ERP)"
    assert.equal(crmSidebarSrc.includes('Auditoria Base ERP'), false);
    assert.ok(crmSidebarSrc.includes('Auditoria Base CRM'));
    assert.ok(gcSidebarSrc.includes('Data Health (ERP)'));

    // 3. DataHealthTab suporta systemScope individual ('crm' | 'erp' | 'chamados') e ServiceDeskTab tem Dashboard Chamados e Data Health (Chamados)
    assert.ok(dhSrc.includes("resolvedScope === 'CHAMADOS'"));
    assert.ok(dhSrc.includes("resolvedScope === 'ERP'"));
    assert.ok(sdSrc.includes('Visão Geral (Dashboard Chamados)'));
    assert.ok(sdSrc.includes('Data Health (Chamados)'));

    // 4. GlobalHeaderSearch estilo HubSpot com seletor de sistema (Todos | CRM | ERP | Chamados), pílulas de categoria, Limpar filtros e Resultados selecionados recentemente
    assert.ok(globalSearchSrc.includes('Todos os Sistemas'));
    assert.ok(globalSearchSrc.includes('Orçamentos / Propostas'));
    assert.ok(globalSearchSrc.includes('Produtos / Itens'));
    assert.ok(globalSearchSrc.includes('Notas Fiscais'));
    assert.ok(globalSearchSrc.includes('Limpar filtros'));
    assert.ok(globalSearchSrc.includes('Resultados selecionados recentemente'));
  });

  it('elimina o termo "Virar Contrato" em favor de "Gerar Contrato", limpa a listagem de Contratos deixando apenas Lupa e Lápis, e organiza todas as ações em 6 abas separadas dentro do Contrato (incluindo Renovar Vigência com prazo personalizado fora do padrão e revisão completa)', () => {
    const rootDir = process.cwd();
    const erpSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const modalsSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpEditModals.tsx'), 'utf8');

    // 1. Proibido "Virar Contrato"; obrigatório "Gerar Contrato"
    assert.equal(/virar contrato/i.test(erpSrc), false);
    assert.equal(/virar contrato/i.test(modalsSrc), false);
    assert.ok(erpSrc.includes('Gerar Contrato'));
    assert.ok(modalsSrc.includes('Gerar Contrato'));

    // 2. 6 abas separadas dentro de ContractEditModal
    for (const tabId of [
      'DADOS_GERAIS',
      'RENOVAR_VIGENCIA',
      'FATURAMENTO_RECIBOS',
      'REAJUSTE_ADITIVOS',
      'EQUIPAMENTOS_PATRIMONIO',
      'DOCUMENTO_HISTORICO',
    ]) {
      assert.ok(modalsSrc.includes(`'${tabId}'`), `ContractEditModal deve possuir a aba ${tabId}`);
    }

    // 3. Aba Renovar Vigência oferece prazos padrão (12, 24, 36, 48, 60) + Prazo Personalizado (Fora do Padrão) e revisão/confirmação de todas as informações do contrato
    assert.ok(modalsSrc.includes('Prazo Personalizado (Fora do Padrão)'));
    assert.ok(modalsSrc.includes('Configurar Tempo Fora do Padrão do Mercado'));
    assert.ok(modalsSrc.includes('Confirmar Renovação de Vigência e Salvar Alterações'));
  });

  it('valida o motor de filtros da Pesquisa Global (GlobalHeaderSearch) em todas as 9 pílulas de categoria e nos 4 seletores de sistema (Todos, CRM, ERP, Chamados), com e sem texto digitado', () => {
    const repo = createInMemoryRepository();
    const erp = repo.getErpOverview();
    const contacts = repo.listContacts();
    const companies = repo.listCompanies();
    const deals = repo.listDeals();
    const tickets = repo.listServiceTickets();

    const entries: SearchResultEntry[] = [
      ...companies.map((c) => ({
        id: `COMPANIES:${c.id}`,
        entityId: c.id,
        category: 'COMPANIES' as SearchCategoryKey,
        system: 'CRM' as const,
        title: c.name,
        subtitle: `Empresa • CRM & ERP • ${c.cnpj || ''}`,
      })),
      ...contacts.map((c) => ({
        id: `CONTACTS:${c.id}`,
        entityId: c.id,
        category: 'CONTACTS' as SearchCategoryKey,
        system: 'CRM' as const,
        title: `${c.firstName} ${c.lastName}`,
        subtitle: `Contato • CRM • ${c.email || ''}`,
      })),
      ...deals.map((d) => ({
        id: `DEALS:${d.id}`,
        entityId: d.id,
        category: 'DEALS' as SearchCategoryKey,
        system: 'CRM' as const,
        title: d.title,
        subtitle: `Negócio • CRM • ${d.ownerName || ''}`,
      })),
      ...erp.proposals.map((p) => ({
        id: `PROPOSALS:${p.id}`,
        entityId: p.id,
        category: 'PROPOSALS' as SearchCategoryKey,
        system: 'ERP' as const,
        title: `${p.code} - ${p.companyName}`,
        subtitle: `Orçamento • ERP • ${p.title}`,
      })),
      ...erp.catalog.map((it) => ({
        id: `PRODUCTS:${it.id}`,
        entityId: it.id,
        category: 'PRODUCTS' as SearchCategoryKey,
        system: 'ERP' as const,
        title: `${it.gestaoClickCode} - ${it.name}`,
        subtitle: `Produto/Item • ERP • ${it.ncmOrLc116}`,
      })),
      ...erp.rentalContracts.map((ctr) => ({
        id: `CONTRACTS:${ctr.id}`,
        entityId: ctr.id,
        category: 'CONTRACTS' as SearchCategoryKey,
        system: 'ERP' as const,
        title: `${ctr.contractNumber} - ${ctr.companyName}`,
        subtitle: `Contrato • ERP • ${ctr.title}`,
      })),
      ...erp.invoices.map((inv) => ({
        id: `INVOICES:${inv.id}`,
        entityId: inv.id,
        category: 'INVOICES' as SearchCategoryKey,
        system: 'ERP' as const,
        title: `${inv.documentNumber} - ${inv.companyName}`,
        subtitle: `Nota Fiscal • ERP • ${inv.documentType}`,
      })),
      ...(erp.serviceOrders || []).map((os) => ({
        id: `SERVICE_ORDERS:${os.id}`,
        entityId: os.id,
        category: 'SERVICE_ORDERS' as SearchCategoryKey,
        system: 'ERP' as const,
        title: `O.S. #${os.code} - ${os.companyName}`,
        subtitle: `Ordem de Serviço • ERP • ${os.status}`,
      })),
      ...tickets.map((tk) => ({
        id: `TICKETS:${tk.id}`,
        entityId: tk.id,
        category: 'TICKETS' as SearchCategoryKey,
        system: 'CHAMADOS' as const,
        title: `${tk.key} - ${tk.subject}`,
        subtitle: `Chamado • CHAMADOS • ${tk.assignee}`,
      })),
    ];

    // 1. Testar cada uma das 9 pílulas de categoria isoladamente (sem texto digitado)
    for (const pill of SEARCH_CATEGORY_PILLS) {
      const res = filterGlobalSearchEntries({
        allEntries: entries,
        query: '',
        systemFilter: 'ALL',
        selectedCategories: [pill.key],
      });
      assert.ok(res.length > 0, `A pílula ${pill.label} (${pill.key}) deve retornar registros reais`);
      assert.ok(
        res.every((r) => r.category === pill.key),
        `Todos os resultados da pílula ${pill.key} devem pertencer exclusivamente à categoria ${pill.key}`
      );
    }

    // 2. Mesmo que systemFilter esteja em 'CRM', se o usuário clicar na pílula 'PROPOSALS' ou 'INVOICES' (que são do ERP), deve retornar os Orçamentos/Notas Fiscais sem bloquear!
    const crossSysRes = filterGlobalSearchEntries({
      allEntries: entries,
      query: '',
      systemFilter: 'CRM',
      selectedCategories: ['PROPOSALS', 'INVOICES'],
    });
    assert.ok(crossSysRes.length > 0);
    assert.ok(crossSysRes.some((r) => r.category === 'PROPOSALS'));
    assert.ok(crossSysRes.some((r) => r.category === 'INVOICES'));

    // 3. Testar filtro por sistema ('CRM', 'ERP', 'CHAMADOS') quando nenhuma pílula está travada
    const onlyErp = filterGlobalSearchEntries({
      allEntries: entries,
      query: '',
      systemFilter: 'ERP',
      selectedCategories: [],
    });
    assert.ok(onlyErp.some((r) => r.category === 'PROPOSALS'));
    assert.ok(onlyErp.some((r) => r.category === 'COMPANIES'));
    assert.equal(onlyErp.some((r) => r.category === 'DEALS'), false);

    const onlyChamados = filterGlobalSearchEntries({
      allEntries: entries,
      query: '',
      systemFilter: 'CHAMADOS',
      selectedCategories: [],
    });
    assert.ok(onlyChamados.length > 0);
    assert.ok(onlyChamados.every((r) => r.system === 'CHAMADOS'));

    // 4. Testar busca textual por Orçamento #4695 (Mundivox) e por CNPJ sem pontuação
    const mundivoxSearch = filterGlobalSearchEntries({
      allEntries: entries,
      query: '4695',
      systemFilter: 'ALL',
      selectedCategories: [],
    });
    assert.ok(mundivoxSearch.some((r) => r.title.includes('4695')));
  });

  it('aplica simultaneamente systemFilter e selectedCategories na Pesquisa Global, filtra Fornecedores vs Empresas CRM, e garante todos os filtros internos de Empresas CRM, Vendas, Fiscal e O.S.', () => {
    const rootDir = process.cwd();
    const ccSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ContactsCompaniesTab.tsx'), 'utf8');
    const erpSrc = fs.readFileSync(path.join(rootDir, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const pageSrc = fs.readFileSync(path.join(rootDir, 'src/app/page.tsx'), 'utf8');

    // 1. Teste de combinação simultânea: systemFilter = 'CRM' + selectedCategories = ['COMPANIES'] deve excluir fornecedores (COMPANIES:sup-*)
    const entries: SearchResultEntry[] = [
      {
        id: 'COMPANIES:comp-1',
        entityId: 'comp-1',
        category: 'COMPANIES',
        system: 'CRM',
        title: 'MUNDIVOX COMUNICACOES LTDA',
        subtitle: 'Empresa • CRM & ERP',
      },
      {
        id: 'COMPANIES:sup-1',
        entityId: 'sup-1',
        category: 'COMPANIES',
        system: 'ERP',
        title: 'AGIS EQUIPAMENTOS',
        subtitle: 'Fornecedor • ERP',
      },
    ];

    const crmCompaniesOnly = filterGlobalSearchEntries({
      allEntries: entries,
      query: '',
      systemFilter: 'CRM',
      selectedCategories: ['COMPANIES'],
    });
    assert.equal(crmCompaniesOnly.length, 1);
    assert.equal(crmCompaniesOnly[0].id, 'COMPANIES:comp-1');

    const erpCompaniesAndSuppliers = filterGlobalSearchEntries({
      allEntries: entries,
      query: '',
      systemFilter: 'ERP',
      selectedCategories: ['COMPANIES'],
    });
    assert.equal(erpCompaniesAndSuppliers.length, 2);

    // 2. Nenhum fallback "(filteredSales.length > 0 ? filteredSales : salesOrders)" em ErpGestaoClickTab
    assert.equal(erpSrc.includes('filteredSales.length > 0 ? filteredSales : salesOrders'), false);

    // 3. Presença dos novos filtros em ContactsCompaniesTab (Empresas CRM) e ErpGestaoClickTab (Fiscal e O.S.)
    assert.ok(ccSrc.includes('companyTierFilter'));
    assert.ok(ccSrc.includes('companySectorFilter'));
    assert.ok(ccSrc.includes('companyStateFilter'));
    assert.ok(erpSrc.includes('invoicesSearchQuery'));
    assert.ok(erpSrc.includes('invoicesStatusFilter'));
    assert.ok(erpSrc.includes('osStatusFilter'));

    // 4. Deep-link navigation triggers no page.tsx ao clicar em resultado da busca global
    assert.ok(pageSrc.includes('erpNavigationTrigger'));
    assert.ok(pageSrc.includes('erpTargetEntity'));
    assert.ok(pageSrc.includes('initialCompanyIdForModal'));
    assert.ok(pageSrc.includes('initialDealIdForDrawer'));
    assert.ok(pageSrc.includes('initialTicketIdForDrawer'));
    assert.ok(pageSrc.includes('onNavigateToCategory'));
  });

  it('garante que cada sub-aba e cada opção de filtro em Orçamentos, Contratos, Clientes, Catálogo, Vendas, O.S., Fiscal e Data Health filtra contra dados reais do seed e diferencia categorias sem travar em CTR_LOCACOES', () => {
    const repo = createInMemoryRepository();
    const erp = repo.getErpOverview();
    const companies = repo.listCompanies();

    const hasProductItem = (p: any) => {
      if (p.budgetType === 'SERVICOS') return false;
      if (p.budgetType === 'PRODUTOS' || p.budgetType === 'LOCACAO' || p.budgetType === 'CONJUNTO') return true;
      return p.items.some((i: any) => i.itemType === 'PRODUCT' || i.fiscalNature === 'LOCACAO_BENS_MOVEIS' || i.fiscalNature === 'VENDA_EQUIPAMENTO');
    };
    const hasServiceItem = (p: any) => {
      if (p.budgetType === 'PRODUTOS' || p.budgetType === 'LOCACAO') return false;
      if (p.budgetType === 'SERVICOS' || p.budgetType === 'CONJUNTO') return true;
      return p.items.some((i: any) => i.itemType === 'SERVICE' || i.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' || i.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA');
    };

    const orcProdutos = erp.proposals.filter(hasProductItem);
    const orcServicos = erp.proposals.filter(hasServiceItem);
    assert.ok(orcProdutos.length > 0 && orcProdutos.length < erp.proposals.length, 'ORC_PRODUTOS deve filtrar um subconjunto real de propostas');
    assert.ok(orcServicos.length > 0 && orcServicos.length < erp.proposals.length, 'ORC_SERVICOS deve filtrar um subconjunto real de propostas');

    for (const st of ['RASCUNHO', 'ENVIADA', 'EM_NEGOCIACAO', 'APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA']) {
      assert.ok(erp.proposals.some((p) => p.status === st), `Seed de propostas deve ter pelo menos 1 registro para o filtro de situação ${st}`);
    }

    for (const mod of ['LOCACAO', 'SERVICO', 'ASSINATURA', 'HIBRIDO']) {
      assert.ok(erp.rentalContracts.some((c) => c.modality === mod), `Seed de contratos deve ter modalidade ${mod}`);
    }
    for (const st of ['ATIVO', 'EM_IMPLANTACAO', 'RENOVACAO_PROXIMA', 'ENCERRADO']) {
      assert.ok(erp.rentalContracts.some((c) => c.status === st), `Seed de contratos deve ter status ${st}`);
    }

    assert.ok(companies.some((c) => String((c.customProperties || {}).status || '').toLowerCase().includes('inativ')));

    assert.ok(erp.salesOrders.some((v) => v.saleType === 'PRODUTO'));
    assert.ok(erp.salesOrders.some((v) => v.saleType === 'SERVICO'));
    assert.ok(erp.salesOrders.some((v) => v.saleType === 'DEVOLUCAO'));

    const ghsSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/components/GlobalHeaderSearch.tsx'), 'utf8');
    assert.ok(ghsSrc.includes('multiSelectMode'));
    assert.ok(ghsSrc.includes('Abrir aba de'));
  });
  it('versiona propostas comerciais automaticamente a cada alteração (SLA, Tempo de Contrato, Forma de Pagamento, Valores e Produtos/Serviços) e permite restaurar versões anteriores', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Cria proposta comercial inicial -> deve nascer na v1.0 com snapshot inicial
    const createRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      body: {
        title: 'Proposta Locação PABX IP & Gateway SIP — Cliente Teste',
        companyName: 'DIGISYSTEM SERVICOS ESPECIALIZADOS LTDA',
        companyCnpj: '01.936.069/0001-94',
        contractMonths: 12,
        paymentCondition: 'Boleto 15 DDL',
        technicalClauses: 'SLA 8h úteis com substituição NBD.',
        items: [
          {
            id: 'it-v1-1',
            sku: 'GC-EQ-00101',
            description: 'Central PABX IP Seta Cloud Appliance HA',
            itemType: 'PRODUCT',
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
            ncmOrServiceCode: 'NCM 8517.62.14',
            quantity: 1,
            unitPrice: 2000,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 2000,
          },
        ],
      },
    });
    assert.equal(createRes.status, 201);
    type VersionedPropTestPayload = {
      data: {
        id: string;
        version: number;
        contractMonths: number;
        monthlyRecurringTotal: number;
        totalContractValue: number;
        versionHistory: Array<{
          version: number;
          versionLabel: string;
          changedFields: string[];
          snapshot: { contractMonths: number; monthlyRecurringTotal: number; paymentCondition: string; technicalClauses: string };
        }>;
      };
    };
    const createdProp = (createRes.body as VersionedPropTestPayload).data;

    assert.equal(createdProp.version, 1);
    assert.equal(createdProp.versionHistory.length, 1);
    assert.equal(createdProp.versionHistory[0].versionLabel, 'v1.0');
    assert.equal(createdProp.versionHistory[0].snapshot.contractMonths, 12);
    assert.equal(createdProp.versionHistory[0].snapshot.monthlyRecurringTotal, 2000);

    // 2. Edita SLA, Tempo de Contrato (12m -> 24m), Forma de Pagamento, Produtos e Valores -> deve gerar v2.0 preservando v1.0
    const updateRes = await router.dispatch({
      method: 'PATCH',
      path: `/api/erp/proposals/${encodeURIComponent(createdProp.id)}`,
      body: {
        contractMonths: 24,
        paymentCondition: 'PIX Corporativo — Vencimento dia 10',
        technicalClauses: 'SLA 99,95% Crítico 24x7 com atendimento em até 2h e Advance Replacement.',
        items: [
          {
            id: 'it-v1-1',
            sku: 'GC-EQ-00101',
            description: 'Central PABX IP Seta Cloud Appliance HA',
            itemType: 'PRODUCT',
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
            ncmOrServiceCode: 'NCM 8517.62.14',
            quantity: 2,
            unitPrice: 2000,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 4000,
          },
          {
            id: 'it-v2-2',
            sku: 'GC-SV-00201',
            description: 'Suporte Técnico NOC 24x7',
            itemType: 'SERVICE',
            fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
            ncmOrServiceCode: 'LC 116 01.07',
            quantity: 1,
            unitPrice: 1200,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 1200,
          },
        ],
      },
    });
    assert.equal(updateRes.status, 200);
    const updatedProp = (updateRes.body as VersionedPropTestPayload).data;

    assert.equal(updatedProp.version, 2);
    assert.equal(updatedProp.versionHistory.length, 2);
    const v1Entry = updatedProp.versionHistory.find((v) => v.version === 1)!;
    const v2Entry = updatedProp.versionHistory.find((v) => v.version === 2)!;
    assert.equal(v1Entry.snapshot.contractMonths, 12, 'Snapshot da v1 deve permanecer intacto (12 meses)');
    assert.equal(v1Entry.snapshot.monthlyRecurringTotal, 2000, 'Snapshot da v1 deve permanecer intacto (R$ 2.000/mês)');
    assert.equal(v2Entry.versionLabel, 'v2.0');
    assert.equal(v2Entry.snapshot.contractMonths, 24);
    assert.equal(v2Entry.snapshot.monthlyRecurringTotal, 5200);
    assert.ok(v2Entry.changedFields.some((f) => f.includes('SLA / Cláusulas Técnicas')));
    assert.ok(v2Entry.changedFields.some((f) => f.includes('Tempo de Contrato')));
    assert.ok(v2Entry.changedFields.some((f) => f.includes('Forma de Pagamento')));
    assert.ok(v2Entry.changedFields.some((f) => f.includes('Produtos / Serviços')));
    assert.ok(v2Entry.changedFields.some((f) => f.includes('Valores')));

    // 3. Restaura a versão 1 via POST /api/erp/proposals/:id/restore-version -> deve gerar v3.0 com os dados da v1.0
    const restoreRes = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${encodeURIComponent(createdProp.id)}/restore-version`,
      body: {
        targetVersion: 1,
        restoredBy: 'Marcelo Lopes Mira',
      },
    });
    assert.equal(restoreRes.status, 200);
    const restoredProp = (restoreRes.body as VersionedPropTestPayload).data;
    assert.equal(restoredProp.version, 3);
    assert.equal(restoredProp.versionHistory.length, 3);
    assert.equal(restoredProp.contractMonths, 12);
    assert.equal(restoredProp.monthlyRecurringTotal, 2000);
  });
  it('endurece isPublicStiHubPath, evaluateStiHubRouteProtection e resolveStiHubSigningSecret (bloqueia GET /api/erp/proposals raiz e /api/erp/daily-sync sem login, preserva /api/erp/proposals/:id e /approve, e elimina segredo estático previsível)', () => {
    // 1. Listagem raiz de propostas (/api/erp/proposals) NÃO é pública
    assert.equal(isPublicStiHubPath('/api/erp/proposals', 'GET'), false);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/', 'GET'), false);
    assert.equal(isPublicStiHubPath('/api/erp/proposals', 'POST'), false);

    // 2. Rotas individuais de proposta específica (/api/erp/proposals/:id e /approve) permanecem públicas para o cliente externo
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-123', 'GET'), true);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-123/approve', 'POST'), true);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-123', 'DELETE'), false);
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-123/versions', 'GET'), false);

    // 3. Sincronização diária (/api/erp/daily-sync) NÃO é pública
    assert.equal(isPublicStiHubPath('/api/erp/daily-sync', 'POST'), false);
    assert.equal(isPublicStiHubPath('/api/erp/daily-sync', 'GET'), false);
    assert.equal(classifyRouteRequiredModule('/api/erp/daily-sync'), 'ERP');
    assert.equal(classifyRouteRequiredModule('/api/erp/proposals'), 'ERP');

    // 4. evaluateStiHubRouteProtection bloqueia /api/erp/proposals e /api/erp/daily-sync sem sessão MFA válida (401)
    const blockedProposalsList = evaluateStiHubRouteProtection({
      pathname: '/api/erp/proposals',
      method: 'GET',
      sessionToken: null,
      enforceStrictLock: true,
    });
    assert.equal(blockedProposalsList.allowed, false);
    assert.equal(blockedProposalsList.isPublicRoute, false);
    assert.equal(blockedProposalsList.statusCode, 401);

    const blockedDailySync = evaluateStiHubRouteProtection({
      pathname: '/api/erp/daily-sync',
      method: 'POST',
      sessionToken: null,
      enforceStrictLock: true,
    });
    assert.equal(blockedDailySync.allowed, false);
    assert.equal(blockedDailySync.isPublicRoute, false);
    assert.equal(blockedDailySync.statusCode, 401);

    const allowedSingleProposal = evaluateStiHubRouteProtection({
      pathname: '/api/erp/proposals/prop-123',
      method: 'GET',
      sessionToken: null,
      enforceStrictLock: true,
    });
    assert.equal(allowedSingleProposal.allowed, true);
    assert.equal(allowedSingleProposal.isPublicRoute, true);
    assert.equal(allowedSingleProposal.statusCode, 200);

    // 5. Segredo de assinatura HMAC-SHA256 não contém string estática previsível no código-fonte e respeita STI_HUB_SESSION_SECRET
    const authSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/lib/auth.ts'), 'utf8');
    assert.equal(
      authSrc.includes('stihub-seta-telecom-14806925000132-hmac-sha256-secret-key-2026'),
      false,
      'Segredo estático previsível deve ter sido eliminado de src/app/lib/auth.ts'
    );
    const derivedSecret = resolveStiHubSigningSecret();
    assert.ok(derivedSecret.length >= 32);

    const prevEnvSecret = process.env.STI_HUB_SESSION_SECRET;
    try {
      process.env.STI_HUB_SESSION_SECRET = 'custom-env-secret-for-test-minimum-32-chars-2026';
      assert.equal(resolveStiHubSigningSecret(), 'custom-env-secret-for-test-minimum-32-chars-2026');
      const token = signStiHubSessionToken({
        uid: 'usr-seta-01',
        email: 'marcelo.mira@setatelecom.com.br',
        name: 'Marcelo Lopes Mira',
        roleId: 'SUPER_ADMIN',
        scope: 'TODOS',
        enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
        moduleAccess: { crm: true, erp: true, chamados: true },
        mfaVerified: true,
        mfaMethod: 'TOTP_AUTHENTICATOR',
        iat: Date.now(),
        exp: Date.now() + 60000,
      });
      const verifiedOk = verifyStiHubSessionToken(token);
      assert.equal(verifiedOk.valid, true);
      const verifiedWrongSecret = verifyStiHubSessionToken(token, 'wrong-secret-key-0000000000000000');
      assert.equal(verifiedWrongSecret.valid, false);
      assert.equal(verifiedWrongSecret.reason, 'INVALID_HMAC_SIGNATURE');
    } finally {
      if (prevEnvSecret === undefined) {
        delete process.env.STI_HUB_SESSION_SECRET;
      } else {
        process.env.STI_HUB_SESSION_SECRET = prevEnvSecret;
      }
    }
  });
  it('separa 100% os Tipos de Conta e Permissões do CRM (CRM_ROLES_CATALOG / CRM_MODULE_ITEMS_CATALOG) e do ERP (ERP_ROLES_CATALOG / ERP_MODULE_ITEMS_CATALOG), inclui Gerência de Estoque (ERP_STOCK_MANAGER / STOCK_MANAGER) com Visualizar/Editar/Deletar por item e cria usuário com 2FA Google Authenticator', async () => {
    // 1. Verifica que os Tipos de Conta do CRM são distintos dos Tipos de Conta do ERP
    const crmRoleKeys = Object.keys(CRM_ROLES_CATALOG);
    const erpRoleKeys = Object.keys(ERP_ROLES_CATALOG);
    for (const k of [
      'CRM_ADMIN',
      'CRM_SALES_MANAGER',
      'CRM_SALES_REP',
      'CRM_SDR_PRE_SALES',
      'CRM_MARKETING',
      'CRM_SERVICE_NOC',
      'CRM_NONE',
    ]) {
      assert.ok(crmRoleKeys.includes(k), `CRM_ROLES_CATALOG deve conter ${k}`);
    }
    for (const k of [
      'ERP_ADMIN',
      'ERP_COMMERCIAL',
      'ERP_FINANCE',
      'ERP_STOCK_MANAGER',
      'ERP_CONTRACTS_OS',
      'ERP_PDV_BALCAO',
      'ERP_NONE',
    ]) {
      assert.ok(erpRoleKeys.includes(k), `ERP_ROLES_CATALOG deve conter ${k}`);
    }
    assert.ok(RBAC_ROLES_CATALOG.STOCK_MANAGER, 'RBAC_ROLES_CATALOG deve conter STOCK_MANAGER');

    // 2. Verifica separação dos catálogos de itens (CRM vs ERP) e presença de view/edit/delete em cada item
    assert.ok(CRM_MODULE_ITEMS_CATALOG.length >= 14);
    assert.ok(ERP_MODULE_ITEMS_CATALOG.length >= 19);
    assert.equal(
      MODULE_ITEMS_CRUD_CATALOG.length,
      CRM_MODULE_ITEMS_CATALOG.length + ERP_MODULE_ITEMS_CATALOG.length
    );
    assert.ok(CRM_MODULE_ITEMS_CATALOG.every((i) => i.system === 'CRM'));
    assert.ok(ERP_MODULE_ITEMS_CATALOG.every((i) => i.system === 'ERP'));

    // Gerência de Estoque (ERP_STOCK_MANAGER) deve ter view/edit/delete = true nos itens de Estoque/Compras/Produtos/O.S.
    const stockPerms = ERP_ROLES_CATALOG.ERP_STOCK_MANAGER.itemPermissions;
    assert.deepEqual(stockPerms['erp.estoque_movimentacoes'], {
      view: true,
      edit: true,
      delete: true,
    });
    assert.deepEqual(stockPerms['erp.estoque_cotacoes_compras'], {
      view: true,
      edit: true,
      delete: true,
    });
    assert.deepEqual(stockPerms['erp.itens_produtos'], {
      view: true,
      edit: true,
      delete: true,
    });
    assert.deepEqual(stockPerms['erp.ordens_servico'], {
      view: true,
      edit: true,
      delete: true,
    });
    assert.deepEqual(stockPerms['erp.configuracoes_empresa'], {
      view: false,
      edit: false,
      delete: false,
    });

    // Administrador CRM e Administrador ERP possuem view/edit/delete = true em todos os seus respectivos itens
    const crmAdminPerms = buildDefaultCrmItemPermissions('CRM_ADMIN');
    for (const item of CRM_MODULE_ITEMS_CATALOG) {
      assert.deepEqual(crmAdminPerms[item.itemId], { view: true, edit: true, delete: true });
    }
    const erpAdminPerms = buildDefaultErpItemPermissions('ERP_ADMIN');
    for (const item of ERP_MODULE_ITEMS_CATALOG) {
      assert.deepEqual(erpAdminPerms[item.itemId], { view: true, edit: true, delete: true });
    }

    // 3. Cria novo usuário via POST /api/rbac/users com crmRole, erpRole, permissões CRUD customizadas e 2FA Google Authenticator
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const createUserRes = await router.dispatch({
      method: 'POST',
      path: '/api/rbac/users',
      body: {
        name: 'Leandro Almeida (Gerente de Estoque)',
        email: 'leandro.estoque@setatelecom.com.br',
        department: 'Gerência de Estoque & Compras',
        jobTitle: 'Gerente de Estoque & Suprimentos',
        role: 'STOCK_MANAGER',
        crmRole: 'CRM_NONE',
        erpRole: 'ERP_STOCK_MANAGER',
        mfaEnabled: true,
        mfaMethod: 'TOTP_AUTHENTICATOR',
        erpItemPermissions: {
          ...buildDefaultErpItemPermissions('ERP_STOCK_MANAGER'),
          'erp.financeiro_bancos_dre': { view: false, edit: false, delete: false },
        },
      },
    });
    assert.equal(createUserRes.status, 201);
    const createdUser = (createUserRes.body as {
      data: {
        id: string;
        email: string;
        role: string;
        crmRole: string;
        erpRole: string;
        totpSecret: string;
        otpauthUri: string;
        qrCodeSvgDataUrl: string;
        currentTotpCode: string;
        crmItemPermissions: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
        erpItemPermissions: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
      };
    }).data;

    assert.equal(createdUser.email, 'leandro.estoque@setatelecom.com.br');
    assert.equal(createdUser.crmRole, 'CRM_NONE');
    assert.equal(createdUser.erpRole, 'ERP_STOCK_MANAGER');
    assert.ok(createdUser.totpSecret.length >= 16);
    assert.ok(createdUser.otpauthUri.startsWith('otpauth://totp/'));
    assert.ok(createdUser.qrCodeSvgDataUrl.startsWith('data:image/svg+xml'));
    assert.equal(createdUser.currentTotpCode, generateTotpCodeSync(createdUser.totpSecret));
    assert.deepEqual(createdUser.erpItemPermissions['erp.estoque_movimentacoes'], {
      view: true,
      edit: true,
      delete: true,
    });
    assert.deepEqual(createdUser.crmItemPermissions['crm.deals_kanban'], {
      view: false,
      edit: false,
      delete: false,
    });
  });

  it("valida os 7 ajustes de Propostas Comerciais: sem coluna Enquadramento Fiscal, versionamento exclusivo para consulta interna, quantidade como itens (não mês), Tempo de Contrato no cabeçalho, Setup isolado do Frete, seletor de SLA na criação e Seletor de Templates funcional", async () => {
    const rootDir = process.cwd();
    const pageSrc = fs.readFileSync(path.join(rootDir, "src/app/proposta/[id]/page.tsx"), "utf8");
    const modalsSrc = fs.readFileSync(path.join(rootDir, "src/app/components/ErpEditModals.tsx"), "utf8");
    const shareMod = await import("../src/app/lib/proposal-share");

    // 1. Sem coluna Tipo & Enquadramento Fiscal na tabela da proposta A4
    assert.equal(pageSrc.includes("<th className=\"py-2.5 px-3\">Tipo &amp; Enquadramento Fiscal</th>"), false);

    // 2. Versionamento removido do documento A4 e mantido como opção de consulta futura interna (showInternalVersionsModal)
    assert.equal(pageSrc.includes("CONTROLE DE VERSIONAMENTO E REVISÕES DA PROPOSTA"), false);
    assert.ok(pageSrc.includes("showInternalVersionsModal"));
    assert.ok(pageSrc.includes("Consultas Internas / Versões"));

    // 3. Quantidade representa quantidade de itens (UN / SV) e nunca MÊS
    assert.equal(shareMod.normalizeProposalItemUnit("MÊS", "PRODUCT"), "UN");
    assert.equal(shareMod.normalizeProposalItemUnit("MESES", "PRODUCT"), "UN");
    assert.equal(shareMod.normalizeProposalItemUnit(undefined, "PRODUCT"), "UN");

    // 4. Tempo de Contrato aparece no cabeçalho da proposta
    assert.ok(pageSrc.includes("Tempo de Contrato: {contractDurationMonths}"));

    // 5. Setup isolado e nunca somado ao frete
    const repo = createInMemoryRepository();
    const created = repo.createProposal({
      title: "Proposta Teste Setup Isolado do Frete",
      companyName: "Cliente Teste Setup",
      contractMonths: 24,
      setupFee: 1500,
      shippingCost: 350,
      items: [
        {
          id: "it-setup-1",
          sku: "GC-EQ-00101",
          description: "Central PABX IP",
          fiscalNature: "LOCACAO_BENS_MOVEIS",
          ncmOrServiceCode: "NCM 8517.62.14",
          quantity: 3,
          unitPrice: 1000,
          discountPercent: 0,
          isRecurring: true,
          totalMonthly: 3000,
        },
      ],
    });
    assert.equal(created.items[0].unit, "UN", "Unidade deve ser UN (itens) e não MÊS");
    assert.equal(created.items[0].quantity, 3);
    assert.equal(created.monthlyRecurringTotal, 3000);
    assert.equal(created.oneTimeSetupTotal, 1500, "Setup deve permanecer R$ 1.500 isolado do frete");
    assert.equal(created.shippingCost, 350, "Frete deve permanecer R$ 350 isolado do setup");
    assert.equal(created.totalContractValue, 3000 * 24 + 1500 + 350);

    // 6. SLA é um campo selecionável durante a criação/edição da proposta
    assert.ok(modalsSrc.includes("SLA Contratado (Acordo de Nível de Serviço)"));
    assert.ok(Array.isArray(shareMod.PROPOSAL_SLA_OPTIONS) && shareMod.PROPOSAL_SLA_OPTIONS.length >= 4);

    // 7. Seletor de templates persiste no link compartilhado (?d=), no estado/API e altera o layout
    const withTemplate = shareMod.computeProposalTotals({
      ...created,
      templateStyle: "LOCACAO_DETALHADA_SLA",
      slaTier: "NOC_24X7_CRITICO_2H",
    });
    const encoded = shareMod.encodeProposalToQueryParam(withTemplate);
    const decoded = shareMod.decodeProposalFromQueryParam(encoded);
    assert.ok(decoded);
    assert.equal(decoded.templateStyle, "LOCACAO_DETALHADA_SLA");
    assert.equal(decoded.slaTier, "NOC_24X7_CRITICO_2H");
    assert.equal(decoded.oneTimeSetupTotal, 1500);
    assert.equal(decoded.shippingCost, 350);
    assert.ok(pageSrc.includes("handleTemplateStyleChange"));
  });

  it("completa o fluxo ponta a ponta de 2FA Google Authenticator (login -> refresh/setup-totp -> verify-mfa -> middleware em isolate separado sem loop para /login) e mantém o campo de 6 dígitos sempre limpo na UI", async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    // Contencao 29/10/2026: sem senha-mestra; o usuario precisa de senha propria (hash).
    repo.upsertRbacUser({ email: 'marcelo.mira@setatelecom.com.br', password: 'Seta@2026#StiHub' });

    // Etapa 1: Login inicial -> recebe QR Code e segredo TOTP
    const loginRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        password: "Seta@2026#StiHub",
      },
    });
    assert.equal(loginRes.status, 200);

    // Etapa 1b: Usuário clica em Sincronizar / Rotacionar QR Code (setup-totp)
    const refreshRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/setup-totp",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        regenerate: true,
      },
    });
    assert.equal(refreshRes.status, 200);
    const refreshed = (refreshRes.body as {
      data: { totpSecret: string; qrCodeSvgDataUrl: string };
    }).data;
    assert.ok(refreshed.totpSecret.length >= 16);
    assert.ok(refreshed.qrCodeSvgDataUrl.startsWith("data:image/svg+xml"));

    // Etapa 2: Usuário digita os 6 dígitos gerados no app Google Authenticator para o segredo pareado e confirma
    const totpCodeFromPhone = generateTotpCodeSync(refreshed.totpSecret);
    const verifyRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        code: totpCodeFromPhone,
        mfaMethod: "TOTP_AUTHENTICATOR",
        totpSecret: refreshed.totpSecret,
      },
    });
    assert.equal(verifyRes.status, 200);
    const sessionToken = (verifyRes.body as { data: { sessionToken: string; verifiedVia: string } }).data.sessionToken;
    assert.ok(sessionToken.includes("."));

    // Etapa 3: Simula o Edge Middleware rodando em um V8 isolate separado (limpando cache globalThis)
    delete (globalThis as Record<string, unknown>).__STIHUB_EPHEMERAL_SIGNING_SECRET_V1__;
    const middlewareDecision = evaluateStiHubRouteProtection({
      pathname: "/",
      method: "GET",
      sessionToken,
      enforceStrictLock: true,
    });
    assert.equal(middlewareDecision.allowed, true, "Middleware deve aceitar imediatamente o cookie stihub_session sem redirecionar para /login");
    assert.equal(middlewareDecision.redirectTo, null);
    assert.equal(middlewareDecision.statusCode, 200);
    assert.equal(middlewareDecision.reason, "MFA_SESSION_VERIFIED");

    // Etapa 4: Verifica que login/page.tsx e UserAccountModal.tsx deixam o campo de 6 dígitos limpo e não exibem o código TOTP na UI
    const rootDir = process.cwd();
    const loginPageSrc = fs.readFileSync(path.join(rootDir, "src/app/login/page.tsx"), "utf8");
    const accountModalSrc = fs.readFileSync(path.join(rootDir, "src/app/components/UserAccountModal.tsx"), "utf8");
    assert.equal(loginPageSrc.includes("setMfaCode(d?.demoTotpCode"), false, "Não deve autopreencher mfaCode no login");
    assert.equal(loginPageSrc.includes("setMfaCode(s.currentTotpCode"), false, "Não deve autopreencher mfaCode ao sincronizar QR");
    assert.equal(loginPageSrc.includes("Código 2FA sincronizado para homologação"), false, "Não deve exibir o código 2FA na tela de login");
    assert.equal(accountModalSrc.includes("Código TOTP RFC 6238 atual no servidor"), false, "Não deve exibir o código TOTP no modal da conta");
    assert.equal(loginPageSrc.includes("Seleção Rápida de Perfil"), false, "Não deve exibir painel lateral de seleção rápida na tela de login");
    assert.equal(loginPageSrc.includes("Sessão Assinada HMAC-SHA256"), false, "Não deve exibir badges técnicos no topo do login");
    assert.equal(loginPageSrc.includes("ETAPA 1 DE 2"), false, "Não deve exibir texto técnico ETAPA 1 DE 2");
    assert.equal(loginPageSrc.includes("ETAPA 2 DE 2"), false, "Não deve exibir texto técnico ETAPA 2 DE 2");
    assert.ok(loginPageSrc.includes("<span>{loading ? 'Entrando...' : 'Login'}</span>"), "Botão da Etapa 1 deve chamar-se Login");
    assert.ok(loginPageSrc.includes("Aplicativo Autenticador") && loginPageSrc.includes("Código por E-mail"), "Deve exibir as duas opções claras de 2FA");
  });

  it("aplica os 8 ajustes de limpeza da Proposta Comercial (SLA droplist sem 4h padrão, e-mail/WhatsApp do vendedor, remoção de campos fixos, Valor Mensal, Setup opcional e validação de Assinatura Digital)", async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const rootDir = process.cwd();
    const pageSrc = fs.readFileSync(path.join(rootDir, "src/app/proposta/[id]/page.tsx"), "utf8");
    const modalsSrc = fs.readFileSync(path.join(rootDir, "src/app/components/ErpEditModals.tsx"), "utf8");
    const shareMod = await import("../src/app/lib/proposal-share");

    // 1. SLA não força "NOC 24x7 • 99,95% (Atend. 4h)" e usa droplist
    assert.equal(pageSrc.includes("NOC 24x7 • 99,95% (Atend. 4h)"), false);
    const defaultSla = shareMod.resolveProposalSlaOption({});
    assert.equal(defaultSla.id, "SEM_SLA_ESPECIFICO");
    assert.equal(defaultSla.shortLabel, "");
    const legacySla = shareMod.resolveProposalSlaOption({ slaTier: "NOC_24X7_ALTA_DISP_4H" });
    assert.equal(legacySla.id, "SEM_SLA_ESPECIFICO");

    // 2. Removidos CNPJ: 14.806.925/0001-32 • Loja Matriz #118887 e comercial@setatelecom.com.br; usa e-mail e WhatsApp do vendedor
    assert.equal(pageSrc.includes("14.806.925/0001-32"), false);
    assert.equal(pageSrc.includes("118887"), false);
    assert.equal(pageSrc.includes("comercial@setatelecom.com.br"), false);
    assert.ok(pageSrc.includes("sellerContact.email") && pageSrc.includes("sellerContact.phone"));
    const sellerInfo = shareMod.resolveProposalSellerContact({ sellerName: "Marcelo Mira" });
    assert.equal(sellerInfo.email, "marcelo.mira@setatelecom.com.br");
    assert.ok(sellerInfo.phone.length > 0);

    // 3, 4 e 5. Removidos Centro de Custo / Unidade, Cliente Recorrente • Centro de Custo: VENDAS, Índice de Reajuste Anual, Diretoria & Compras Corporativas (B2B), Objeto da Proposta Comercial e contador de itens recorrentes
    assert.equal(pageSrc.includes("Centro de Custo / Unidade"), false);
    assert.equal(pageSrc.includes("Cliente Recorrente"), false);
    assert.equal(pageSrc.includes("Centro de Custo: VENDAS"), false);
    assert.equal(pageSrc.includes("Índice de Reajuste Anual"), false);
    assert.equal(pageSrc.includes("Diretoria & Compras Corporativas"), false);
    assert.equal(pageSrc.includes("Diretoria &amp; Compras Corporativas"), false);
    assert.equal(pageSrc.includes("Objeto da Proposta Comercial"), false);
    assert.equal(pageSrc.includes("item(ns) recorrente(s)"), false);
    assert.equal(
      shareMod.cleanProposalPaymentCondition("À vista • Vencimento 16/11/2026 • Canal: Cliente Recorrente • Centro de Custo: VENDAS"),
      "À vista • Vencimento 16/11/2026"
    );

    // 6. Setup / Ativação só aparece quando selecionado (hasSetupSelected)
    assert.ok(pageSrc.includes("hasSetupSelected && ("));
    assert.ok(modalsSrc.includes("Incluir Setup / Ativação (R$)"));

    // 7. Alterado de Investimento Mensal (MRR) para Valor Mensal
    assert.equal(pageSrc.includes("Investimento Mensal (MRR)"), false);
    assert.ok(pageSrc.includes("Valor Mensal"));

    // 8. Validação completa do processo de Assinatura Digital (inclusive para proposta compartilhada via ?d=)
    const approveRes = await router.dispatch({
      method: "POST",
      path: "/api/erp/proposals/prop-shared-custom-99/approve",
      body: {
        signerName: "Roberto Carlos Diretor",
        signerCpf: "529.982.247-25",
        signerRole: "Diretor Executivo",
        modality: "ICP_BRASIL_A1",
        acceptedTerms: true,
        proposal: {
          id: "prop-shared-custom-99",
          code: "PROP-CUSTOM-99",
          title: "Proposta Comercial Customizada Teste Assinatura",
          companyName: "Empresa Assinante S.A.",
          companyCnpj: "18.236.120/0001-58",
          sellerName: "Marcelo Lopes Mira",
          sellerEmail: "marcelo.mira@setatelecom.com.br",
          sellerPhone: "(11) 99999-4929",
          contractMonths: 24,
          monthlyRecurringTotal: 4500,
          items: [
            {
              id: "it-sig-1",
              sku: "SL-44-SEC-K9",
              description: "Licença Telecom",
              fiscalNature: "LOCACAO_BENS_MOVEIS",
              ncmOrServiceCode: "NCM 8517.62.59",
              quantity: 1,
              unitPrice: 4500,
              discountPercent: 0,
              isRecurring: true,
              totalMonthly: 4500,
            },
          ],
        },
      },
    });
    assert.equal(approveRes.status, 200);
    const approvedData = (approveRes.body as {
      data: {
        proposal: { status: string; digitalSignature: { signerName: string; signatureHashSha256: string; timestampToken: string } };
        contract: { contractNumber: string };
      };
    }).data;
    assert.equal(approvedData.proposal.status, "CONVERTIDA_CONTRATO");
    assert.equal(approvedData.proposal.digitalSignature.signerName, "Roberto Carlos Diretor");
    assert.equal(approvedData.proposal.digitalSignature.signatureHashSha256.length, 64);
    assert.ok(approvedData.proposal.digitalSignature.timestampToken.startsWith("ACT-ITI-"));
    assert.ok(approvedData.contract.contractNumber.startsWith("LOC-"));
  });

  it("rejeita códigos TOTP expirados (janela anterior de 30s), bloqueia reutilização (anti-replay) do mesmo código e oculta o QR Code/segredo quando o 2FA já está configurado", async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    // Contencao 29/10/2026: sem senha-mestra; o usuario precisa de senha propria (hash).
    repo.upsertRbacUser({ email: 'marcelo.mira@setatelecom.com.br', password: 'Seta@2026#StiHub' });
    // Pareamento concluido na epoca de rotacao atual.
    repo.upsertRbacUser({ email: 'marcelo.mira@setatelecom.com.br', totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH });
    const { computeRfc6238Totp, verifyRfc6238Totp } = await import("../src/app/lib/auth");

    // 1. Usuário existente com 2FA já configurado (totpConfigured === true): login NÃO pode expor totpPairing nem QR Code
    const loginConfiguredRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        password: "Seta@2026#StiHub",
      },
    });
    assert.equal(loginConfiguredRes.status, 200);
    const loginConfiguredData = (loginConfiguredRes.body as {
      data: {
        totpConfigured: boolean;
        totpPairing?: unknown;
        user: { totpSecret?: string; totpConfigured?: boolean };
      };
    }).data;
    assert.equal(loginConfiguredData.totpConfigured, true);
    assert.equal(loginConfiguredData.totpPairing, undefined, "Não deve retornar totpPairing/QR Code quando totpConfigured === true");
    assert.equal(loginConfiguredData.user.totpSecret, undefined, "Não deve expor totpSecret no payload de login quando já configurado");

    // 2. Chamada HTTP externa não autenticada para /api/auth/setup-totp de usuário já configurado deve retornar 403
    const blockedSetupRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/setup-totp",
      query: { _fromHttpBridge: "1" },
      body: { email: "marcelo.mira@setatelecom.com.br" },
    });
    assert.equal(blockedSetupRes.status, 403);

    // 3. Janela estrita de 30s: código da janela anterior (now - 30_000) deve ser REJEITADO como expirado
    const marceloSecret = repo.getRbacState().users.find((u) => u.email === "marcelo.mira@setatelecom.com.br")!.totpSecret!;
    const nowMs = Date.now();
    const expiredCodePrevWindow = computeRfc6238Totp(marceloSecret, nowMs - 30000, 0).code;
    const validCurrentCode = computeRfc6238Totp(marceloSecret, nowMs, 0).code;

    assert.equal(verifyRfc6238Totp(marceloSecret, expiredCodePrevWindow, nowMs), false, "verifyRfc6238Totp deve rejeitar janela anterior (now - 30s)");
    assert.equal(verifyRfc6238Totp(marceloSecret, validCurrentCode, nowMs), true, "verifyRfc6238Totp deve aceitar janela atual de 30s");

    const expiredVerifyRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        code: expiredCodePrevWindow,
        mfaMethod: "TOTP_AUTHENTICATOR",
      },
    });
    assert.equal(expiredVerifyRes.status, 401, "API deve rejeitar código TOTP expirado da janela anterior (401)");
    assert.ok(
      String((expiredVerifyRes.body as { error: string }).error).toLowerCase().includes("expirado"),
      "Mensagem de erro deve informar que o código está expirado"
    );

    // 4. Código fixo antigo de demonstração (436906 / 118887) não deve mais ser aceito como bypass
    const demoBypassRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        code: "436906",
      },
    });
    if ("436906" !== validCurrentCode) {
      assert.equal(demoBypassRes.status, 401, "Código estático 436906 não deve autenticar");
    }

    // 5. Primeiro uso do código atual de 30s funciona, e o SEGUNDO uso do mesmo código é bloqueado (Anti-Replay)
    const firstUseRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        code: validCurrentCode,
        mfaMethod: "TOTP_AUTHENTICATOR",
      },
    });
    assert.equal(firstUseRes.status, 200);

    const replayUseRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        code: validCurrentCode,
        mfaMethod: "TOTP_AUTHENTICATOR",
      },
    });
    assert.equal(replayUseRes.status, 401, "Reutilização (replay) do mesmo código TOTP deve ser bloqueada com 401");

    // 6. Novo usuário recém-criado com totpConfigured = false recebe QR Code apenas no 1º acesso e passa para totpConfigured = true após confirmar
    const newUser = repo.upsertRbacUser({
      name: "Colaborador Primeiro Acesso",
      email: "primeiro.acesso@setatelecom.com.br",
      roleId: "VENDEDOR_SALES",
      totpConfigured: false,
      password: "Seta@2026#StiHub",
    });
    assert.equal(newUser.totpConfigured, false);

    const firstLoginRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "primeiro.acesso@setatelecom.com.br",
        password: "Seta@2026#StiHub",
      },
    });
    assert.equal(firstLoginRes.status, 200);
    const firstLoginData = (firstLoginRes.body as {
      data: { totpConfigured: boolean; totpPairing?: { totpSecret: string; qrCodeSvgDataUrl: string } };
    }).data;
    assert.equal(firstLoginData.totpConfigured, false);
    assert.ok(firstLoginData.totpPairing?.qrCodeSvgDataUrl.startsWith("data:image/svg+xml"), "No 1º acesso (totpConfigured=false) deve exibir QR Code");

    const firstEnrollCode = computeRfc6238Totp(firstLoginData.totpPairing!.totpSecret).code;
    const enrollVerifyRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "primeiro.acesso@setatelecom.com.br",
        code: firstEnrollCode,
        mfaMethod: "TOTP_AUTHENTICATOR",
      },
    });
    assert.equal(enrollVerifyRes.status, 200);

    // No login seguinte, totpConfigured agora é true e o QR Code NÃO é mais retornado
    const secondLoginRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "primeiro.acesso@setatelecom.com.br",
        password: "Seta@2026#StiHub",
      },
    });
    const secondLoginData = (secondLoginRes.body as {
      data: { totpConfigured: boolean; totpPairing?: unknown };
    }).data;
    assert.equal(secondLoginData.totpConfigured, true);
    assert.equal(secondLoginData.totpPairing, undefined, "Após o 1º pareamento, o QR Code nunca mais deve ser retornado no login");
  });
});

describe("Proposta: Prazo de Entrega editável e 3 opções leves de template (com institucional Seta Telecom e fluxo em 7 etapas)", () => {
  it("usa deliveryLeadTime sem 48h fixo, disponibiliza as 3 opções leves (Opção 1 Clean Corporate Light como padrão), remove Telefonia IP/PABX, exibe apresentação institucional e as 7 etapas do fluxo de contratação", async () => {
    const share = await import("../src/app/lib/proposal-share");
    const pageSrc = fs.readFileSync(path.join(process.cwd(), "src/app/proposta/[id]/page.tsx"), "utf8");
    const shareSrc = fs.readFileSync(path.join(process.cwd(), "src/app/lib/proposal-share.ts"), "utf8");

    assert.ok(!pageSrc.includes("Imediato (até 48h)"));
    assert.ok(pageSrc.includes("resolveProposalDeliveryLeadTime(proposal)"));
    assert.equal(pageSrc.includes(`list="delivery-lead-time-suggestions"`), false, "Prazo de Entrega não deve ficar solto na topbar da proposta");
    assert.equal(pageSrc.includes(`title="Selecionar opção de SLA da Proposta"`), false, "SLA não deve ficar na topbar externa da proposta");
    assert.ok(pageSrc.includes("Tempo de Contrato: {contractDurationMonths}"));
    assert.equal(share.resolveProposalDeliveryLeadTime({ deliveryLeadTime: "10 dias úteis após o aceite" } as never), "10 dias úteis após o aceite");
    assert.equal(share.resolveProposalDeliveryLeadTime({ deliveryForecast: "Imediato (até 48h)" } as never), "");

    // 1. As 3 opções leves no seletor com CLEAN_CORPORATE_LIGHT como padrão
    const ids = share.PROPOSAL_TEMPLATE_STYLE_OPTIONS.map((o) => o.id);
    assert.deepEqual(ids, [
      "CLEAN_CORPORATE_LIGHT",
      "MINIMAL_SWISS_PAPER",
      "EXECUTIVE_SOFT_INDIGO",
    ]);
    assert.equal(share.resolveProposalLayoutKind(undefined), "CLEAN_CORPORATE_LIGHT");
    assert.equal(share.resolveProposalLayoutKind("CLEAN_CORPORATE_LIGHT"), "CLEAN_CORPORATE_LIGHT");
    assert.equal(share.resolveProposalLayoutKind("MINIMAL_SWISS_PAPER"), "MINIMAL_SWISS_PAPER");
    assert.equal(share.resolveProposalLayoutKind("EXECUTIVE_SOFT_INDIGO"), "EXECUTIVE_SOFT_INDIGO");
    // Compatibilidade retroativa com IDs antigos
    assert.equal(share.resolveProposalLayoutKind("FOLHA_ORCAMENTO"), "MINIMAL_SWISS_PAPER");
    assert.equal(share.resolveProposalLayoutKind("DESIGN_CONSULTORIA"), "EXECUTIVE_SOFT_INDIGO");
    assert.equal(share.resolveProposalLayoutKind("EXECUTIVO_CORPORATIVO"), "CLEAN_CORPORATE_LIGHT");
    assert.equal(share.resolveProposalLayoutKind("INSTITUCIONAL_SETA_TELECOM"), "CLEAN_CORPORATE_LIGHT");

    // 2. Nenhuma referência a Telefonia IP, PABX Cloud & Comunicação Unificada ou Voz Corporativa de Alta Disponibilidade
    assert.equal(pageSrc.includes("Telefonia IP, PABX Cloud & Comunicação Unificada"), false);
    assert.equal(pageSrc.includes("Voz Corporativa de Alta Disponibilidade"), false);
    assert.equal(shareSrc.includes("Telefonia IP, PABX Cloud & Comunicação Unificada"), false);
    assert.equal(shareSrc.includes("Voz Corporativa de Alta Disponibilidade"), false);

    // 3. Bloco institucional resumido da Seta Telecom + 10 tópicos de serviços
    assert.ok(share.SETA_TELECOM_INSTITUTIONAL_SUMMARY.marketTime.includes("18 anos"));
    assert.ok(share.SETA_TELECOM_INSTITUTIONAL_SUMMARY.location.includes("Rua Guapuruvu, 242"));
    assert.ok(share.SETA_TELECOM_INSTITUTIONAL_SUMMARY.partners.includes("Cisco, Dell, HPE, Fortinet"));
    assert.equal(share.SETA_TELECOM_OFFICIAL_SERVICES_TOPICS.length, 10);
    assert.ok(pageSrc.includes("SETA_TELECOM_INSTITUTIONAL_SUMMARY"));
    assert.ok(pageSrc.includes("SETA_TELECOM_OFFICIAL_SERVICES_TOPICS.map"));
    assert.ok(pageSrc.includes("SETA_TELECOM_PORTFOLIO_PILLARS.map"));
    assert.ok(pageSrc.includes("resolveProposalDocumentHeadings"));
    assert.equal(pageSrc.includes("FOLHA DE ORÇAMENTO &amp; PROPOSTA COMERCIAL"), false);

    // 4. Fluxo de contratação de locação em 7 etapas no final da proposta
    assert.equal(
      share.SETA_TELECOM_HIRING_FLOW_TITLE,
      "Fluxo de contratação de locação — Cliente Seta Telecom"
    );
    assert.equal(share.SETA_TELECOM_HIRING_FLOW_STEPS.length, 7);
    assert.ok(pageSrc.includes("SETA_TELECOM_HIRING_FLOW_TITLE"));
    assert.ok(pageSrc.includes("SETA_TELECOM_HIRING_FLOW_STEPS.map"));

    // 5. Valida os 14 ajustes finos solicitados pelo Marcéllo na proposta A4
    assert.equal(share.resolveProposalSlaOption({ slaTier: "CORPORATIVO_8X5_NBD" }).shortLabel, "SLA 8x5 NBD");
    assert.equal(share.resolveProposalSlaOption({ slaTier: "PADRAO_COMERCIAL_8H" }).shortLabel, "SLA 8x5 NBD");
    assert.equal(
      share.cleanProposalTechnicalClauses(
        "SLA 99,95% com substituição expressa de hardware (Advance Replacement em até 4h na Grande SP). Vigência de 24 meses com reajuste anual pelo IPCA."
      ),
      ""
    );
    assert.equal(pageSrc.includes("Opção 1 • Clean Corporate Light"), false);
    assert.ok(pageSrc.includes("DADOS DA EMPRESA:"));
    assert.ok(pageSrc.includes("CONDIÇÕES GERAIS:"));
    assert.ok(pageSrc.includes("FRETE R$:"));
    assert.equal(pageSrc.includes("Frete (Isolado)"), false);
    assert.equal(pageSrc.includes("R$ 0,00 (Cortesia)"), false);
    assert.equal(pageSrc.includes("Valor Global do Orçamento"), false);
    assert.equal(pageSrc.includes("Subtotal Líquido"), false);
    assert.ok(pageSrc.includes(">Subtotal</th>"));
    assert.equal(pageSrc.includes("Produto / Equipamento"), false);
    assert.equal(pageSrc.includes("Frete / Transporte"), false);
    assert.ok(pageSrc.includes("<span>Fiscal</span>"));
    assert.equal(pageSrc.includes("Amparo Legal &amp; Segregação Tributária"), false);
    assert.equal(pageSrc.includes("Parcela Locação (0% ISS):"), false);
    assert.equal(pageSrc.includes("Parcela Serviços (NFS-e):"), false);
    assert.equal(pageSrc.includes("Economia Tributária ISS:"), false);
    assert.equal(pageSrc.includes("border-2 border-slate-900"), false);

    // 6. Valida padrão de Ações GestãoClick (3 botões + menu dropdown completo + modal Alterar situação + Histórico de situações e versões) em ErpGestaoClickTab.tsx
    const erpTabSrc = fs.readFileSync(path.join(process.cwd(), "src/app/components/ErpGestaoClickTab.tsx"), "utf8");
    assert.ok(erpTabSrc.includes("renderProposalGestaoClickActions"));
    assert.ok(erpTabSrc.includes("Ver proposta"));
    assert.ok(erpTabSrc.includes("Alterar situação"));
    assert.ok(erpTabSrc.includes("Formato A4"));
    assert.ok(erpTabSrc.includes("Cupom"));
    assert.ok(erpTabSrc.includes("Por e-mail"));
    assert.ok(erpTabSrc.includes("Por WhatsApp"));
    assert.ok(erpTabSrc.includes("Por SMS"));
    assert.ok(erpTabSrc.includes("e-Assinatura"));
    assert.ok(erpTabSrc.includes("Ordem de serviço"));
    assert.ok(erpTabSrc.includes("Histórico de situações"));
    assert.ok(erpTabSrc.includes("Histórico de versões da proposta"));
    assert.ok(erpTabSrc.includes("handleConfirmChangeProposalStatus"));
    assert.ok(pageSrc.includes("Abrir Tela da Versão") || pageSrc.includes("<span>Abrir</span>"));
    assert.ok(pageSrc.includes("Baixar / Imprimir PDF") || pageSrc.includes("<span>PDF</span>"));
    assert.ok(erpTabSrc.includes("Abrir Tela da Versão") || erpTabSrc.includes("<span>Abrir</span>"));
    assert.equal(erpTabSrc.includes("Prod / Serv / Frete"), false, "Coluna Prod / Serv / Frete removida da listagem de propostas");
    assert.equal(erpTabSrc.includes("<th className=\"py-2.5 px-3\">Tipo</th>"), false, "Coluna Tipo removida da listagem de propostas");

    // 7. Valida as 3 variantes de Tipo de Proposta: PRODUTOS (Proposta Comercial sem SLA/vigência), LOCACAO (Proposta de Locação) e SERVICOS (Proposta de Serviços com tipos de serviço)
    const prodHead = share.resolveProposalDocumentHeadings({ budgetType: "PRODUTOS" });
    assert.equal(prodHead.headerDocLabel, "PROPOSTA COMERCIAL");
    assert.equal(prodHead.isProductsOnly, true);
    assert.equal(prodHead.isRental, false);
    const prodComputed = share.computeProposalTotals({
      id: "prop-prod-test",
      code: "PROD-01",
      title: "Fornecimento de Switches",
      budgetType: "PRODUTOS",
      slaTier: "CORPORATIVO_8X5_NBD",
      contractMonths: 24,
      companyId: null,
      companyName: "Cliente Produtos",
      companyCnpj: "00.000.000/0001-00",
      contactId: null,
      contactName: "Comprador",
      dealId: null,
      sellerName: "Marcelo Lopes Mira",
      status: "ENVIADA",
      paymentCondition: "À vista",
      validUntil: "2026-11-15",
      items: [
        {
          id: "i1",
          sku: "SW-01",
          description: "Switch 24p",
          fiscalNature: "VENDA_EQUIPAMENTO",
          ncmOrServiceCode: "NCM 8517.62.59",
          quantity: 2,
          unitPrice: 1500,
          discountPercent: 0,
          isRecurring: false,
          totalMonthly: 3000,
        },
      ],
      monthlyRecurringTotal: 0,
      oneTimeSetupTotal: 3000,
      totalContractValue: 3000,
      commercialNotes: "",
      technicalClauses: "",
      createdAt: "2026-10-28T12:00:00Z",
      updatedAt: "2026-10-28T12:00:00Z",
    });
    assert.equal(prodComputed.slaTier, "SEM_SLA_ESPECIFICO", "Proposta de Produtos não tem SLA");
    assert.equal(prodComputed.contractMonths, 1, "Proposta de Produtos não tem vigência de locação");
    assert.equal(prodComputed.totalContractValue, 3000);

    const locHead = share.resolveProposalDocumentHeadings({ budgetType: "LOCACAO" });
    assert.equal(locHead.headerDocLabel, "PROPOSTA DE LOCAÇÃO");
    assert.equal(locHead.dividerTitle, "PROPOSTA DE LOCAÇÃO - Solução");
    assert.equal(locHead.isRental, true);

    const srvHead = share.resolveProposalDocumentHeadings({
      budgetType: "SERVICOS",
      serviceType: "Suporte Técnico, Spare Parts / Hard Parts, Configuração e Instalação",
    });
    assert.equal(
      srvHead.headerDocLabel,
      "PROPOSTA DE SERVIÇOS — Suporte Técnico, Spare Parts / Hard Parts, Configuração e Instalação"
    );
    assert.ok(srvHead.serviceTypeLabel.includes("Suporte Técnico"));
    assert.ok(srvHead.serviceTypeLabel.includes("Spare Parts / Hard Parts"));
    assert.ok(srvHead.serviceTypeLabel.includes("Configuração"));
    assert.ok(srvHead.serviceTypeLabel.includes("Instalação"));
    assert.equal(typeof share.buildProposalVersionUrl, "function");
    assert.equal(typeof share.proposalFromVersionSnapshot, "function");
  });
  it("valida fluxo stateless completo de EMAIL_OTP entre /api/auth/send-email-otp e /api/auth/verify-mfa (mesmo quando verify-mfa cai em outra instância Lambda sem estado em memória) e exibe devOtpPreview na tela de login em modo contingência", async () => {
    const repoA = createInMemoryRepository();
    const routerA = new CrmApiRouter(repoA);

    // 1. Instância A gera o código OTP por e-mail e retorna challengeId assinado + devOtpPreview
    const sendRes = await routerA.dispatch({
      method: "POST",
      path: "/api/auth/send-email-otp",
      body: { email: "marcelo.mira@setatelecom.com.br" },
    });
    assert.equal(sendRes.status, 200);
    const sendData = (sendRes.body as {
      data: {
        challengeId: string;
        email: string;
        devOtpPreview: string;
        deliveryMode: string;
      };
    }).data;
    assert.ok(sendData.challengeId.includes("."), "challengeId deve ser token assinado HMAC-SHA256");
    assert.equal(sendData.devOtpPreview.length, 6);

    // 2. Instância B (novo repositório em memória vazio de emailOtpChallenges, simulando outra Lambda serverless)
    const repoB = createInMemoryRepository();
    const routerB = new CrmApiRouter(repoB);

    const verifyRes = await routerB.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "marcelo.mira@setatelecom.com.br",
        code: sendData.devOtpPreview,
        mfaMethod: "EMAIL_OTP",
        challengeId: sendData.challengeId,
      },
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = (verifyRes.body as {
      data: { authenticated: boolean; mfaVerified: boolean; verifiedVia: string; sessionToken: string };
    }).data;
    assert.equal(verifyData.authenticated, true);
    assert.equal(verifyData.mfaVerified, true);
    assert.equal(verifyData.verifiedVia, "EMAIL_OTP");

    // 3. Verifica que src/app/login/page.tsx NUNCA exibe devOtpPreview nem código OTP na tela, e que chamadas HTTP externas sem provedor retornam 503 sem vazar o código
    const loginPageSrc = fs.readFileSync(path.join(process.cwd(), "src/app/login/page.tsx"), "utf8");
    assert.equal(loginPageSrc.includes("devOtpPreview"), false, "login/page.tsx jamais deve exibir devOtpPreview na tela");
    assert.equal(loginPageSrc.includes("Usar este código (Preencher)"), false, "login/page.tsx jamais deve ter botão de autopreencher código OTP");

    // Contencao 29/10/2026: via HTTP o OTP por e-mail exige o desafio da senha (etapa 1).
    const noChallengeRes = await routerA.dispatch({
      method: "POST",
      path: "/api/auth/send-email-otp",
      query: { _fromHttpBridge: "1" },
      body: { email: "marcelo.mira@setatelecom.com.br" },
    });
    assert.equal(noChallengeRes.status, 401);
    const stepOneChallenge = signMfaChallengeToken({
      cid: "MFA-TEST-STEP1",
      uid: "usr-seta-01",
      email: "marcelo.mira@setatelecom.com.br",
      mfaMethod: "TOTP_AUTHENTICATOR",
      totpSecret: "",
      iat: Date.now(),
      exp: Date.now() + 60_000,
    });
    const externalHttpSendRes = await routerA.dispatch({
      method: "POST",
      path: "/api/auth/send-email-otp",
      query: { _fromHttpBridge: "1" },
      body: { email: "marcelo.mira@setatelecom.com.br", challengeId: stepOneChallenge },
    });
    assert.equal(externalHttpSendRes.status, 503, "Sem provedor SMTP/Resend configurado, chamada HTTP externa deve informar 503 em vez de fingir envio ou vazar código");
    assert.equal((externalHttpSendRes.body as { data?: { devOtpPreview?: string } }).data?.devOtpPreview, undefined, "Nunca deve vazar devOtpPreview via HTTP");
  });
});

describe("Padronização da Arquitetura de Navegação nos 3 Sistemas (CRM, ERP e Chamados)", () => {
  it("valida indicadores de topo 100% contextuais, sidebars corporativas em blocos com acordeão único, navegação cruzada 1-clique no ERP e zero emojis nas 5 superfícies", () => {
    const rootDir = process.cwd();
    const pageSrc = fs.readFileSync(path.join(rootDir, "src/app/page.tsx"), "utf8");
    const crmSidebarSrc = fs.readFileSync(path.join(rootDir, "src/app/components/CrmSidebar.tsx"), "utf8");
    const gcSidebarSrc = fs.readFileSync(path.join(rootDir, "src/app/components/GestaoClickSidebar.tsx"), "utf8");
    const erpTabSrc = fs.readFileSync(path.join(rootDir, "src/app/components/ErpGestaoClickTab.tsx"), "utf8");
    const sdSrc = fs.readFileSync(path.join(rootDir, "src/app/components/ServiceDeskTab.tsx"), "utf8");

    // 1. Indicadores de topo 100% contextuais por sistema ativo
    assert.ok(pageSrc.includes("Forecast CRM:"));
    assert.ok(pageSrc.includes("Saúde CRM:"));
    assert.ok(pageSrc.includes("MRR Locação:"));
    assert.ok(pageSrc.includes("Saúde ERP:"));
    assert.ok(pageSrc.includes("SLA no Prazo:"));
    assert.ok(pageSrc.includes("Saúde Chamados:"));

    // 2. Sidebars corporativas em blocos nos 3 sistemas (ERP, CRM e Chamados)
    assert.ok(gcSidebarSrc.includes("MÓDULO ERP • GESTÃOCLICK"));
    assert.ok(gcSidebarSrc.includes("COMERCIAL & LOCAÇÃO"));
    assert.ok(gcSidebarSrc.includes("OPERAÇÃO & TÉCNICO"));
    assert.ok(gcSidebarSrc.includes("FINANCEIRO, FISCAL & GOVERNANÇA"));

    assert.ok(crmSidebarSrc.includes("MÓDULO CRM • SALES &amp; MARKETING"));
    assert.ok(crmSidebarSrc.includes("COMERCIAL &amp; CLIENTES"));
    assert.ok(crmSidebarSrc.includes("MARKETING &amp; AUTOMAÇÃO"));
    assert.ok(crmSidebarSrc.includes("GOVERNANÇA CRM"));

    assert.ok(sdSrc.includes("MÓDULO CHAMADOS • SERVICE HUB"));
    assert.ok(sdSrc.includes("ATENDIMENTO &amp; FILAS NOC"));
    assert.ok(sdSrc.includes("QUALIDADE &amp; AUDITORIA"));
    assert.ok(sdSrc.includes("Fila de Chamados (5 Visões)"));
    assert.ok(sdSrc.includes("Ordens de Serviço Vinculadas"));

    // 3. Navegação cruzada 1-clique no ERP (Orçamentos <-> Contratos <-> Fiscal <-> Cliente)
    assert.ok(erpTabSrc.includes("handleOpenErpCustomerByCompany"));
    assert.ok(erpTabSrc.includes("handleNavigateToContractFromDoc"));
    assert.ok(erpTabSrc.includes("handleNavigateToFiscalFromContract"));

    // 4. Zero emojis nas 5 superfícies principais de navegação e operação
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    assert.equal(emojiRegex.test(pageSrc), false);
    assert.equal(emojiRegex.test(crmSidebarSrc), false);
    assert.equal(emojiRegex.test(gcSidebarSrc), false);
    assert.equal(emojiRegex.test(erpTabSrc), false);
    assert.equal(emojiRegex.test(sdSrc), false);
  });
  it("garante varredura 100% livre de emojis (\\p{Extended_Pictographic}) em todos os arquivos .ts e .tsx de src/ e remoção da barra de busca/enriquecimento duplicada em ContactsCompaniesTab", () => {
    const rootDir = process.cwd();
    const walkFiles = (dir: string): string[] => {
      let out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out = out.concat(walkFiles(full));
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          out.push(full);
        }
      }
      return out;
    };

    const allSrcFiles = walkFiles(path.join(rootDir, "src"));
    assert.ok(allSrcFiles.length >= 40, "Deve varrer todos os arquivos .ts e .tsx em src/");
    const emojiRe = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{FE0F}]/u;

    for (const file of allSrcFiles) {
      const content = fs.readFileSync(file, "utf8");
      const rel = path.relative(rootDir, file);
      assert.equal(emojiRe.test(content), false, `Arquivo ${rel} não deve conter nenhum emoji Unicode`);
    }

    const ccSrc = fs.readFileSync(path.join(rootDir, "src/app/components/ContactsCompaniesTab.tsx"), "utf8");
    assert.equal(
      ccSrc.includes("Pesquisar empresa por razão social, domínio, CNPJ, cidade ou setor..."),
      false,
      "Barra de pesquisa/filtro duplicada deve ter sido removida de ContactsCompaniesTab"
    );
    assert.equal(
      ccSrc.includes("Enriquecer domínio (ex: @totvs.com.br)"),
      false,
      "Formulário de enriquecer domínio na barra superior deve ter sido removido de ContactsCompaniesTab"
    );
  });
  it("garante tipografia rica e destacada na Proposta Comercial e menus (font-bold, font-extrabold, font-black e strong), coluna Vendedor sem Canal/Comercial B2B, sem checkboxes na tabela de propostas e sanitizacao runtime stripEmojisDeep", async () => {
    const rootDir = process.cwd();
    const propPageSrc = fs.readFileSync(path.join(rootDir, "src/app/proposta/[id]/page.tsx"), "utf8");
    const crmSidebarSrc = fs.readFileSync(path.join(rootDir, "src/app/components/CrmSidebar.tsx"), "utf8");
    const gcSidebarSrc = fs.readFileSync(path.join(rootDir, "src/app/components/GestaoClickSidebar.tsx"), "utf8");
    const erpSrc = fs.readFileSync(path.join(rootDir, "src/app/components/ErpGestaoClickTab.tsx"), "utf8");

    // 1. Proposta Comercial possui bastante destaque em negrito (font-bold, font-extrabold, font-black e <strong>)
    assert.ok(propPageSrc.includes("font-bold"), "Proposta Comercial deve conter font-bold");
    assert.ok(propPageSrc.includes("font-extrabold") || propPageSrc.includes("font-black"), "Proposta Comercial deve conter font-extrabold / font-black nos destaques");
    assert.ok(propPageSrc.includes("<strong"), "Proposta Comercial deve conter tags <strong> nos rotulos e valores");

    // 2. Menus e sidebars preservam font-semibold / font-bold
    assert.ok(/\bfont-(semibold|bold)\b/.test(crmSidebarSrc), "CrmSidebar deve preservar negrito em titulos e itens ativos do menu");
    assert.ok(/\bfont-(semibold|bold)\b/.test(gcSidebarSrc), "GestaoClickSidebar deve preservar negrito em titulos e itens ativos do menu");

    // 3. Coluna Vendedor sem barra Canal, sem Comercial B2B abaixo do nome do vendedor e sem checkboxes/Editar Selecionado
    assert.equal(erpSrc.includes("Vendedor / Canal"), false, "Nao deve exibir Vendedor / Canal no cabecalho da proposta");
    assert.ok(erpSrc.includes("<th className=\"py-2.5 px-3\">Vendedor</th>"), "Deve exibir apenas Vendedor no cabecalho da coluna");
    assert.equal(erpSrc.includes("{prop.salesChannel || 'Comercial B2B'}"), false, "Nao deve exibir Comercial B2B abaixo do nome do vendedor na listagem de propostas");
    assert.equal(erpSrc.includes("Editar Selecionado ("), false, "Nao deve exibir botao Editar Selecionado no topo de propostas");

    const dsMod = await import("../src/app/lib/durable-storage");
    const dirty = {
      title: "Proposta 100%",
      nested: ["Faturamento", { note: "Concluído" }],
    };
    const cleaned = dsMod.stripEmojisDeep(dirty);
    assert.equal(cleaned.title.trim(), "Proposta 100%");
    assert.equal((cleaned.nested[0] as string).trim(), "Faturamento");
    assert.equal((cleaned.nested[1] as { note: string }).note.trim(), "Concluído");
  });
});


describe("Plataforma Enterprise de Email Marketing, Cadências & Sales Engagement (HubSpot Pro + Mailchimp — Seta Telecom)", () => {
  it("valida roadmaps atualizados (ROADMAP-CRM.md e ROADMAP.md) e zero emojis em MarketingAndSalesHubSuites.tsx e FormsBuilderTab.tsx", () => {
    const rootDir = process.cwd();
    const roadmapCrm = fs.readFileSync(path.join(rootDir, "ROADMAP-CRM.md"), "utf8");
    const roadmapMain = fs.readFileSync(path.join(rootDir, "ROADMAP.md"), "utf8");
    const mktSuiteSrc = fs.readFileSync(
      path.join(rootDir, "src/app/components/MarketingAndSalesHubSuites.tsx"),
      "utf8"
    );
    const formsSrc = fs.readFileSync(
      path.join(rootDir, "src/app/components/FormsBuilderTab.tsx"),
      "utf8"
    );

    assert.ok(
      roadmapCrm.includes(
        "PLATAFORMA ENTERPRISE DE EMAIL MARKETING, CADÊNCIAS E SALES ENGAGEMENT (HUBSPOT PRO + MAILCHIMP — SETA TELECOM)"
      )
    );
    assert.ok(roadmapCrm.includes("MÓDULO A — GESTÃO COMPLETA DE CONTATOS E AUDIÊNCIAS"));
    assert.ok(roadmapCrm.includes("MÓDULO C — CADÊNCIAS COMERCIAIS AVANÇADAS"));
    assert.ok(roadmapCrm.includes("MÓDULO H — DESCADASTRO, SUPRESSÃO E PREFERÊNCIAS"));
    assert.ok(roadmapCrm.includes("MÓDULO L — INTEGRAÇÃO DE E-MAILS E INFRAESTRUTURA DE ENVIO"));
    assert.ok(roadmapMain.includes("Seção 6 — Plataforma Enterprise de Email Marketing"));

    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    assert.equal(
      emojiRegex.test(mktSuiteSrc),
      false,
      "MarketingAndSalesHubSuites.tsx deve ser 100% corporativo e sem emojis"
    );
    assert.equal(
      emojiRegex.test(formsSrc),
      false,
      "FormsBuilderTab.tsx deve ser 100% corporativo e sem emojis"
    );
  });

  it("persiste Campanhas, Segmentos Dinâmicos (com Account-Based Engagement por Empresa) e Landing Pages e atribui UTMs + LGPD na submissão de formulário", async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Listar campanhas, funil de engajamento e engajamento por empresa (ABM)
    const getCmpRes = await router.dispatch({
      method: "GET",
      path: "/api/marketing/campaigns",
    });
    assert.equal(getCmpRes.status, 200);
    const cmpBody = getCmpRes.body as {
      data: Array<{ id: string; utmCampaign: string; attributedRevenueBrl: number }>;
      engagementFunnel: { sentCount: number; deliveredCount: number; opportunitiesCount: number };
      accountEngagement: Array<{ companyId: string; engagedContactsCount: number }>;
    };
    assert.ok(cmpBody.data.length >= 3);
    assert.equal(cmpBody.engagementFunnel.sentCount, 12450);
    assert.equal(cmpBody.engagementFunnel.deliveredCount, 12080);
    assert.equal(cmpBody.engagementFunnel.opportunitiesCount, 184);
    assert.ok(cmpBody.accountEngagement.some((a) => a.companyId === "comp-nubank" && a.engagedContactsCount >= 2));

    // 2. Criar nova campanha, segmento e landing page
    const createCmpRes = await router.dispatch({
      method: "POST",
      path: "/api/marketing/campaigns",
      body: {
        name: "Campanha Locação Servidores Dell PowerEdge Q4",
        utmCampaign: "locacao-servidores-dell-q4",
        sendingProvider: "MARKETING_ESP",
        budgetBrl: 22000,
      },
    });
    assert.equal(createCmpRes.status, 201);

    const createSegRes = await router.dispatch({
      method: "POST",
      path: "/api/marketing/segments",
      body: {
        name: "Decisores Tier 1 Score >= 85",
        type: "DYNAMIC",
        filterExpression: "company.icpTier = 'TIER_1' AND contact.leadScore >= 85",
        criteria: { icpTier: "TIER_1", minLeadScore: 85, onlySubscribedEligible: true },
      },
    });
    assert.equal(createSegRes.status, 201);

    const createLpRes = await router.dispatch({
      method: "POST",
      path: "/api/marketing/landing-pages",
      body: {
        name: "LP Locação Servidores Dell",
        utmCampaign: "locacao-servidores-dell-q4",
        formId: "form-enterprise-demo",
      },
    });
    assert.equal(createLpRes.status, 201);

    // 3. Submeter formulário com UTMs e Consentimento LGPD -> Deve atribuir Deal e Receita à campanha!
    const submitRes = await router.dispatch({
      method: "POST",
      path: "/api/forms/submit",
      body: {
        formId: "form-enterprise-demo",
        values: {
          firstName: "Carlos",
          lastName: "Mendes",
          email: "carlos.mendes@totvs.com.br",
          phone: "(11) 98888-1122",
          jobTitle: "Diretor de Infraestrutura",
          companyName: "TOTVS S.A.",
          estimatedValue: "180000",
          utm_source: "linkedin",
          utm_medium: "cpc",
          utm_campaign: "locacao-servidores-dell-q4",
          lgpdConsent: "true",
        },
      },
    });
    assert.equal(submitRes.status, 201);
    const subData = (submitRes.body as {
      data: {
        submission: { utmSource: string; utmCampaign: string; lgpdConsent: boolean; campaignId: string };
        contact: { lgpdConsent: boolean; subscriptionStatus: string; utmCampaign: string };
        deal: { value: number; customProperties: Record<string, unknown> };
      };
    }).data;
    assert.equal(subData.submission.utmSource, "linkedin");
    assert.equal(subData.submission.utmCampaign, "locacao-servidores-dell-q4");
    assert.equal(subData.submission.lgpdConsent, true);
    assert.equal(subData.contact.lgpdConsent, true);
    assert.equal(subData.contact.subscriptionStatus, "SUBSCRIBED");
    assert.equal(subData.deal.customProperties.utm_campaign, "locacao-servidores-dell-q4");

    const updatedCmp = repo.getMarketingCampaignById("locacao-servidores-dell-q4");
    assert.ok(updatedCmp);
    assert.equal(updatedCmp.attributedRevenueBrl, 72000 + 180000);
  });

  it("separa estritamente saída de cadência (EXIT_SEQUENCE_ONLY) de descadastro global (UNSUBSCRIBE_MARKETING), bloqueia envio a suprimidos e transfere proposta para negociação ao responder cadência", async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Camila está ativa na cadência seq-proposal-followup vinculada ao deal-vtex-automation (stage-proposal)
    const exitSeqOnlyRes = await router.dispatch({
      method: "POST",
      path: "/api/marketing/preferences",
      body: {
        contactId: "cont-camila",
        action: "EXIT_SEQUENCE_ONLY",
        reason: "Pausa operacional apenas na cadência atual",
      },
    });
    assert.equal(exitSeqOnlyRes.status, 200);
    const exitData = (exitSeqOnlyRes.body as {
      data: {
        exitedEnrollmentsCount: number;
        globalSubscriptionPreserved: boolean;
        contact: { subscriptionStatus: string };
      };
    }).data;
    assert.equal(exitData.exitedEnrollmentsCount, 1);
    assert.equal(exitData.globalSubscriptionPreserved, true);
    assert.equal(exitData.contact.subscriptionStatus, "SUBSCRIBED");
    assert.equal(repo.canSendMarketingEmailToContact("cont-camila").allowed, true);

    // 2. Descadastro de marketing (UNSUBSCRIBE_MARKETING) -> bloqueia disparo de campanha
    const unsubRes = await router.dispatch({
      method: "POST",
      path: "/api/marketing/preferences",
      body: {
        contactId: "cont-camila",
        action: "UNSUBSCRIBE_MARKETING",
        reason: "Solicitou opt-out de newsletters no Preference Center",
      },
    });
    assert.equal(unsubRes.status, 200);
    assert.equal(repo.canSendMarketingEmailToContact("cont-camila").allowed, false);

    const dispatchRes = await router.dispatch({
      method: "POST",
      path: "/api/marketing/campaigns/dispatch",
      body: {
        campaignId: "cmp-1",
        contactIds: ["cont-marina", "cont-camila", "cont-pedro-invalid"],
      },
    });
    assert.equal(dispatchRes.status, 200);
    const dispData = (dispatchRes.body as {
      data: {
        dispatchedCount: number;
        blockedSuppressedCount: number;
        deliveredContacts: Array<{ id: string }>;
        blockedContacts: Array<{ id: string }>;
      };
    }).data;
    assert.equal(dispData.dispatchedCount, 1);
    assert.equal(dispData.deliveredContacts[0].id, "cont-marina");
    assert.equal(dispData.blockedSuppressedCount, 2);

    // 3. Diferencial #1 Seta Telecom: Resposta em cadência vinculada a proposta transfere Deal para negociação
    const enrollRicardo = await router.dispatch({
      method: "POST",
      path: "/api/sequences/enroll",
      body: {
        sequenceId: "seq-proposal-followup",
        contactId: "cont-ricardo",
        dealId: "deal-totvs-erp-sync", // stage-demo
      },
    });
    assert.equal(enrollRicardo.status, 201);
    const enrId = (enrollRicardo.body as { data: { enrollment: { id: string } } }).data.enrollment.id;

    const replyRicardo = await router.dispatch({
      method: "POST",
      path: "/api/sequences/interaction",
      body: {
        enrollmentId: enrId,
        interactionType: "REPLY",
        replySnippet: "Aprovamos o escopo técnico, vamos avançar para a minuta jurídica!",
      },
    });
    assert.equal(replyRicardo.status, 200);
    const replyBody = (replyRicardo.body as {
      data: { autoPaused: boolean; dealTransferredToNegotiation: boolean; updatedDealStageId: string };
    }).data;
    assert.equal(replyBody.autoPaused, true);
    assert.equal(replyBody.dealTransferredToNegotiation, true);
    assert.equal(replyBody.updatedDealStageId, "stage-negotiation");
  });
});

describe("Fluxo de Convite de Usuário (Cadastrar Senha + 1º Login Autenticador QR Code) e Controle Admin de 2FA (Desabilitar / Resetar QR)", () => {
  it("gera convite de usuário no IAM, cadastra senha via /api/auth/accept-invite, abre QR Code no 1º login, oculta nos próximos e permite ao Admin desabilitar ou resetar o 2FA", async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const { computeRfc6238Totp } = await import("../src/app/lib/auth");

    // 1. Admin cria novo usuário no IAM -> gera inviteToken e inviteUrl com totpConfigured = false
    const createRes = await router.dispatch({
      method: "POST",
      path: "/api/admin/users",
      body: {
        name: "Fernanda Costa (Convidada)",
        email: "fernanda.costa@setatelecom.com.br",
        roleId: "VENDEDOR_SALES",
        enabledModules: ["CRM", "ERP"],
        mfaEnabled: true,
        mfaMethod: "TOTP_AUTHENTICATOR",
      },
    });
    assert.equal(createRes.status, 201);
    const created = (createRes.body as {
      data: {
        id: string;
        email: string;
        totpConfigured: boolean;
        inviteToken: string;
        inviteUrl: string;
      };
    }).data;
    assert.equal(created.totpConfigured, false);
    assert.ok(created.inviteToken.startsWith("INV-"));
    assert.ok(created.inviteUrl.includes("/login?invite="));

    // 2. Usuário abre link do convite -> GET /api/auth/invite?token=...
    const inspectRes = await router.dispatch({
      method: "GET",
      path: "/api/auth/invite",
      query: { token: created.inviteToken },
    });
    assert.equal(inspectRes.status, 200);
    const inspected = (inspectRes.body as {
      data: { user: { email: string }; totpPairing: { totpSecret: string; qrCodeSvgDataUrl: string } };
    }).data;
    assert.equal(inspected.user.email, "fernanda.costa@setatelecom.com.br");
    assert.ok(inspected.totpPairing.qrCodeSvgDataUrl.startsWith("data:image/svg+xml"));

    // 3. Usuário cadastra sua senha no convite -> POST /api/auth/accept-invite
    const acceptRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/accept-invite",
      body: {
        token: created.inviteToken,
        password: "Fernanda@2026#Password",
      },
    });
    assert.equal(acceptRes.status, 200);
    const acceptData = (acceptRes.body as {
      data: {
        passwordSaved: boolean;
        mfaRequired: boolean;
        totpConfigured: boolean;
        totpPairing?: { totpSecret: string; qrCodeSvgDataUrl: string };
      };
    }).data;
    assert.equal(acceptData.passwordSaved, true);
    assert.equal(acceptData.mfaRequired, true);
    assert.equal(acceptData.totpConfigured, false);
    assert.ok(acceptData.totpPairing?.qrCodeSvgDataUrl.startsWith("data:image/svg+xml"), "No 1º acesso após criar senha, o QR Code do autenticador deve abrir automaticamente");

    // Reutilizar o mesmo token de convite deve ser rejeitado (400)
    const reuseInviteRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/accept-invite",
      body: {
        token: created.inviteToken,
        password: "OutraSenha@2026",
      },
    });
    assert.equal(reuseInviteRes.status, 400);

    // 4. Usuário confirma o código de 6 dígitos do autenticador no 1º login -> totpConfigured passa a true
    const firstCode = computeRfc6238Totp(acceptData.totpPairing!.totpSecret).code;
    const verifyFirstRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/verify-mfa",
      body: {
        email: "fernanda.costa@setatelecom.com.br",
        code: firstCode,
        mfaMethod: "TOTP_AUTHENTICATOR",
      },
    });
    assert.equal(verifyFirstRes.status, 200);

    // No 2º login com a nova senha, totpConfigured é true e o QR Code não aparece mais
    const secondLoginRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "fernanda.costa@setatelecom.com.br",
        password: "Fernanda@2026#Password",
      },
    });
    assert.equal(secondLoginRes.status, 200);
    const secondLoginData = (secondLoginRes.body as {
      data: { mfaRequired: boolean; totpConfigured: boolean; totpPairing?: unknown };
    }).data;
    assert.equal(secondLoginData.mfaRequired, true);
    assert.equal(secondLoginData.totpConfigured, true);
    assert.equal(secondLoginData.totpPairing, undefined);

    // 5. Admin desabilita o 2FA da usuária (caso ela perca o celular) -> POST /api/admin/users/:id/reset-mfa (DISABLE_2FA)
    const disableMfaRes = await router.dispatch({
      method: "POST",
      path: `/api/admin/users/${created.id}/reset-mfa`,
      body: { mode: "DISABLE_2FA" },
    });
    assert.equal(disableMfaRes.status, 200);

    // Ao fazer login com 2FA desabilitado, entra direto na Etapa 1 (mfaRequired: false + sessionToken emitido)
    const directLoginRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "fernanda.costa@setatelecom.com.br",
        password: "Fernanda@2026#Password",
      },
    });
    assert.equal(directLoginRes.status, 200);
    const directLoginData = (directLoginRes.body as {
      data: { mfaRequired: boolean; totpConfigured: boolean; totpPairing?: { qrCodeSvgDataUrl: string } };
    }).data;
    assert.equal(directLoginData.mfaRequired, true);
    assert.equal(directLoginData.totpConfigured, false);
    assert.ok(directLoginData.totpPairing?.qrCodeSvgDataUrl.startsWith("data:image/svg+xml"));

    // 6. Admin reseta o QR Code (RESET_QR) -> reativa 2FA com totpConfigured = false para exibir QR no próximo login
    const resetQrRes = await router.dispatch({
      method: "POST",
      path: `/api/admin/users/${created.id}/reset-mfa`,
      body: { mode: "RESET_QR" },
    });
    assert.equal(resetQrRes.status, 200);

    const loginAfterResetRes = await router.dispatch({
      method: "POST",
      path: "/api/auth/login",
      body: {
        email: "fernanda.costa@setatelecom.com.br",
        password: "Fernanda@2026#Password",
      },
    });
    const loginAfterResetData = (loginAfterResetRes.body as {
      data: { mfaRequired: boolean; totpConfigured: boolean; totpPairing?: { qrCodeSvgDataUrl: string } };
    }).data;
    assert.equal(loginAfterResetData.mfaRequired, true);
    assert.equal(loginAfterResetData.totpConfigured, false);
    assert.ok(loginAfterResetData.totpPairing?.qrCodeSvgDataUrl.startsWith("data:image/svg+xml"));
  });
});

describe('15. Contratos GestãoClick: 12 ações no final do contrato (3 pontos) e Minutas por Tipo', () => {
  it('renderiza toolbar, colunas e as 12 ações do menu ⋮ para Locações, Serviços e Assinaturas', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    for (const tab of ['CTR_LOCACOES', 'CTR_SERVICOS', 'CTR_ASSINATURAS']) assert.ok(src.includes(`"${tab}"`));
    for (const label of ['+ Adicionar', 'Devoluções</span>', 'Mais ações ▾', 'Próximo vencimento', 'Periodicidade', 'contract-row-actions-menu']) {
      assert.ok(src.includes(label), `faltando: ${label}`);
    }
    const actions = ['Link de cobrança', 'Imprimir A4', 'Alterar situação', 'Enviar por e-mail', 'Enviar por WhatsApp', 'Gerar próxima fatura', 'Devolução de produtos', 'Renovar locação', 'Agendar compromisso', 'Ver no financeiro', 'Solicitar assinatura', 'Excluir'];
    assert.equal(actions.length, 12);
    for (const a of actions) assert.ok(src.includes(`label: "${a}`) || src.includes(`"${a}"`), `ação ausente: ${a}`);
    assert.ok(src.includes('printOrDownloadContractA4(ctr, modality)'));
    assert.ok(src.includes('Modelos &amp; Minutas de Contrato por Tipo'));
  });

  it('gera minutas A4 distintas para Locação (SV 31 STF, CFOP 5.908) e Serviços (LC 116/2003, NFS-e)', async () => {
    const utils = await import('../src/app/lib/contract-billing-utils');
    const { createSeedErpState } = await import('../src/modules/erp/erp-seed');
    const contracts = createSeedErpState().rentalContracts;
    const c453 = contracts.find((c) => c.contractNumber === '453');
    const c452 = contracts.find((c) => c.contractNumber === '452');
    assert.ok(c453 && c452);
    assert.equal(c453.startDate, '2026-10-09');
    assert.equal(c453.nextDueDate, '2026-12-09');
    assert.equal(c453.status, 'ATIVO');
    assert.equal(c453.monthlyValue, 750);
    assert.equal(c452.nextDueDate, '2026-11-30');
    assert.equal(c452.status, 'FATURAMENTO');
    assert.ok(c452.companyName.includes('LOCAR GUINDASTES'));

    const loc = utils.buildStandaloneContractA4Html(c453, 'LOCACAO');
    const srv = utils.buildStandaloneContractA4Html(c453, 'SERVICO');
    const ass = utils.buildStandaloneContractA4Html(c453, 'ASSINATURA');
    assert.ok(loc.includes('Contrato de Locação de Bens Móveis'));
    assert.ok(loc.includes('Súmula Vinculante 31') && loc.includes('5.908') && loc.includes('565 a 578'));
    assert.ok(!loc.includes('Lei Complementar 116/2003'));
    assert.ok(srv.includes('Contrato de Prestação de Serviços Técnicos') && srv.includes('Lei Complementar 116/2003') && srv.includes('NFS-e') && srv.includes('NOC'));
    assert.ok(!srv.includes('Súmula Vinculante 31'));
    assert.ok(ass.includes('Termo de Assinatura Recorrente') && ass.includes('renova-se automaticamente'));
    assert.ok(utils.buildStandaloneContractA4Html(c453, 'LOCACAO', 'Cláusula extra XYZ').includes('Cláusula extra XYZ'));
    assert.equal(Object.keys(utils.CONTRACT_DOCUMENT_TEMPLATES).length, 3);
  });

  it('ContractEditModal (FATURAMENTO_RECIBOS) exibe todos os novos campos de Faturamento do Contrato', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/components/ErpEditModals.tsx'), 'utf8');
    const start = src.indexOf("activeTab === 'FATURAMENTO_RECIBOS'");
    assert.ok(start > 0);
    const fields = ['customerPurchaseOrderNumber', 'measurementNumber', 'measurementPeriod', 'customDueRuleEnabled', 'customDueOffsetDays', 'customDueTargetWeekday', 'billingRecipientEmails', 'costCenter', 'chartOfAccounts', 'paymentMethod', 'additionValueBrl', 'discountValueBrl', 'freightValueBrl', 'deliveryCity', 'deliveryCarrier', 'downloadInvoicePdfOnDemand'];
    for (const f of fields) assert.ok(src.includes(f), `campo ausente: ${f}`);
    assert.ok(src.includes('renderContractDataBlock()'));
    const tab = fs.readFileSync(path.join(process.cwd(), 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    assert.ok(tab.includes('invoices={invoices}'));
    assert.ok(tab.includes("setEditingContractTab('FATURAMENTO_RECIBOS')"));
  });
});

describe('16. Evoluções de Contratos, Faturamento, Recorrência, Regras Customizadas, Versionamento e 1 Página A4 (28/10/2026)', () => {
  it('calcula regras customizadas de vencimento ("45 dias + próxima quarta-feira" e "30 dias + próxima quinta-feira") com precisão', async () => {
    const { computeCustomDueDateFromRule } = await import('../src/db/repository');
    // 2026-10-28 (quarta-feira) + 45 dias = 2026-12-12 (sábado) -> próxima quarta-feira = 2026-12-16
    const r45Wed = computeCustomDueDateFromRule({
      baseDate: '2026-10-28',
      offsetDays: 45,
      targetWeekday: 'WEDNESDAY',
    });
    assert.equal(r45Wed.afterOffsetDateIso, '2026-12-12');
    assert.equal(r45Wed.dueDateIso, '2026-12-16');
    assert.equal(r45Wed.dueDateBr, '16/12/2026');
    assert.equal(r45Wed.weekdayLabelPt, 'Quarta-feira');
    assert.equal(r45Wed.ruleLabel, '45 dias + próxima quarta-feira');

    // 2026-10-28 + 30 dias = 2026-11-27 (sexta-feira) -> próxima quinta-feira = 2026-12-03
    const r30Thu = computeCustomDueDateFromRule({
      baseDate: '2026-10-28',
      offsetDays: 30,
      targetWeekday: 'THURSDAY',
    });
    assert.equal(r30Thu.afterOffsetDateIso, '2026-11-27');
    assert.equal(r30Thu.dueDateIso, '2026-12-03');
    assert.equal(r30Thu.dueDateBr, '03/12/2026');
    assert.equal(r30Thu.weekdayLabelPt, 'Quinta-feira');
    assert.equal(r30Thu.ruleLabel, '30 dias + próxima quinta-feira');
  });

  it('versiona contratos automaticamente em JSON leve (0 MB PDF), restaura versões e imprime Recibo de Locação em 1 Página A4 Única', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    // 1. Atualizar contrato ctr-loc-453 com novos dados GestãoClick -> incrementa versão e grava versionHistory
    const patchRes = await router.dispatch({
      method: 'PATCH',
      path: '/api/erp/rental-contracts/ctr-loc-453',
      body: {
        monthlyValue: 920,
        customerPurchaseOrderNumber: 'PO-FORTIS-999',
        measurementNumber: 'BM-12/2026-453',
        paymentMethod: 'Boleto Inter',
        customDueRuleEnabled: true,
        customDueOffsetDays: 45,
        customDueTargetWeekday: 'WEDNESDAY',
        customDueRuleLabel: '45 dias + próxima quarta-feira',
      },
    });
    assert.equal(patchRes.status, 200);
    const updatedCtr = (patchRes.body as { data: { version: number; versionLabel: string; monthlyValue: number } }).data;
    assert.ok(updatedCtr.version >= 2);

    // 2. Consultar histórico de versões do contrato
    const verRes = await router.dispatch({
      method: 'GET',
      path: '/api/erp/rental-contracts/ctr-loc-453/versions',
    });
    assert.equal(verRes.status, 200);
    const versions = (verRes.body as { data: Array<{ versionNumber: number; versionLabel: string; changedFields: string[] }> }).data;
    assert.ok(versions.length >= 2);

    // 3. Restaurar versão v1.0
    const restoreRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/rental-contracts/ctr-loc-453/restore-version',
      body: { targetVersion: 1, restoredBy: 'Marcelo Mira' },
    });
    assert.equal(restoreRes.status, 200);

    // 4. Gerar fatura a partir do contrato propagando PO, Medição, Regra de Vencimento e dados GestãoClick
    const genInvRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/rental-contracts/ctr-loc-453/generate-invoice',
      body: {
        competenceMonth: '12/2026',
        issueDate: '2026-10-28',
        customDueRuleEnabled: true,
        customDueOffsetDays: 45,
        customDueTargetWeekday: 'WEDNESDAY',
        customerPurchaseOrderNumber: 'PED-CLI-2026-4654',
        measurementNumber: 'BM-12/2026-453',
      },
    });
    assert.equal(genInvRes.status, 201);
    const genInv = (genInvRes.body as {
      data: {
        dueDate: string;
        customDueRuleLabel: string;
        customerPurchaseOrderNumber: string;
        measurementNumber: string;
        sellerName: string;
        costCenter: string;
        chartOfAccounts: string;
      };
    }).data;
    assert.equal(genInv.dueDate, '2026-12-16');
    assert.equal(genInv.customDueRuleLabel, '45 dias + próxima quarta-feira');
    assert.equal(genInv.customerPurchaseOrderNumber, 'PED-CLI-2026-4654');
    assert.equal(genInv.measurementNumber, 'BM-12/2026-453');
    assert.equal(genInv.sellerName, 'Marcelo Mira');
    assert.equal(genInv.costCenter, 'LOCAÇÃO DE EQUIPAMENTO');
    assert.equal(genInv.chartOfAccounts, 'Locação de equipamento');

    // 5. Verificar que o HTML de impressão da Fatura/Recibo de Locação está configurado para 1 única página A4
    const utils = await import('../src/app/lib/contract-billing-utils');
    const html = utils.buildPrintableRentalInvoiceHtml(genInv as never);
    assert.ok(html.includes('@page { size: A4 portrait; margin: 7mm; }'));
    assert.ok(html.includes('max-height: 282mm;'));
    assert.ok(html.includes('1 Página A4 Única'));
  });

  it('gera o RASCUNHO do recibo (Visualizar recibo) idêntico ao final, com marca d\'água e sem efeitos colaterais', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const utils = await import('../src/app/lib/contract-billing-utils');
    const contract = repo.listRentalContracts().find((c) => c.id === 'ctr-loc-453');
    assert.ok(contract);
    const invoicesBefore = repo.listInvoices().length;
    const opts = {
      competenceMonth: '12/2026',
      issueDate: '2026-10-28',
      customDueRuleEnabled: true,
      customDueOffsetDays: 45,
      customDueTargetWeekday: 'WEDNESDAY' as const,
      customerPurchaseOrderNumber: 'PED-CLI-2026-4654',
      measurementNumber: 'BM-12/2026-453',
    };
    const { invoice: draftInv, html } = utils.buildDraftReceiptHtml(contract!, opts, invoicesBefore);
    // Nenhuma fatura criada pela pré-visualização
    assert.equal(repo.listInvoices().length, invoicesBefore);
    assert.ok(html.includes('RASCUNHO — NÃO É DOCUMENTO FISCAL / pré-visualização'));
    assert.ok(html.includes('@page { size: A4 portrait; margin: 7mm; }'));
    assert.ok(draftInv.documentNumber.startsWith('RASCUNHO-FAT-LOC-'));
    assert.ok(!html.includes('34191.79001'));

    // Finalizar pelo fluxo existente gera fatura com mesmos valores/vencimento do rascunho
    const genRes = await router.dispatch({ method: 'POST', path: '/api/erp/rental-contracts/ctr-loc-453/generate-invoice', body: opts });
    assert.equal(genRes.status, 201);
    const finalInv = (genRes.body as { data: { dueDate: string; netAmount: number; grossAmount: number; customerPurchaseOrderNumber: string; documentNumber: string } }).data;
    assert.equal(draftInv.dueDate, finalInv.dueDate);
    assert.equal(draftInv.netAmount, finalInv.netAmount);
    assert.equal(draftInv.grossAmount, finalInv.grossAmount);
    assert.equal(draftInv.customerPurchaseOrderNumber, finalInv.customerPurchaseOrderNumber);
    assert.equal(draftInv.documentNumber.replace('RASCUNHO-', ''), finalInv.documentNumber);
  });
});
