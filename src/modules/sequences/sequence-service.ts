// ============================================================================
// Email Sequences & Multi-Step Cadence Engine (with Auto-Pause on Reply)
// ============================================================================

import { CrmRepository } from '../../db/repository';
import { EmailSequence, SequenceEnrollment } from '../../db/types';

export class SequenceService {
  private recalculateSequenceRates(seq: EmailSequence): EmailSequence {
    const sent = Math.max(1, seq.sentCount);
    const enrolled = Math.max(1, seq.enrolledCount);
    seq.openRate = Number(((seq.openCount / sent) * 100).toFixed(1));
    seq.clickRate = Number(((seq.clickCount / sent) * 100).toFixed(1));
    seq.replyRate = Number(((seq.replyCount / enrolled) * 100).toFixed(1));
    return seq;
  }

  private renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || key);
  }

  enrollContact(
    repo: CrmRepository,
    params: {
      sequenceId: string;
      contactId: string;
      dealId?: string | null;
    }
  ): { enrollment: SequenceEnrollment; sequence: EmailSequence } {
    const seq = repo.getSequenceById(params.sequenceId);
    if (!seq) {
      throw new Error(`Cadência de e-mail (${params.sequenceId}) não encontrada.`);
    }
    const contact = repo.getContactById(params.contactId);
    if (!contact) {
      throw new Error(`Contato (${params.contactId}) não encontrado.`);
    }

    const company = contact.companyId ? repo.getCompanyById(contact.companyId) : null;
    const now = new Date();
    const nowIso = now.toISOString();

    const firstStep = seq.steps.find((s) => s.stepOrder === 1) || seq.steps[0];
    const secondStep = seq.steps.find((s) => s.stepOrder === 2);

    const renderedSubject = firstStep
      ? this.renderTemplate(firstStep.subject, {
          firstName: contact.firstName,
          lastName: contact.lastName,
          companyName: company?.name || 'sua empresa',
        })
      : `Início de Cadência: ${seq.name}`;

    const nextDue = secondStep
      ? new Date(now.getTime() + (secondStep.delayDays || 2) * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const enrollment: SequenceEnrollment = {
      id: `enr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sequenceId: seq.id,
      contactId: contact.id,
      dealId: params.dealId ?? null,
      status: secondStep ? 'ACTIVE' : 'COMPLETED',
      currentStepOrder: 1,
      stepsCompleted: 1,
      sentCount: 1,
      openCount: 0,
      clickCount: 0,
      repliedAt: null,
      replySnippet: null,
      nextStepDueAt: nextDue,
      enrolledAt: nowIso,
      updatedAt: nowIso,
      history: [
        {
          stepOrder: 1,
          subject: renderedSubject,
          action: 'SENT',
          timestamp: nowIso,
          details: 'Passo 1 disparado na inscrição da cadência.',
        },
      ],
    };

    repo.saveSequenceEnrollment(enrollment);

    // Update sequence metrics
    if (firstStep) {
      firstStep.sentCount += 1;
    }
    seq.enrolledCount += 1;
    seq.sentCount += 1;
    if (enrollment.status === 'ACTIVE') {
      seq.activeCount += 1;
    } else {
      seq.completedCount += 1;
    }
    this.recalculateSequenceRates(seq);
    repo.updateSequence(seq.id, seq);

    // Record timeline event
    repo.createTimelineEvent({
      type: 'EMAIL',
      title: `[Cadência: ${seq.name}] Passo 1 enviado: ${renderedSubject}`,
      body: firstStep
        ? this.renderTemplate(firstStep.bodyTemplate, {
            firstName: contact.firstName,
            lastName: contact.lastName,
            companyName: company?.name || 'sua empresa',
          })
        : null,
      contactId: contact.id,
      companyId: contact.companyId,
      dealId: params.dealId ?? null,
      metadata: {
        sequenceId: seq.id,
        enrollmentId: enrollment.id,
        stepOrder: 1,
      },
      actor: 'Motor de Cadências',
    });

    return { enrollment, sequence: seq };
  }

  advanceStep(
    repo: CrmRepository,
    enrollmentId: string
  ): { enrollment: SequenceEnrollment; sequence: EmailSequence } {
    const enrollment = repo.getSequenceEnrollmentById(enrollmentId);
    if (!enrollment) {
      throw new Error(`Inscrição de cadência (${enrollmentId}) não encontrada.`);
    }
    const seq = repo.getSequenceById(enrollment.sequenceId);
    if (!seq) {
      throw new Error(`Cadência (${enrollment.sequenceId}) não encontrada.`);
    }

    if (enrollment.status !== 'ACTIVE') {
      return { enrollment, sequence: seq };
    }

    const contact = repo.getContactById(enrollment.contactId);
    const company = contact?.companyId ? repo.getCompanyById(contact.companyId) : null;

    const nextStepOrder = enrollment.currentStepOrder + 1;
    const step = seq.steps.find((s) => s.stepOrder === nextStepOrder);
    const now = new Date();
    const nowIso = now.toISOString();

    if (!step) {
      enrollment.status = 'COMPLETED';
      enrollment.nextStepDueAt = null;
      enrollment.updatedAt = nowIso;
      repo.saveSequenceEnrollment(enrollment);

      seq.activeCount = Math.max(0, seq.activeCount - 1);
      seq.completedCount += 1;
      repo.updateSequence(seq.id, seq);
      return { enrollment, sequence: seq };
    }

    const renderedSubject = this.renderTemplate(step.subject, {
      firstName: contact?.firstName || 'Cliente',
      lastName: contact?.lastName || '',
      companyName: company?.name || 'sua empresa',
    });

    const followingStep = seq.steps.find((s) => s.stepOrder === nextStepOrder + 1);
    enrollment.currentStepOrder = nextStepOrder;
    enrollment.stepsCompleted += 1;
    enrollment.sentCount += 1;
    enrollment.updatedAt = nowIso;
    enrollment.history.push({
      stepOrder: nextStepOrder,
      subject: renderedSubject,
      action: 'SENT',
      timestamp: nowIso,
    });

    if (followingStep) {
      enrollment.nextStepDueAt = new Date(
        now.getTime() + (followingStep.delayDays || 3) * 24 * 60 * 60 * 1000
      ).toISOString();
    } else {
      enrollment.status = 'COMPLETED';
      enrollment.nextStepDueAt = null;
      seq.activeCount = Math.max(0, seq.activeCount - 1);
      seq.completedCount += 1;
    }

    repo.saveSequenceEnrollment(enrollment);

    step.sentCount += 1;
    seq.sentCount += 1;
    this.recalculateSequenceRates(seq);
    repo.updateSequence(seq.id, seq);

    if (contact) {
      repo.createTimelineEvent({
        type: 'EMAIL',
        title: `[Cadência: ${seq.name}] Passo ${nextStepOrder} enviado: ${renderedSubject}`,
        body: this.renderTemplate(step.bodyTemplate, {
          firstName: contact.firstName,
          lastName: contact.lastName,
          companyName: company?.name || 'sua empresa',
        }),
        contactId: contact.id,
        companyId: contact.companyId,
        dealId: enrollment.dealId,
        metadata: {
          sequenceId: seq.id,
          enrollmentId: enrollment.id,
          stepOrder: nextStepOrder,
        },
        actor: 'Motor de Cadências',
      });
    }

    return { enrollment, sequence: seq };
  }

  /**
   * Registra abertura (OPEN), clique (CLICK) ou resposta (REPLY).
   * Quando o lead responde (REPLY), a cadência é pausada/encerrada automaticamente (PAUSED_ON_REPLY)!
   */
  recordInteraction(
    repo: CrmRepository,
    params: {
      enrollmentId: string;
      interactionType: 'OPEN' | 'CLICK' | 'REPLY';
      replySnippet?: string;
    }
  ): { enrollment: SequenceEnrollment; sequence: EmailSequence; autoPaused: boolean } {
    const enrollment = repo.getSequenceEnrollmentById(params.enrollmentId);
    if (!enrollment) {
      throw new Error(`Inscrição de cadência (${params.enrollmentId}) não encontrada.`);
    }
    const seq = repo.getSequenceById(enrollment.sequenceId);
    if (!seq) {
      throw new Error(`Cadência (${enrollment.sequenceId}) não encontrada.`);
    }

    const currentStep =
      seq.steps.find((s) => s.stepOrder === enrollment.currentStepOrder) || seq.steps[0];
    const nowIso = new Date().toISOString();
    let autoPaused = false;

    if (params.interactionType === 'OPEN') {
      enrollment.openCount += 1;
      seq.openCount += 1;
      if (currentStep) currentStep.openCount += 1;
      enrollment.history.push({
        stepOrder: enrollment.currentStepOrder,
        subject: currentStep?.subject || seq.name,
        action: 'OPENED',
        timestamp: nowIso,
      });
    } else if (params.interactionType === 'CLICK') {
      enrollment.clickCount += 1;
      seq.clickCount += 1;
      if (currentStep) currentStep.clickCount += 1;
      enrollment.history.push({
        stepOrder: enrollment.currentStepOrder,
        subject: currentStep?.subject || seq.name,
        action: 'CLICKED',
        timestamp: nowIso,
      });
    } else if (params.interactionType === 'REPLY') {
      const wasActive = enrollment.status === 'ACTIVE';
      enrollment.status = 'PAUSED_ON_REPLY';
      enrollment.repliedAt = nowIso;
      enrollment.replySnippet =
        params.replySnippet || 'Lead respondeu ao e-mail da cadência demonstrando interesse.';
      enrollment.nextStepDueAt = null;
      autoPaused = true;

      if (wasActive) {
        seq.activeCount = Math.max(0, seq.activeCount - 1);
      }
      seq.repliedCount += 1;
      seq.replyCount += 1;
      if (currentStep) currentStep.replyCount += 1;

      enrollment.history.push({
        stepOrder: enrollment.currentStepOrder,
        subject: currentStep?.subject || seq.name,
        action: 'REPLIED',
        timestamp: nowIso,
        details: `Cadência pausada automaticamente ao receber resposta: "${enrollment.replySnippet}"`,
      });

      const contact = repo.getContactById(enrollment.contactId);
      if (contact) {
        repo.updateContact(contact.id, {
          leadStatus: 'CONNECTED',
          leadScore: Math.min(100, (contact.leadScore || 50) + 15),
          lastActivityAt: nowIso,
        });

        repo.createTimelineEvent({
          type: 'EMAIL',
          title: `Resposta recebida na cadência "${seq.name}" (Cadência Pausada Automaticamente)`,
          body: enrollment.replySnippet,
          contactId: contact.id,
          companyId: contact.companyId,
          dealId: enrollment.dealId,
          metadata: {
            sequenceId: seq.id,
            enrollmentId: enrollment.id,
            autoPausedOnReply: true,
            stepOrder: enrollment.currentStepOrder,
          },
          actor: `${contact.firstName} ${contact.lastName}`.trim(),
        });
      }
    }

    enrollment.updatedAt = nowIso;
    repo.saveSequenceEnrollment(enrollment);
    this.recalculateSequenceRates(seq);
    repo.updateSequence(seq.id, seq);

    return { enrollment, sequence: seq, autoPaused };
  }
}
