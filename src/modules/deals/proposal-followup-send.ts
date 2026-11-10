// Envio oficial da sequência de follow-up: caixa Outlook 365 do proprietário (Microsoft Graph).
import { getAccessToken, type MailboxDeps } from '../../api/mailbox-routes';
import { sendGraphMail } from '../email/ms-graph';
import { buildTrackedEmailBody, newTrackingId } from '../email/mail-tracking';
import type { CrmEmailMessage } from '../email/mailbox-store';
import { newMailboxId } from '../email/mailbox-store';
import type { FollowupSendDeps } from './proposal-followup-service';

export function createOutlookFollowupSendDeps(deps: MailboxDeps, origin?: string): FollowupSendDeps {
  return {
    async listAccounts(ownerEmail) {
      return deps.store.listAccounts(ownerEmail);
    },
    async listDealMessages(dealId) {
      return deps.store.listForRecord({ dealId }, 200);
    },
    async sendMail(input) {
      const accounts = (await deps.store.listAccounts(input.ownerEmail)).filter((a) => a.status === 'ATIVADO');
      const account = accounts.find((a) => a.id === input.accountId) || accounts[0];
      if (!account) throw new Error('Caixa Outlook 365 do proprietário não está conectada.');
      const token = await getAccessToken(deps, account);
      if (!token) throw new Error('Não foi possível obter o token da caixa Outlook 365. Reconecte a mailbox.');
      const trackingId = input.trackingId && input.trackingId.length >= 22 ? input.trackingId : newTrackingId();
      const built = buildTrackedEmailBody({ body: input.text, trackingId, origin });
      const sent = await sendGraphMail(deps.fetch, token, {
        to: input.to,
        cc: [],
        subject: input.subject,
        html: built.html || input.html,
      });
      const rec: CrmEmailMessage = {
        id: newMailboxId('eml'),
        accountId: account.id,
        ownerEmail: account.ownerEmail,
        externalId: `graph:${sent.id}`,
        conversationId: sent.conversationId,
        internetMessageId: sent.internetMessageId,
        direction: 'ENVIADO',
        source: 'STI_HUB',
        fromAddress: account.mailboxAddress,
        fromName: account.displayName || input.ownerEmail,
        to: input.to,
        cc: [],
        subject: input.subject,
        bodyPreview: built.text.replace(/\s+/g, ' ').trim().slice(0, 500),
        occurredAt: new Date().toISOString(),
        contactId: input.contactId,
        companyId: input.companyId,
        dealId: input.dealId,
        trackingId,
        links: built.links,
        openCount: 0,
        clickCount: 0,
        lastOpenedAt: null,
        lastClickedAt: null,
        createdAt: new Date().toISOString(),
      };
      await deps.store.insertMessage(rec);
      return { id: rec.id, conversationId: sent.conversationId, internetMessageId: sent.internetMessageId, trackingId };
    },
  };
}
