// ============================================================================
// Workflow Automation Engine - Triggers, Conditions & Actions Executor
// ============================================================================

import { CrmRepository } from '../../db/repository';
import {
  Company,
  Contact,
  Deal,
  Workflow,
  WorkflowCondition,
  WorkflowExecution,
  WorkflowStepLog,
  WorkflowTriggerType,
} from '../../db/types';
import { EnrichmentService } from '../enrichment/enrichment-service';
import { SequenceService } from '../sequences/sequence-service';

export interface TriggerEventPayload {
  triggerType: WorkflowTriggerType;
  entityType: 'CONTACT' | 'COMPANY' | 'DEAL';
  entityId: string;
  context?: Record<string, unknown>;
  workflowId?: string;
}

export class WorkflowEngine {
  private enrichmentService = new EnrichmentService();
  private sequenceService = new SequenceService();

  evaluateCondition(entity: Record<string, unknown>, condition: WorkflowCondition): boolean {
    const rawValue = entity[condition.field];
    const targetValue = condition.value;

    switch (condition.operator) {
      case 'IS_EMPTY':
        return rawValue === null || rawValue === undefined || String(rawValue).trim() === '';
      case 'IS_NOT_EMPTY':
        return rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '';
      case 'EQUALS':
        return String(rawValue ?? '').toLowerCase() === String(targetValue ?? '').toLowerCase();
      case 'NOT_EQUALS':
        return String(rawValue ?? '').toLowerCase() !== String(targetValue ?? '').toLowerCase();
      case 'CONTAINS':
        return String(rawValue ?? '')
          .toLowerCase()
          .includes(String(targetValue ?? '').toLowerCase());
      case 'GREATER_THAN':
        return Number(rawValue ?? 0) > Number(targetValue ?? 0);
      case 'LESS_THAN':
        return Number(rawValue ?? 0) < Number(targetValue ?? 0);
      default:
        return false;
    }
  }

  private getEntityRecord(
    repo: CrmRepository,
    entityType: 'CONTACT' | 'COMPANY' | 'DEAL',
    entityId: string
  ): Contact | Company | Deal | undefined {
    if (entityType === 'CONTACT') return repo.getContactById(entityId);
    if (entityType === 'COMPANY') return repo.getCompanyById(entityId);
    if (entityType === 'DEAL') return repo.getDealById(entityId);
    return undefined;
  }

  private matchesTriggerConfig(workflow: Workflow, payload: TriggerEventPayload, entity: Record<string, unknown>): boolean {
    if (workflow.triggerType !== payload.triggerType) return false;
    const cfg = workflow.triggerConfig || {};

    if (workflow.triggerType === 'DEAL_STAGE_CHANGED' && cfg.targetStageId) {
      const currentStage = payload.context?.toStageId || entity.stageId;
      if (currentStage !== cfg.targetStageId) return false;
    }

    if (workflow.triggerType === 'SCORE_THRESHOLD' && typeof cfg.minScore === 'number') {
      const score = Number(entity.leadScore ?? entity.completenessScore ?? 0);
      if (score < cfg.minScore) return false;
    }

    if (workflow.triggerType === 'FORM_SUBMITTED' && cfg.formId && payload.context?.formId) {
      if (String(payload.context.formId) !== String(cfg.formId)) return false;
    }

    return true;
  }

  executeWorkflow(
    repo: CrmRepository,
    workflow: Workflow,
    payload: TriggerEventPayload
  ): WorkflowExecution {
    const startedAt = new Date().toISOString();
    const logs: WorkflowStepLog[] = [];
    let status: WorkflowExecution['status'] = 'COMPLETED';

    let entity = this.getEntityRecord(repo, payload.entityType, payload.entityId);
    if (!entity) {
      const failedExec: WorkflowExecution = {
        id: `wfexec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workflowId: workflow.id,
        workflowName: workflow.name,
        entityType: payload.entityType,
        entityId: payload.entityId,
        status: 'FAILED',
        logs: [
          {
            stepId: 'init',
            stepType: 'INIT',
            status: 'FAILED',
            message: `Entidade ${payload.entityType}:${payload.entityId} não encontrada.`,
            timestamp: startedAt,
          },
        ],
        startedAt,
        completedAt: new Date().toISOString(),
      };
      return repo.recordWorkflowExecution(failedExec);
    }

    for (const step of workflow.steps) {
      const stepTime = new Date().toISOString();
      // Refresh entity snapshot
      entity = this.getEntityRecord(repo, payload.entityType, payload.entityId) || entity;
      const entityMap = entity as unknown as Record<string, unknown>;

      if (step.type === 'DELAY') {
        logs.push({
          stepId: step.id,
          stepType: 'DELAY',
          status: 'SUCCESS',
          message: `Delay de ${step.delayMinutes || 0} minuto(s) processado.`,
          timestamp: stepTime,
        });
        continue;
      }

      if (step.type === 'CONDITION' && step.condition) {
        const passed = this.evaluateCondition(entityMap, step.condition);
        if (!passed) {
          logs.push({
            stepId: step.id,
            stepType: 'CONDITION',
            status: 'SKIPPED',
            message: `Condição não atendida: ${step.condition.field} ${step.condition.operator} ${String(step.condition.value ?? '')}`,
            timestamp: stepTime,
          });
          status = 'SKIPPED';
          break;
        }
        logs.push({
          stepId: step.id,
          stepType: 'CONDITION',
          status: 'SUCCESS',
          message: `Condição satisfeita: ${step.condition.field} ${step.condition.operator} ${String(step.condition.value ?? '')}`,
          timestamp: stepTime,
        });
        continue;
      }

      if (step.type === 'ACTION' && step.actionType) {
        const cfg = step.actionConfig || {};
        try {
          switch (step.actionType) {
            case 'UPDATE_PROPERTY': {
              const field = String(cfg.field || '');
              const value = cfg.value;
              if (payload.entityType === 'CONTACT') {
                repo.updateContact(payload.entityId, { [field]: value } as Partial<Contact>);
              } else if (payload.entityType === 'COMPANY') {
                repo.updateCompany(payload.entityId, { [field]: value } as Partial<Company>);
              } else if (payload.entityType === 'DEAL') {
                repo.updateDeal(payload.entityId, { [field]: value } as Partial<Deal>);
              }
              logs.push({
                stepId: step.id,
                stepType: 'ACTION',
                actionType: 'UPDATE_PROPERTY',
                status: 'SUCCESS',
                message: `Propriedade "${field}" atualizada para "${String(value)}".`,
                timestamp: stepTime,
                details: { field, value },
              });
              break;
            }

            case 'ASSIGN_OWNER': {
              const ownerId = String(cfg.ownerId || 'owner-marcello');
              if (payload.entityType === 'CONTACT') {
                repo.updateContact(payload.entityId, { ownerId });
              } else if (payload.entityType === 'DEAL') {
                repo.updateDeal(payload.entityId, { ownerId });
              }
              logs.push({
                stepId: step.id,
                stepType: 'ACTION',
                actionType: 'ASSIGN_OWNER',
                status: 'SUCCESS',
                message: `Proprietário atribuído para "${ownerId}".`,
                timestamp: stepTime,
                details: { ownerId },
              });
              break;
            }

            case 'ENRICH_RECORD': {
              if (payload.entityType === 'CONTACT') {
                const contact = repo.getContactById(payload.entityId);
                if (contact) {
                  const enr = this.enrichmentService.enrichContactRecord(
                    contact,
                    repo.listCompanies(),
                    repo.listDeals(),
                    repo.listTimelineEvents(),
                    { overwrite: Boolean(cfg.overwrite) }
                  );
                  if (enr.isNewCompany && enr.matchedOrCreatedCompany) {
                    repo.createCompany(enr.matchedOrCreatedCompany);
                  } else if (enr.matchedOrCreatedCompany && enr.companyFieldsUpdated.length > 0) {
                    repo.updateCompany(enr.matchedOrCreatedCompany.id, enr.matchedOrCreatedCompany);
                  }
                  repo.updateContact(contact.id, enr.contact);
                  logs.push({
                    stepId: step.id,
                    stepType: 'ACTION',
                    actionType: 'ENRICH_RECORD',
                    status: 'SUCCESS',
                    message: `Contato enriquecido via ${enr.source || 'DomainEngine'} (Campos: ${enr.fieldsUpdated.join(', ') || 'nenhum novo'}).`,
                    timestamp: stepTime,
                    details: { fieldsUpdated: enr.fieldsUpdated, domain: enr.domain },
                  });
                }
              } else if (payload.entityType === 'COMPANY') {
                const comp = repo.getCompanyById(payload.entityId);
                if (comp) {
                  const enr = this.enrichmentService.enrichCompanyRecord(comp, {
                    overwrite: Boolean(cfg.overwrite),
                  });
                  repo.updateCompany(comp.id, enr.company);
                  logs.push({
                    stepId: step.id,
                    stepType: 'ACTION',
                    actionType: 'ENRICH_RECORD',
                    status: 'SUCCESS',
                    message: `Empresa enriquecida via ${enr.source || 'Catalog'}.`,
                    timestamp: stepTime,
                  });
                }
              }
              break;
            }

            case 'CREATE_TASK': {
              const title = String(cfg.title || `Tarefa automática: ${workflow.name}`);
              repo.createTimelineEvent({
                type: 'TASK',
                title,
                body: `Tarefa criada automaticamente pelo workflow "${workflow.name}". Prazo: ${cfg.dueInDays || 1} dia(s).`,
                contactId: payload.entityType === 'CONTACT' ? payload.entityId : (entityMap.contactId as string) || null,
                companyId: payload.entityType === 'COMPANY' ? payload.entityId : (entityMap.companyId as string) || null,
                dealId: payload.entityType === 'DEAL' ? payload.entityId : null,
                metadata: { workflowId: workflow.id, dueInDays: cfg.dueInDays || 1 },
                actor: `Workflow: ${workflow.name}`,
              });
              logs.push({
                stepId: step.id,
                stepType: 'ACTION',
                actionType: 'CREATE_TASK',
                status: 'SUCCESS',
                message: `Tarefa criada na Timeline: "${title}".`,
                timestamp: stepTime,
              });
              break;
            }

            case 'SEND_EMAIL': {
              const subject = String(cfg.subject || `Notificação Automática - ${workflow.name}`);
              repo.createTimelineEvent({
                type: 'EMAIL',
                title: `E-mail automático enviado: ${subject}`,
                body: String(cfg.body || 'Mensagem disparada pelo motor de automação de marketing e vendas.'),
                contactId: payload.entityType === 'CONTACT' ? payload.entityId : (entityMap.contactId as string) || null,
                companyId: payload.entityType === 'COMPANY' ? payload.entityId : (entityMap.companyId as string) || null,
                dealId: payload.entityType === 'DEAL' ? payload.entityId : null,
                metadata: { workflowId: workflow.id, subject },
                actor: `Workflow: ${workflow.name}`,
              });
              logs.push({
                stepId: step.id,
                stepType: 'ACTION',
                actionType: 'SEND_EMAIL',
                status: 'SUCCESS',
                message: `E-mail disparado: "${subject}".`,
                timestamp: stepTime,
              });
              break;
            }

            case 'ENROLL_SEQUENCE': {
              const sequenceId = String(cfg.sequenceId || 'seq-outbound-enterprise');
              const contactId =
                payload.entityType === 'CONTACT'
                  ? payload.entityId
                  : String(entityMap.contactId || '');
              if (contactId) {
                this.sequenceService.enrollContact(repo, {
                  sequenceId,
                  contactId,
                  dealId: payload.entityType === 'DEAL' ? payload.entityId : null,
                });
              }
              logs.push({
                stepId: step.id,
                stepType: 'ACTION',
                actionType: 'ENROLL_SEQUENCE',
                status: 'SUCCESS',
                message: `Contato inscrito automaticamente na cadência "${sequenceId}".`,
                timestamp: stepTime,
              });
              break;
            }

            case 'NOTIFY_OWNER':
            case 'SEND_WEBHOOK': {
              const label =
                step.actionType === 'SEND_WEBHOOK'
                  ? `Webhook enviado para ${cfg.url || 'https://hooks.hubspot-pro.local/events'}`
                  : `Notificação enviada (${cfg.channel || 'In-App'}): ${cfg.message || workflow.name}`;
              repo.createTimelineEvent({
                type: 'WORKFLOW_ACTION',
                title: label,
                body: `Executado pelo workflow "${workflow.name}".`,
                contactId: payload.entityType === 'CONTACT' ? payload.entityId : (entityMap.contactId as string) || null,
                companyId: payload.entityType === 'COMPANY' ? payload.entityId : (entityMap.companyId as string) || null,
                dealId: payload.entityType === 'DEAL' ? payload.entityId : null,
                metadata: { workflowId: workflow.id, actionType: step.actionType, ...cfg },
                actor: `Workflow: ${workflow.name}`,
              });
              logs.push({
                stepId: step.id,
                stepType: 'ACTION',
                actionType: step.actionType,
                status: 'SUCCESS',
                message: label,
                timestamp: stepTime,
              });
              break;
            }
          }
        } catch (err) {
          status = 'FAILED';
          logs.push({
            stepId: step.id,
            stepType: 'ACTION',
            actionType: step.actionType,
            status: 'FAILED',
            message: err instanceof Error ? err.message : 'Erro na execução da ação',
            timestamp: stepTime,
          });
          break;
        }
      }
    }

    const execution: WorkflowExecution = {
      id: `wfexec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      entityType: payload.entityType,
      entityId: payload.entityId,
      status,
      logs,
      startedAt,
      completedAt: new Date().toISOString(),
    };

    return repo.recordWorkflowExecution(execution);
  }

  trigger(repo: CrmRepository, payload: TriggerEventPayload): WorkflowExecution[] {
    const entity = this.getEntityRecord(repo, payload.entityType, payload.entityId);
    if (!entity) return [];

    const entityMap = entity as unknown as Record<string, unknown>;
    const workflows = repo
      .listWorkflows()
      .filter((w) => w.isActive && (!payload.workflowId || w.id === payload.workflowId));

    const executions: WorkflowExecution[] = [];
    for (const wf of workflows) {
      if (this.matchesTriggerConfig(wf, payload, entityMap)) {
        const exec = this.executeWorkflow(repo, wf, payload);
        executions.push(exec);
      }
    }

    return executions;
  }
}
