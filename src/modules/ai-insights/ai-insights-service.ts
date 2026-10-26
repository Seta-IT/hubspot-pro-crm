// ============================================================================
// AI Revenue & Database Insights Engine - Funnel Bottlenecks, Deal Risk,
// Revenue Forecast, Priority Follow-ups & Hidden Opportunities (CRM + ERP)
// ============================================================================

import { CrmRepository } from '../../db/repository';
import { DataHealthService } from '../data-health/health-service';

export interface FunnelBottleneckItem {
  stageId: string;
  stageName: string;
  order: number;
  defaultProbability: number;
  dealCount: number;
  totalValue: number;
  weightedValue: number;
  conversionRateToNext: number;
  avgDaysInStage: number;
  dealRottingDays: number;
  rottingDealCount: number;
  stagnantValue: number;
  isBottleneck: boolean;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  diagnosis: string;
  recommendation: string;
}

export interface AtRiskDealItem {
  dealId: string;
  title: string;
  value: number;
  stageId: string;
  stageName: string;
  probability: number;
  contactId: string | null;
  companyId: string | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  daysSinceLastActivity: number;
  daysInCurrentStage: number;
  dealRottingDays: number;
  riskScore: number; // 0 to 100
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  recommendedAction: string;
}

export interface RevenueForecastSummary {
  currency: string;
  totalOpenPipelineValue: number;
  weightedPipelineValue: number;
  closedWonValue: number;
  closedLostValue: number;
  committedForecast: number; // Closed Won + Open Deals with prob >= 80%
  optimisticForecast: number; // Closed Won + Weighted Pipeline * 1.18
  conservativeForecast: number; // Closed Won + Weighted High-Health Deals
  winRate: number;
  averageDealSize: number;
  byStage: Array<{
    stageId: string;
    stageName: string;
    dealCount: number;
    totalValue: number;
    weightedValue: number;
  }>;
}

export interface PriorityFollowUpItem {
  id: string;
  priorityScore: number; // 0 to 100
  urgency: 'IMMEDIATE' | 'TODAY' | 'THIS_WEEK';
  entityType: 'DEAL' | 'CONTACT';
  dealId: string | null;
  contactId: string | null;
  companyName: string | null;
  contactName: string;
  contactRole: string | null;
  title: string;
  value: number;
  reason: string;
  suggestedChannel: 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING';
  suggestedMessage: string;
}

export interface HiddenOpportunityItem {
  id: string;
  opportunityType: 'HIGH_SCORE_SQL_NO_DEAL' | 'ENRICHED_ENTERPRISE_NO_DEAL' | 'REPLIED_SEQUENCE_WARM_LEAD';
  entityType: 'CONTACT' | 'COMPANY';
  entityId: string;
  name: string;
  companyName: string | null;
  leadScore: number;
  estimatedDealValue: number;
  reason: string;
  suggestedAction: string;
}

export interface AiInsightsReport {
  executiveSummary: {
    headline: string;
    aiConfidenceScore: number;
    revenueAtRisk: number;
    unlockableRevenue: number;
    keyTakeaways: string[];
  };
  funnelBottlenecks: FunnelBottleneckItem[];
  atRiskDeals: AtRiskDealItem[];
  revenueForecast: RevenueForecastSummary;
  priorityFollowUps: PriorityFollowUpItem[];
  hiddenOpportunities: HiddenOpportunityItem[];
  analystAnswer?: string;
  generatedAt: string;
}

export class AiInsightsService {
  private healthService = new DataHealthService();

  generateInsights(repo: CrmRepository, customQuestion?: string): AiInsightsReport {
    const contacts = repo.listContacts();
    const companies = repo.listCompanies();
    const deals = repo.listDeals();
    const pipelines = repo.listPipelines();
    const enrollments = repo.listSequenceEnrollments();
    const health = this.healthService.generateHealthSummary(repo);
    const erpOverview = repo.getErpOverview();

    const companyMap = new Map(companies.map((c) => [c.id, c]));
    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    const primaryPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
    const openStages = (primaryPipeline?.stages || [])
      .filter((s) => !s.isClosed)
      .sort((a, b) => a.order - b.order);

    const stageMap = new Map((primaryPipeline?.stages || []).map((s) => [s.id, s]));
    const nowMs = Date.now();

    // ========================================================================
    // 1. ANALYZE DEALS AT RISK (DEAL RISK & ROTTING)
    // ========================================================================
    const openDeals = deals.filter((d) => d.status === 'OPEN');
    const wonDeals = deals.filter((d) => d.status === 'WON');
    const lostDeals = deals.filter((d) => d.status === 'LOST');

    const atRiskDeals: AtRiskDealItem[] = [];

    for (const deal of openDeals) {
      const stage = stageMap.get(deal.stageId);
      const rottingLimit = stage?.dealRottingDays ?? 14;
      const lastTouch = deal.lastActivityAt || deal.stageEnteredAt || deal.updatedAt;
      const daysSinceLastActivity = Math.max(
        0,
        Math.floor((nowMs - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24))
      );
      const daysInCurrentStage = Math.max(
        0,
        Math.floor((nowMs - new Date(deal.stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24))
      );

      const contact = deal.contactId ? contactMap.get(deal.contactId) : undefined;
      const company = deal.companyId ? companyMap.get(deal.companyId) : undefined;

      const reasons: string[] = [];
      let riskScore = 15;

      if (daysSinceLastActivity > rottingLimit) {
        const overdue = daysSinceLastActivity - rottingLimit;
        riskScore += Math.min(55, 30 + overdue * 2);
        reasons.push(
          `Sem interação há ${daysSinceLastActivity} dias (limite da etapa "${stage?.name || deal.stageId}": ${rottingLimit} dias)`
        );
      } else if (daysSinceLastActivity >= Math.ceil(rottingLimit * 0.7)) {
        riskScore += 20;
        reasons.push(`Aproximando-se do limite de estagnação (${daysSinceLastActivity}/${rottingLimit} dias)`);
      }

      if (!contact) {
        riskScore += 18;
        reasons.push('Negócio sem contato decisor vinculado');
      } else if (contact.completenessScore < 65) {
        riskScore += 15;
        reasons.push(`Contato principal com baixa completude de dados (${contact.completenessScore}%)`);
      }

      if (!company) {
        riskScore += 10;
        reasons.push('Negócio sem empresa vinculada');
      }

      if (deal.value >= 200000 && daysSinceLastActivity > 5) {
        riskScore += 10;
        reasons.push('Alto ticket (Enterprise) exige cadência semanal executiva');
      }

      riskScore = Math.min(99, Math.max(5, riskScore));

      const riskLevel: AtRiskDealItem['riskLevel'] =
        riskScore >= 75
          ? 'CRITICAL'
          : riskScore >= 55
            ? 'HIGH'
            : riskScore >= 35
              ? 'MEDIUM'
              : 'LOW';

      let recommendedAction = 'Manter acompanhamento consultivo semanal.';
      if (riskLevel === 'CRITICAL') {
        recommendedAction = `Ligar hoje para ${contact ? `${contact.firstName} ${contact.lastName}` : 'o decisor'} e envolver diretoria para destravar a etapa "${stage?.name || deal.stageId}".`;
      } else if (riskLevel === 'HIGH') {
        recommendedAction = `Acionar Cadência de Destravamento de Propostas e validar cronograma de decisão.`;
      } else if (contact && contact.completenessScore < 70) {
        recommendedAction = `Executar enriquecimento automático do contato e mapear segundo decisor na conta.`;
      }

      atRiskDeals.push({
        dealId: deal.id,
        title: deal.title,
        value: deal.value,
        stageId: deal.stageId,
        stageName: stage?.name || deal.stageId,
        probability: deal.probability,
        contactId: deal.contactId,
        companyId: deal.companyId,
        companyName: company?.name || null,
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
        contactEmail: contact?.email || null,
        daysSinceLastActivity,
        daysInCurrentStage,
        dealRottingDays: rottingLimit,
        riskScore,
        riskLevel,
        reasons: reasons.length > 0 ? reasons : ['Pipeline saudável e dentro do SLA da etapa'],
        recommendedAction,
      });
    }

    atRiskDeals.sort((a, b) => b.riskScore - a.riskScore || b.value - a.value);

    // ========================================================================
    // 2. FUNNEL BOTTLENECKS BY STAGE
    // ========================================================================
    const funnelBottlenecks: FunnelBottleneckItem[] = [];

    for (let i = 0; i < openStages.length; i++) {
      const stage = openStages[i];
      const stageDeals = openDeals.filter((d) => d.stageId === stage.id);
      const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);
      const weightedValue = Math.round(
        stageDeals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0)
      );

      // Deals that reached this stage or beyond (including won deals)
      const dealsAtOrBeyondCurrent = deals.filter((d) => {
        const s = stageMap.get(d.stageId);
        return s && (s.order >= stage.order || s.isWon);
      }).length;
      const dealsBeyondCurrent = deals.filter((d) => {
        const s = stageMap.get(d.stageId);
        return s && (s.order > stage.order || s.isWon);
      }).length;

      const conversionRateToNext =
        dealsAtOrBeyondCurrent > 0
          ? Math.round((dealsBeyondCurrent / dealsAtOrBeyondCurrent) * 100)
          : stage.defaultProbability;

      const avgDaysInStage =
        stageDeals.length > 0
          ? Math.round(
              stageDeals.reduce((sum, d) => {
                const days = Math.max(
                  1,
                  Math.floor((nowMs - new Date(d.stageEnteredAt).getTime()) / (1000 * 60 * 60 * 24))
                );
                return sum + days;
              }, 0) / stageDeals.length
            )
          : 0;

      const rottingInStage = atRiskDeals.filter(
        (r) => r.stageId === stage.id && r.daysSinceLastActivity > stage.dealRottingDays
      );
      const stagnantValue = rottingInStage.reduce((sum, r) => sum + r.value, 0);

      const isBottleneck =
        rottingInStage.length > 0 || avgDaysInStage > stage.dealRottingDays || stagnantValue >= 150000;
      const severity: FunnelBottleneckItem['severity'] =
        stagnantValue >= 180000
          ? 'HIGH'
          : isBottleneck
            ? 'MEDIUM'
            : 'LOW';

      const diagnosis = isBottleneck
        ? `R$ ${stagnantValue.toLocaleString('pt-BR')} retidos em ${rottingInStage.length} negócio(s) acima do SLA de ${stage.dealRottingDays} dias (tempo médio na etapa: ${avgDaysInStage} dias).`
        : `Fluxo saudável na etapa ${stage.name} (média de ${avgDaysInStage} dias vs SLA de ${stage.dealRottingDays} dias).`;

      const recommendation = isBottleneck
        ? `Realizar força-tarefa executiva nos negócios parados em "${stage.name}" e automatizar follow-up de 48h.`
        : `Manter cadência padrão de avanço para a próxima etapa.`;

      funnelBottlenecks.push({
        stageId: stage.id,
        stageName: stage.name,
        order: stage.order,
        defaultProbability: stage.defaultProbability,
        dealCount: stageDeals.length,
        totalValue,
        weightedValue,
        conversionRateToNext,
        avgDaysInStage,
        dealRottingDays: stage.dealRottingDays,
        rottingDealCount: rottingInStage.length,
        stagnantValue,
        isBottleneck,
        severity,
        diagnosis,
        recommendation,
      });
    }

    // ========================================================================
    // 3. REVENUE FORECAST (PONDERADA, COMPROMETIDA, OTIMISTA, CONSERVADORA)
    // ========================================================================
    const totalOpenPipelineValue = openDeals.reduce((sum, d) => sum + d.value, 0);
    const weightedPipelineValue = Math.round(
      openDeals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0)
    );
    const closedWonValue = wonDeals.reduce((sum, d) => sum + d.value, 0);
    const closedLostValue = lostDeals.reduce((sum, d) => sum + d.value, 0);

    // Healthy deals (not CRITICAL risk)
    const healthyWeightedPipeline = Math.round(
      atRiskDeals
        .filter((r) => r.riskLevel !== 'CRITICAL')
        .reduce((sum, r) => sum + r.value * (r.probability / 100), 0)
    );

    const highProbOpenValue = openDeals
      .filter((d) => d.probability >= 80)
      .reduce((sum, d) => sum + d.value * (d.probability / 100), 0);

    const committedForecast = Math.round(closedWonValue + highProbOpenValue);
    const conservativeForecast = Math.round(closedWonValue + healthyWeightedPipeline);
    const optimisticForecast = Math.round(closedWonValue + weightedPipelineValue * 1.18);

    const closedCount = wonDeals.length + lostDeals.length;
    const winRate = closedCount > 0 ? Number(((wonDeals.length / closedCount) * 100).toFixed(1)) : 65.0;
    const averageDealSize =
      deals.length > 0 ? Math.round(deals.reduce((sum, d) => sum + d.value, 0) / deals.length) : 0;

    const revenueForecast: RevenueForecastSummary = {
      currency: primaryPipeline?.currency || 'BRL',
      totalOpenPipelineValue,
      weightedPipelineValue,
      closedWonValue,
      closedLostValue,
      committedForecast,
      optimisticForecast,
      conservativeForecast,
      winRate,
      averageDealSize,
      byStage: funnelBottlenecks.map((b) => ({
        stageId: b.stageId,
        stageName: b.stageName,
        dealCount: b.dealCount,
        totalValue: b.totalValue,
        weightedValue: b.weightedValue,
      })),
    };

    // ========================================================================
    // 4. PRIORITY FOLLOW-UPS TODAY
    // ========================================================================
    const priorityFollowUps: PriorityFollowUpItem[] = [];

    // High-risk or high-value open deals
    for (const riskDeal of atRiskDeals) {
      const contact = riskDeal.contactId ? contactMap.get(riskDeal.contactId) : undefined;
      const priorityScore = Math.min(
        100,
        Math.round(riskDeal.riskScore * 0.6 + (Math.min(riskDeal.value, 350000) / 350000) * 40)
      );
      const urgency: PriorityFollowUpItem['urgency'] =
        riskDeal.riskLevel === 'CRITICAL' || riskDeal.probability >= 80
          ? 'IMMEDIATE'
          : riskDeal.riskLevel === 'HIGH'
            ? 'TODAY'
            : 'THIS_WEEK';

      priorityFollowUps.push({
        id: `prio-deal-${riskDeal.dealId}`,
        priorityScore,
        urgency,
        entityType: 'DEAL',
        dealId: riskDeal.dealId,
        contactId: contact?.id || null,
        companyName: riskDeal.companyName,
        contactName: riskDeal.contactName || 'Decisor da Conta',
        contactRole: contact?.jobTitle || null,
        title: riskDeal.title,
        value: riskDeal.value,
        reason: `${riskDeal.reasons[0]} • Valor: R$ ${riskDeal.value.toLocaleString('pt-BR')}`,
        suggestedChannel: riskDeal.daysSinceLastActivity > 14 ? 'CALL' : 'WHATSAPP',
        suggestedMessage: `Olá ${contact?.firstName || ''}, gostaria de alinhar os próximos passos de "${riskDeal.title}" para destravarmos a etapa de ${riskDeal.stageName} ainda esta semana.`,
      });
    }

    // Also include warm contacts who replied to sequences or have score >= 85 without an open deal
    for (const contact of contacts) {
      const hasOpenDeal = openDeals.some((d) => d.contactId === contact.id);
      if (!hasOpenDeal && contact.leadScore >= 80) {
        const company = contact.companyId ? companyMap.get(contact.companyId) : undefined;
        priorityFollowUps.push({
          id: `prio-cont-${contact.id}`,
          priorityScore: contact.leadScore,
          urgency: 'IMMEDIATE',
          entityType: 'CONTACT',
          dealId: null,
          contactId: contact.id,
          companyName: company?.name || null,
          contactName: `${contact.firstName} ${contact.lastName}`.trim(),
          contactRole: contact.jobTitle,
          title: `Converter SQL quente (${contact.firstName} - ${company?.name || 'Enterprise'}) em Oportunidade`,
          value: 180000,
          reason: `Lead Score ${contact.leadScore}/100 (${contact.jobTitle || 'Executivo'}) engajado sem negócio aberto no funil.`,
          suggestedChannel: 'MEETING',
          suggestedMessage: `Olá ${contact.firstName}, excelente seu retorno! Preparei o diagnóstico personalizado para a ${company?.name || 'sua operação'}. Vamos abrir a agenda de quinta às 15h?`,
        });
      }
    }

    priorityFollowUps.sort((a, b) => b.priorityScore - a.priorityScore);

    // ========================================================================
    // 5. HIDDEN OPPORTUNITIES IN THE DATABASE
    // ========================================================================
    const hiddenOpportunities: HiddenOpportunityItem[] = [];

    // 5a. High-score contacts without open deals
    for (const contact of contacts) {
      const hasDeal = deals.some((d) => d.contactId === contact.id && d.status === 'OPEN');
      if (!hasDeal && contact.leadScore >= 75 && contact.lifecycleStage !== 'CUSTOMER') {
        const company = contact.companyId ? companyMap.get(contact.companyId) : undefined;
        const repliedEnrollment = enrollments.find(
          (e) => e.contactId === contact.id && e.status === 'PAUSED_ON_REPLY'
        );

        hiddenOpportunities.push({
          id: `opp-cont-${contact.id}`,
          opportunityType: repliedEnrollment
            ? 'REPLIED_SEQUENCE_WARM_LEAD'
            : 'HIGH_SCORE_SQL_NO_DEAL',
          entityType: 'CONTACT',
          entityId: contact.id,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          companyName: company?.name || null,
          leadScore: contact.leadScore,
          estimatedDealValue: 185000,
          reason: repliedEnrollment
            ? `Respondeu positivamente à cadência ("${repliedEnrollment.replySnippet?.slice(0, 65)}...") e possui Score ${contact.leadScore}/100, mas ainda não tem Deal criado.`
            : `Decisor (${contact.jobTitle || 'C-Level'}) com Lead Score ${contact.leadScore}/100 sem oportunidade ativa no pipeline.`,
          suggestedAction: 'Criar negócio automaticamente na etapa "Qualificação Executiva (SQL)" e agendar reunião.',
        });
      }
    }

    // 5b. Enriched Enterprise companies without any open deal
    for (const company of companies) {
      const hasCompanyDeal = deals.some((d) => d.companyId === company.id && d.status === 'OPEN');
      const isCustomer = deals.some((d) => d.companyId === company.id && d.status === 'WON');
      if (!hasCompanyDeal && !isCustomer && company.completenessScore >= 85) {
        hiddenOpportunities.push({
          id: `opp-comp-${company.id}`,
          opportunityType: 'ENRICHED_ENTERPRISE_NO_DEAL',
          entityType: 'COMPANY',
          entityId: company.id,
          name: company.name,
          companyName: company.name,
          leadScore: company.completenessScore,
          estimatedDealValue: 210000,
          reason: `Conta Enterprise enriquecida (${company.industry || 'B2B'}, ${company.size || 'Grande Porte'}) sem negócio ativo no funil.`,
          suggestedAction: `Iniciar prospecção executiva focada nos contatos vinculados à ${company.name}.`,
        });
      }
    }

    const revenueAtRisk = atRiskDeals
      .filter((d) => d.riskLevel === 'CRITICAL' || d.riskLevel === 'HIGH')
      .reduce((sum, d) => sum + d.value, 0);

    const unlockableRevenue = hiddenOpportunities.reduce(
      (sum, o) => sum + o.estimatedDealValue,
      0
    );

    const aiConfidenceScore = Math.round(
      health.globalHealthScore * 0.45 + Math.min(100, winRate + 20) * 0.55
    );

    const keyTakeaways = [
      `Previsão Ponderada de Receita: R$ ${weightedPipelineValue.toLocaleString('pt-BR')} em aberto + R$ ${closedWonValue.toLocaleString('pt-BR')} já fechados (Forecast Comprometido: R$ ${committedForecast.toLocaleString('pt-BR')}).`,
      `Gargalo Principal do Funil: R$ ${revenueAtRisk.toLocaleString('pt-BR')} estão retidos em negócios com estagnação crítica nas etapas finais (Proposta e Negociação).`,
      `Oportunidades Ocultas: ${hiddenOpportunities.length} conta(s)/decisor(es) de alto fit (potencial estimado de R$ ${unlockableRevenue.toLocaleString('pt-BR')}) prontos para abertura imediata de negócio.`,
      `Saúde da Base (${health.globalHealthScore}/100) & ERP GestãoClick: MRR de Locação ativo em R$ ${erpOverview.kpis.monthlyRentalMrr.toLocaleString('pt-BR')}/mês (${erpOverview.kpis.activeContractsCount} contratos) com R$ ${erpOverview.kpis.issSavedBySv31Stf.toLocaleString('pt-BR')} economizados em ISS (Súmula Vinculante 31 STF).`,
    ];

    let analystAnswer: string | undefined;
    if (customQuestion && customQuestion.trim()) {
      analystAnswer = this.buildNaturalLanguageAnswer(
        customQuestion,
        revenueForecast,
        atRiskDeals,
        funnelBottlenecks,
        hiddenOpportunities,
        priorityFollowUps,
        health.globalHealthScore,
        erpOverview.kpis
      );
    }

    return {
      executiveSummary: {
        headline: `Pipeline ativo de R$ ${totalOpenPipelineValue.toLocaleString('pt-BR')} com R$ ${revenueAtRisk.toLocaleString('pt-BR')} em risco de estagnação e R$ ${unlockableRevenue.toLocaleString('pt-BR')} em oportunidades ocultas.`,
        aiConfidenceScore,
        revenueAtRisk,
        unlockableRevenue,
        keyTakeaways,
      },
      funnelBottlenecks,
      atRiskDeals,
      revenueForecast,
      priorityFollowUps,
      hiddenOpportunities,
      analystAnswer,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildNaturalLanguageAnswer(
    question: string,
    forecast: RevenueForecastSummary,
    atRisk: AtRiskDealItem[],
    bottlenecks: FunnelBottleneckItem[],
    hidden: HiddenOpportunityItem[],
    followUps: PriorityFollowUpItem[],
    healthScore: number,
    erpKpis: {
      monthlyRentalMrr: number;
      totalContractedTcv: number;
      activeContractsCount: number;
      issSavedBySv31Stf: number;
      totalReceivablesOpen: number;
      totalReceivablesPaid: number;
    }
  ): string {
    const q = question.toLowerCase();
    const topFollowUp = followUps[0];
    const worstBottleneck = [...bottlenecks].sort((a, b) => b.stagnantValue - a.stagnantValue)[0];

    if (
      q.includes('erp') ||
      q.includes('gestaoclick') ||
      q.includes('gestãoclick') ||
      q.includes('loca') ||
      q.includes('iss') ||
      q.includes('fatura') ||
      q.includes('contrato')
    ) {
      return `Diagnóstico ERP GestãoClick & Fiscal (Seta Telecom): Você possui ${erpKpis.activeContractsCount} contratos de locação ativos gerando MRR de R$ ${erpKpis.monthlyRentalMrr.toLocaleString('pt-BR')}/mês (TCV contratado de R$ ${erpKpis.totalContractedTcv.toLocaleString('pt-BR')}). Graças à segregação de Fatura de Locação (LC 116/03 + Súmula Vinculante 31 STF, 0% ISS), a economia tributária acumulada é de R$ ${erpKpis.issSavedBySv31Stf.toLocaleString('pt-BR')}. Há R$ ${erpKpis.totalReceivablesOpen.toLocaleString('pt-BR')} em contas a receber em aberto.`;
    }

    if (q.includes('gargalo') || q.includes('etapa') || q.includes('funil')) {
      return `O maior gargalo atual está na etapa "${worstBottleneck?.stageName || 'Negociação'}", com R$ ${(worstBottleneck?.stagnantValue || 0).toLocaleString('pt-BR')} retidos acima do SLA. Recomendo priorizar o destravamento imediato de "${atRisk[0]?.title || 'Creditas'}" (${atRisk[0]?.daysSinceLastActivity || 24} dias sem interação).`;
    }

    if (q.includes('previs') || q.includes('forecast') || q.includes('receita') || q.includes('fechar')) {
      return `Sua receita fechada (Won) é de R$ ${forecast.closedWonValue.toLocaleString('pt-BR')}, com Pipeline Ponderado de R$ ${forecast.weightedPipelineValue.toLocaleString('pt-BR')}. O Forecast Conservador (excluindo negócios em risco crítico) projeta R$ ${forecast.conservativeForecast.toLocaleString('pt-BR')}, enquanto o cenário Otimista alcança R$ ${forecast.optimisticForecast.toLocaleString('pt-BR')}.`;
    }

    if (q.includes('ocult') || q.includes('oportunidade') || q.includes('escondid')) {
      return `Identifiquei ${hidden.length} oportunidade(s) oculta(s) na base somando R$ ${hidden.reduce((s, h) => s + h.estimatedDealValue, 0).toLocaleString('pt-BR')}. Destaque imediato: ${hidden[0]?.name || 'Thiago Oliveira (Asaas)'} — ${hidden[0]?.reason || 'Alto score sem deal aberto'}.`;
    }

    return `Resumo Executivo IA (Saúde da Base: ${healthScore}/100): Hoje sua prioridade #1 de follow-up é "${topFollowUp?.title || 'Creditas'}" (${topFollowUp?.reason || 'Alto valor em risco'}). Temos R$ ${forecast.weightedPipelineValue.toLocaleString('pt-BR')} em receita ponderada no CRM, MRR de locação de R$ ${erpKpis.monthlyRentalMrr.toLocaleString('pt-BR')}/mês no ERP e ${hidden.length} oportunidade(s) oculta(s) pronta(s) para conversão.`;
  }
}
