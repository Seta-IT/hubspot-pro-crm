// ============================================================================
// Data Health & Hygiene - Global Health Summary, Merge & Auto-Clean Service
// ============================================================================

import { CrmRepository } from '../../db/repository';
import {
  Company,
  Contact,
  DataHealthIssue,
  Deal,
  SuggestedMergePlan,
  TimelineEvent,
} from '../../db/types';
import { calculateCompanyCompleteness, calculateContactCompleteness } from './completeness';
import {
  buildCompanyMergePlan,
  buildContactMergePlan,
  detectDuplicateCompanies,
  detectDuplicateContacts,
  haveConflictingCnpjs,
} from './deduplication';
import { normalizeAndValidatePhone, normalizeCorporateDomain, validateEmail } from './validators';
import { EnrichmentService } from '../enrichment/enrichment-service';

export interface RottingDealReport {
  dealId: string;
  title: string;
  value: number;
  stageId: string;
  stageName: string;
  daysSinceLastActivity: number;
  dealRottingDays: number;
  daysOverdue: number;
  contactId: string | null;
  companyId: string | null;
}

export interface StaleRecordReport {
  entityType: 'CONTACT' | 'COMPANY';
  entityId: string;
  name: string;
  emailOrDomain: string | null;
  daysInactive: number;
  lastActivityAt: string | null;
}

export interface DataHealthSummaryReport {
  globalHealthScore: number;
  statusLabel: 'EXCELLENT' | 'GOOD' | 'ATTENTION' | 'CRITICAL';
  breakdown: {
    completenessHealth: number;
    validityHealth: number;
    deduplicationHealth: number;
    freshnessHealth: number;
  };
  counts: {
    totalContacts: number;
    totalCompanies: number;
    totalOpenDeals: number;
    duplicateContactsCount: number;
    duplicateCompaniesCount: number;
    incompleteContactsCount: number;
    incompleteCompaniesCount: number;
    invalidEmailsCount: number;
    invalidPhonesCount: number;
    staleRecordsCount: number;
    rottingDealsCount: number;
    totalOpenIssues: number;
  };
  rottingDeals: RottingDealReport[];
  staleRecords: StaleRecordReport[];
  issues: DataHealthIssue[];
  recommendations: string[];
  generatedAt: string;
}

export interface MergeExecutionResult {
  success: boolean;
  entityType: 'CONTACT' | 'COMPANY';
  primaryId: string;
  removedDuplicateId: string;
  mergedRecord: Contact | Company;
  timelineEventsMoved: number;
  dealsMoved: number;
  contactsMoved: number;
  auditEvent: TimelineEvent;
  mergePlanUsed: SuggestedMergePlan;
}

export interface AutoCleanResult {
  previousHealthScore: number;
  newHealthScore: number;
  contactsMerged: number;
  companiesMerged: number;
  recordsNormalized: number;
  recordsEnriched: number;
  mergeResults: MergeExecutionResult[];
  summary: DataHealthSummaryReport;
}

export class DataHealthService {
  private enrichmentService = new EnrichmentService();

  generateHealthSummary(repo: CrmRepository): DataHealthSummaryReport {
    const contacts = repo.listContacts();
    const companies = repo.listCompanies();
    const deals = repo.listDeals();
    const pipelines = repo.listPipelines();
    const timelineEvents = repo.listTimelineEvents();

    const nowMs = Date.now();
    const issues: DataHealthIssue[] = [];

    // 1. Detect Duplicate Contacts & Companies
    const dupContacts = detectDuplicateContacts(contacts, deals, timelineEvents);
    const dupCompanies = detectDuplicateCompanies(companies, contacts, deals, timelineEvents);

    for (const pair of dupContacts) {
      issues.push({
        id: `iss-dup-cont-${pair.primary.id}-${pair.duplicate.id}`,
        issueType: 'DUPLICATE_CONTACT',
        severity: pair.confidenceScore >= 90 ? 'HIGH' : 'MEDIUM',
        entityType: 'CONTACT',
        primaryEntityId: pair.primary.id,
        duplicateEntityId: pair.duplicate.id,
        confidenceScore: pair.confidenceScore,
        title: `Contato duplicado detectado: ${pair.primary.firstName} ${pair.primary.lastName}`,
        description: pair.matchReasons.join(' | '),
        suggestedMerge: pair.suggestedMerge,
        status: 'OPEN',
        detectedAt: new Date().toISOString(),
      });
    }

    for (const pair of dupCompanies) {
      issues.push({
        id: `iss-dup-comp-${pair.primary.id}-${pair.duplicate.id}`,
        issueType: 'DUPLICATE_COMPANY',
        severity: pair.confidenceScore >= 90 ? 'HIGH' : 'MEDIUM',
        entityType: 'COMPANY',
        primaryEntityId: pair.primary.id,
        duplicateEntityId: pair.duplicate.id,
        confidenceScore: pair.confidenceScore,
        title: `Empresa duplicada detectada: ${pair.primary.name} vs ${pair.duplicate.name}`,
        description: pair.matchReasons.join(' | '),
        suggestedMerge: pair.suggestedMerge,
        status: 'OPEN',
        detectedAt: new Date().toISOString(),
      });
    }

    // 2. Validate Emails, Phones, Completeness & Stale Contacts (>90 days)
    let invalidEmailsCount = 0;
    let invalidPhonesCount = 0;
    let incompleteContactsCount = 0;
    const staleRecords: StaleRecordReport[] = [];

    for (const contact of contacts) {
      const emailCheck = validateEmail(contact.email);
      if (!emailCheck.isValid) {
        invalidEmailsCount++;
        issues.push({
          id: `iss-email-${contact.id}`,
          issueType: 'INVALID_EMAIL',
          severity: 'HIGH',
          entityType: 'CONTACT',
          primaryEntityId: contact.id,
          duplicateEntityId: null,
          confidenceScore: 100,
          title: `E-mail inválido ou descartável: ${contact.email}`,
          description: `Motivo: ${emailCheck.reason || 'Formato inválido'} (${contact.firstName} ${contact.lastName})`,
          suggestedMerge: null,
          status: 'OPEN',
          detectedAt: new Date().toISOString(),
        });
      }

      if (contact.phone) {
        const phoneCheck = normalizeAndValidatePhone(contact.phone);
        if (!phoneCheck.isValid) {
          invalidPhonesCount++;
          issues.push({
            id: `iss-phone-${contact.id}`,
            issueType: 'INVALID_PHONE',
            severity: 'MEDIUM',
            entityType: 'CONTACT',
            primaryEntityId: contact.id,
            duplicateEntityId: null,
            confidenceScore: 100,
            title: `Telefone fora do padrão E.164: ${contact.phone}`,
            description: `Motivo: ${phoneCheck.reason || 'Formato inválido'} (${contact.firstName} ${contact.lastName})`,
            suggestedMerge: null,
            status: 'OPEN',
            detectedAt: new Date().toISOString(),
          });
        }
      }

      const compCheck = calculateContactCompleteness(contact);
      if (compCheck.score < 65) {
        incompleteContactsCount++;
        issues.push({
          id: `iss-inc-cont-${contact.id}`,
          issueType: 'MISSING_CRITICAL_FIELDS',
          severity: compCheck.score < 45 ? 'HIGH' : 'MEDIUM',
          entityType: 'CONTACT',
          primaryEntityId: contact.id,
          duplicateEntityId: null,
          confidenceScore: 100,
          title: `Contato com baixa completude (${compCheck.score}%): ${contact.firstName} ${contact.lastName}`,
          description: `Campos ausentes: ${compCheck.missingFields.join(', ')}`,
          suggestedMerge: null,
          status: 'OPEN',
          detectedAt: new Date().toISOString(),
        });
      }

      const lastTouch = contact.lastActivityAt || contact.updatedAt || contact.createdAt;
      const daysInactive = Math.floor((nowMs - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24));
      if (daysInactive > 90) {
        staleRecords.push({
          entityType: 'CONTACT',
          entityId: contact.id,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          emailOrDomain: contact.email,
          daysInactive,
          lastActivityAt: contact.lastActivityAt,
        });
        issues.push({
          id: `iss-stale-cont-${contact.id}`,
          issueType: 'STALE_RECORD',
          severity: 'LOW',
          entityType: 'CONTACT',
          primaryEntityId: contact.id,
          duplicateEntityId: null,
          confidenceScore: 100,
          title: `Contato obsoleto (${daysInactive} dias sem interação): ${contact.firstName} ${contact.lastName}`,
          description: `Última atividade registrada há ${daysInactive} dias (> 90 dias).`,
          suggestedMerge: null,
          status: 'OPEN',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 3. Companies Completeness & Stale check
    let incompleteCompaniesCount = 0;
    for (const comp of companies) {
      const compScore = calculateCompanyCompleteness(comp);
      if (compScore.score < 65) {
        incompleteCompaniesCount++;
        issues.push({
          id: `iss-inc-comp-${comp.id}`,
          issueType: 'MISSING_CRITICAL_FIELDS',
          severity: 'MEDIUM',
          entityType: 'COMPANY',
          primaryEntityId: comp.id,
          duplicateEntityId: null,
          confidenceScore: 100,
          title: `Empresa incompleta (${compScore.score}%): ${comp.name}`,
          description: `Campos ausentes: ${compScore.missingFields.join(', ')}`,
          suggestedMerge: null,
          status: 'OPEN',
          detectedAt: new Date().toISOString(),
        });
      }

      const lastTouch = comp.lastActivityAt || comp.updatedAt || comp.createdAt;
      const daysInactive = Math.floor((nowMs - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24));
      if (daysInactive > 90) {
        staleRecords.push({
          entityType: 'COMPANY',
          entityId: comp.id,
          name: comp.name,
          emailOrDomain: comp.domain,
          daysInactive,
          lastActivityAt: comp.lastActivityAt,
        });
      }
    }

    // 4. Deal Rotting / Stagnant Deals
    const stageMap = new Map<string, { name: string; dealRottingDays: number }>();
    for (const p of pipelines) {
      for (const s of p.stages) {
        stageMap.set(s.id, { name: s.name, dealRottingDays: s.dealRottingDays });
      }
    }

    const openDeals = deals.filter((d) => d.status === 'OPEN');
    const rottingDeals: RottingDealReport[] = [];

    for (const deal of openDeals) {
      const stageInfo = stageMap.get(deal.stageId) || { name: deal.stageId, dealRottingDays: 14 };
      const lastTouch = deal.lastActivityAt || deal.stageEnteredAt || deal.updatedAt;
      const daysSince = Math.floor((nowMs - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince > stageInfo.dealRottingDays) {
        const overdue = daysSince - stageInfo.dealRottingDays;
        rottingDeals.push({
          dealId: deal.id,
          title: deal.title,
          value: deal.value,
          stageId: deal.stageId,
          stageName: stageInfo.name,
          daysSinceLastActivity: daysSince,
          dealRottingDays: stageInfo.dealRottingDays,
          daysOverdue: overdue,
          contactId: deal.contactId,
          companyId: deal.companyId,
        });

        issues.push({
          id: `iss-rotting-deal-${deal.id}`,
          issueType: 'STALE_RECORD',
          severity: deal.value >= 150000 ? 'HIGH' : 'MEDIUM',
          entityType: 'DEAL',
          primaryEntityId: deal.id,
          duplicateEntityId: null,
          confidenceScore: 100,
          title: `Negócio estagnado (Deal Rotting): ${deal.title}`,
          description: `${daysSince} dias sem interação na etapa "${stageInfo.name}" (limite: ${stageInfo.dealRottingDays} dias). Valor em risco: R$ ${deal.value.toLocaleString('pt-BR')}.`,
          suggestedMerge: null,
          status: 'OPEN',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Save issues in repository
    repo.setDataHealthIssues(issues);

    // 5. Calculate Sub-Scores & Global Health Score (0-100)
    const avgContactCompleteness =
      contacts.length > 0
        ? contacts.reduce((acc, c) => acc + calculateContactCompleteness(c).score, 0) / contacts.length
        : 100;
    const avgCompanyCompleteness =
      companies.length > 0
        ? companies.reduce((acc, c) => acc + calculateCompanyCompleteness(c).score, 0) / companies.length
        : 100;
    const completenessHealth = Math.round(avgContactCompleteness * 0.65 + avgCompanyCompleteness * 0.35);

    const totalValidated = Math.max(1, contacts.length);
    const invalidRatio = (invalidEmailsCount + invalidPhonesCount * 0.7) / totalValidated;
    const validityHealth = Math.max(0, Math.min(100, Math.round((1 - invalidRatio) * 100)));

    const totalEntities = Math.max(1, contacts.length + companies.length);
    const dupCount = dupContacts.length + dupCompanies.length;
    const deduplicationHealth = Math.max(
      0,
      Math.min(100, Math.round((1 - (dupCount * 1.8) / totalEntities) * 100))
    );

    const rottingRatio = openDeals.length > 0 ? rottingDeals.length / openDeals.length : 0;
    const staleRatio = totalEntities > 0 ? staleRecords.length / totalEntities : 0;
    const freshnessHealth = Math.max(
      0,
      Math.min(100, Math.round((1 - (rottingRatio * 0.6 + staleRatio * 0.4)) * 100))
    );

    const globalHealthScore = Math.round(
      completenessHealth * 0.3 +
        validityHealth * 0.25 +
        deduplicationHealth * 0.25 +
        freshnessHealth * 0.2
    );

    const statusLabel: DataHealthSummaryReport['statusLabel'] =
      globalHealthScore >= 85
        ? 'EXCELLENT'
        : globalHealthScore >= 70
          ? 'GOOD'
          : globalHealthScore >= 50
            ? 'ATTENTION'
            : 'CRITICAL';

    const recommendations: string[] = [];
    if (dupContacts.length > 0 || dupCompanies.length > 0) {
      recommendations.push(
        `Unificar ${dupContacts.length} par(es) de contatos e ${dupCompanies.length} par(es) de empresas duplicadas com alta confiança.`
      );
    }
    if (rottingDeals.length > 0) {
      const totalRottingValue = rottingDeals.reduce((sum, d) => sum + d.value, 0);
      recommendations.push(
        `Priorizar follow-up imediato em ${rottingDeals.length} negócio(s) estagnado(s) somando R$ ${totalRottingValue.toLocaleString('pt-BR')}.`
      );
    }
    if (incompleteContactsCount > 0) {
      recommendations.push(
        `Executar o Motor de Enriquecimento em ${incompleteContactsCount} contato(s) com completude abaixo de 65%.`
      );
    }
    if (invalidEmailsCount > 0 || invalidPhonesCount > 0) {
      recommendations.push(
        `Corrigir ou remover ${invalidEmailsCount} e-mail(s) descartável(is)/inválido(s) e ${invalidPhonesCount} telefone(s) fora do padrão E.164.`
      );
    }
    if (staleRecords.length > 0) {
      recommendations.push(
        `Acionar campanha de reengajamento ou arquivamento para ${staleRecords.length} registro(s) sem atividade há mais de 90 dias.`
      );
    }

    return {
      globalHealthScore,
      statusLabel,
      breakdown: {
        completenessHealth,
        validityHealth,
        deduplicationHealth,
        freshnessHealth,
      },
      counts: {
        totalContacts: contacts.length,
        totalCompanies: companies.length,
        totalOpenDeals: openDeals.length,
        duplicateContactsCount: dupContacts.length,
        duplicateCompaniesCount: dupCompanies.length,
        incompleteContactsCount,
        incompleteCompaniesCount,
        invalidEmailsCount,
        invalidPhonesCount,
        staleRecordsCount: staleRecords.length,
        rottingDealsCount: rottingDeals.length,
        totalOpenIssues: issues.length,
      },
      rottingDeals,
      staleRecords,
      issues,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  mergeRecords(
    repo: CrmRepository,
    params: {
      entityType: 'CONTACT' | 'COMPANY';
      primaryId: string;
      duplicateId: string;
      fieldOverrides?: Record<string, unknown>;
    }
  ): MergeExecutionResult {
    const state = repo.getState();

    if (params.entityType === 'CONTACT') {
      const primary = repo.getContactById(params.primaryId);
      const duplicate = repo.getContactById(params.duplicateId);
      if (!primary || !duplicate) {
        throw new Error(`Contato primário (${params.primaryId}) ou duplicado (${params.duplicateId}) não encontrado.`);
      }

      const plan = buildContactMergePlan(
        primary,
        duplicate,
        ['Merge inteligente executado'],
        95,
        state.deals,
        state.timelineEvents
      );

      const finalFields = {
        ...plan.mergedFields,
        ...(params.fieldOverrides || {}),
      } as Partial<Contact>;

      // Reassign timeline events from duplicate to primary
      let timelineEventsMoved = 0;
      for (const evt of state.timelineEvents) {
        if (evt.contactId === duplicate.id) {
          evt.contactId = primary.id;
          timelineEventsMoved++;
        }
      }

      // Reassign deals from duplicate to primary
      let dealsMoved = 0;
      for (const deal of state.deals) {
        if (deal.contactId === duplicate.id) {
          deal.contactId = primary.id;
          dealsMoved++;
        }
      }

      // Reassign sequence enrollments
      for (const enr of state.sequenceEnrollments) {
        if (enr.contactId === duplicate.id) {
          enr.contactId = primary.id;
        }
      }

      // Update primary record
      const updatedPrimary = repo.updateContact(primary.id, finalFields);
      if (!updatedPrimary) {
        throw new Error('Falha ao atualizar contato primário durante o merge.');
      }

      // Remove duplicate record
      repo.deleteContact(duplicate.id);

      // Mark matching health issues as MERGED
      for (const issue of state.dataHealthIssues) {
        if (
          (issue.primaryEntityId === primary.id && issue.duplicateEntityId === duplicate.id) ||
          (issue.primaryEntityId === duplicate.id && issue.duplicateEntityId === primary.id)
        ) {
          issue.status = 'MERGED';
          issue.resolvedAt = new Date().toISOString();
        }
      }

      // Record audit timeline event
      const auditEvent = repo.createTimelineEvent({
        type: 'HEALTH_ALERT',
        title: `Merge inteligente concluído: ${duplicate.firstName} ${duplicate.lastName} -> ${updatedPrimary.firstName} ${updatedPrimary.lastName}`,
        body: `Histórico unificado sem perda de dados (${timelineEventsMoved} evento(s) e ${dealsMoved} negócio(s) preservados).`,
        contactId: updatedPrimary.id,
        companyId: updatedPrimary.companyId,
        metadata: {
          mergedFromId: duplicate.id,
          mergedFromEmail: duplicate.email,
          timelineEventsMoved,
          dealsMoved,
        },
        actor: 'Motor Data Health',
      });

      return {
        success: true,
        entityType: 'CONTACT',
        primaryId: updatedPrimary.id,
        removedDuplicateId: duplicate.id,
        mergedRecord: updatedPrimary,
        timelineEventsMoved,
        dealsMoved,
        contactsMoved: 0,
        auditEvent,
        mergePlanUsed: plan,
      };
    }

    // COMPANY MERGE
    const primaryComp = repo.getCompanyById(params.primaryId);
    const duplicateComp = repo.getCompanyById(params.duplicateId);
    if (!primaryComp || !duplicateComp) {
      throw new Error(`Empresa primária (${params.primaryId}) ou duplicada (${params.duplicateId}) não encontrada.`);
    }
    if (haveConflictingCnpjs(primaryComp.cnpj, duplicateComp.cnpj)) {
      throw new Error(
        `Bloqueio Fiscal: Empresas com CNPJs diferentes (${primaryComp.cnpj} vs ${duplicateComp.cnpj}) não podem ser unificadas (cada CNPJ possui personalidade jurídica e faturamento próprios).`
      );
    }

    const plan = buildCompanyMergePlan(
      primaryComp,
      duplicateComp,
      ['Merge inteligente de empresas executado'],
      98,
      state.contacts,
      state.deals,
      state.timelineEvents
    );

    const finalFields = {
      ...plan.mergedFields,
      ...(params.fieldOverrides || {}),
    } as Partial<Company>;

    let timelineEventsMoved = 0;
    for (const evt of state.timelineEvents) {
      if (evt.companyId === duplicateComp.id) {
        evt.companyId = primaryComp.id;
        timelineEventsMoved++;
      }
    }

    let dealsMoved = 0;
    for (const deal of state.deals) {
      if (deal.companyId === duplicateComp.id) {
        deal.companyId = primaryComp.id;
        dealsMoved++;
      }
    }

    let contactsMoved = 0;
    for (const contact of state.contacts) {
      if (contact.companyId === duplicateComp.id) {
        contact.companyId = primaryComp.id;
        contactsMoved++;
      }
    }

    const updatedCompany = repo.updateCompany(primaryComp.id, finalFields);
    if (!updatedCompany) {
      throw new Error('Falha ao atualizar empresa primária durante o merge.');
    }

    repo.deleteCompany(duplicateComp.id);

    for (const issue of state.dataHealthIssues) {
      if (
        (issue.primaryEntityId === primaryComp.id && issue.duplicateEntityId === duplicateComp.id) ||
        (issue.primaryEntityId === duplicateComp.id && issue.duplicateEntityId === primaryComp.id)
      ) {
        issue.status = 'MERGED';
        issue.resolvedAt = new Date().toISOString();
      }
    }

    const auditEvent = repo.createTimelineEvent({
      type: 'HEALTH_ALERT',
      title: `Merge de empresas concluído: ${duplicateComp.name} -> ${updatedCompany.name}`,
      body: `Unificados ${contactsMoved} contato(s), ${dealsMoved} negócio(s) e ${timelineEventsMoved} evento(s) de timeline.`,
      companyId: updatedCompany.id,
      metadata: {
        mergedFromId: duplicateComp.id,
        contactsMoved,
        dealsMoved,
        timelineEventsMoved,
      },
      actor: 'Motor Data Health',
    });

    return {
      success: true,
      entityType: 'COMPANY',
      primaryId: updatedCompany.id,
      removedDuplicateId: duplicateComp.id,
      mergedRecord: updatedCompany,
      timelineEventsMoved,
      dealsMoved,
      contactsMoved,
      auditEvent,
      mergePlanUsed: plan,
    };
  }

  /**
   * Higienização automática em lote:
   * - Unifica duplicados de contatos e empresas com confiança >= minConfidence (padrão 80)
   * - Padroniza telefones E.164 e domínios corporativos
   * - Enriquece contatos corporativos incompletos
   */
  autoCleanDatabase(
    repo: CrmRepository,
    options: { minConfidence?: number; autoEnrich?: boolean } = {}
  ): AutoCleanResult {
    const minConfidence = options.minConfidence ?? 80;
    const autoEnrich = options.autoEnrich !== false;

    const beforeReport = this.generateHealthSummary(repo);
    const mergeResults: MergeExecutionResult[] = [];
    let contactsMerged = 0;
    let companiesMerged = 0;
    let recordsNormalized = 0;
    let recordsEnriched = 0;

    // 1. Auto-merge high-confidence company duplicates first
    const companyDups = detectDuplicateCompanies(
      repo.listCompanies(),
      repo.listContacts(),
      repo.listDeals(),
      repo.listTimelineEvents()
    );
    const mergedCompanyIds = new Set<string>();
    for (const pair of companyDups) {
      if (
        pair.confidenceScore >= minConfidence &&
        !mergedCompanyIds.has(pair.primary.id) &&
        !mergedCompanyIds.has(pair.duplicate.id)
      ) {
        const res = this.mergeRecords(repo, {
          entityType: 'COMPANY',
          primaryId: pair.primary.id,
          duplicateId: pair.duplicate.id,
        });
        mergeResults.push(res);
        mergedCompanyIds.add(pair.duplicate.id);
        companiesMerged++;
      }
    }

    // 2. Auto-merge high-confidence contact duplicates
    const contactDups = detectDuplicateContacts(
      repo.listContacts(),
      repo.listDeals(),
      repo.listTimelineEvents()
    );
    const mergedContactIds = new Set<string>();
    for (const pair of contactDups) {
      if (
        pair.confidenceScore >= minConfidence &&
        !mergedContactIds.has(pair.primary.id) &&
        !mergedContactIds.has(pair.duplicate.id)
      ) {
        const res = this.mergeRecords(repo, {
          entityType: 'CONTACT',
          primaryId: pair.primary.id,
          duplicateId: pair.duplicate.id,
        });
        mergeResults.push(res);
        mergedContactIds.add(pair.duplicate.id);
        contactsMerged++;
      }
    }

    // 3. Normalize phones & domains + enrich incomplete corporate contacts
    for (const contact of repo.listContacts()) {
      let changed = false;
      if (contact.phone) {
        const pVal = normalizeAndValidatePhone(contact.phone);
        if (pVal.isValid && pVal.formatted && contact.phone !== pVal.formatted) {
          repo.updateContact(contact.id, {
            phone: pVal.formatted,
            normalizedPhone: pVal.e164,
            isValidPhone: true,
          });
          changed = true;
        }
      }

      if (autoEnrich && contact.completenessScore < 85) {
        const enr = this.enrichmentService.enrichContactRecord(
          contact,
          repo.listCompanies(),
          repo.listDeals(),
          repo.listTimelineEvents()
        );
        if (enr.isNewCompany && enr.matchedOrCreatedCompany) {
          repo.createCompany(enr.matchedOrCreatedCompany);
        } else if (enr.matchedOrCreatedCompany && enr.companyFieldsUpdated.length > 0) {
          repo.updateCompany(enr.matchedOrCreatedCompany.id, enr.matchedOrCreatedCompany);
        }
        if (enr.fieldsUpdated.length > 0) {
          repo.updateContact(contact.id, enr.contact);
          recordsEnriched++;
        }
      }

      if (changed) recordsNormalized++;
    }

    for (const company of repo.listCompanies()) {
      if (company.domain) {
        const dVal = normalizeCorporateDomain(company.domain);
        if (dVal.isValid && dVal.domain && company.domain !== dVal.domain) {
          repo.updateCompany(company.id, { domain: dVal.domain });
          recordsNormalized++;
        }
      }
    }

    const afterReport = this.generateHealthSummary(repo);

    return {
      previousHealthScore: beforeReport.globalHealthScore,
      newHealthScore: afterReport.globalHealthScore,
      contactsMerged,
      companiesMerged,
      recordsNormalized,
      recordsEnriched,
      mergeResults,
      summary: afterReport,
    };
  }
}
