'use client';

import {
  Company,
  Contact,
  Deal,
  EmailSequence,
  CrmEmailTemplate,
  CrmSnippet,
  CrmTask,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpEmployeeRecord,
  ErpFiscalInvoice,
  ErpPurchaseOrder,
  ErpRentalContract,
  ErpSaleOrder,
  ErpServiceOrder,
  ErpSupplierRecord,
  Pipeline,
  ServiceTicket,
  TimelineEvent,
  WebForm,
  Workflow,
} from '../../db/types';
import { ClientDurableJournal } from '../../db/repository';
import { EnrichedCompanyItem, EnrichedContactItem } from '../components/ContactsCompaniesTab';
import { EnrichedDeal } from '../components/DealsKanbanTab';
import { EnrichedServiceTicket } from '../components/ServiceDeskTab';

const JOURNAL_STORAGE_KEY = 'seta_crm_durable_journal_v3';

const EMOJI_STRIP_REGEX = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{FE0F}]/gu;

export function stripEmojis(text: string): string {
  return String(text ?? "").replace(EMOJI_STRIP_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

export function stripEmojisDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(EMOJI_STRIP_REGEX, "") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripEmojisDeep(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripEmojisDeep(v);
    }
    return out as T;
  }
  return value;
}


function createEmptyJournal(): Required<ClientDurableJournal> {
  return {
    upsertedContacts: [],
    deletedContactIds: [],
    upsertedCompanies: [],
    deletedCompanyIds: [],
    upsertedDeals: [],
    deletedDealIds: [],
    upsertedPipelines: [],
    upsertedTickets: [],
    deletedTicketIds: [],
    upsertedProposals: [],
    deletedProposalIds: [],
    upsertedContracts: [],
    deletedContractIds: [],
    upsertedInvoices: [],
    deletedInvoiceIds: [],
    upsertedCatalogItems: [],
    deletedCatalogItemIds: [],
    upsertedSuppliers: [],
    deletedSupplierIds: [],
    upsertedEmployees: [],
    deletedEmployeeIds: [],
    upsertedSalesOrders: [],
    deletedSalesOrderIds: [],
    upsertedServiceOrders: [],
    deletedServiceOrderIds: [],
    upsertedPurchaseOrders: [],
    deletedPurchaseOrderIds: [],
    upsertedForms: [],
    upsertedWorkflows: [],
    upsertedSequences: [],
    upsertedTasks: [],
    deletedTaskIds: [],
    upsertedEmailTemplates: [],
    upsertedSnippets: [],
    timelineEvents: [],
  };
}

export function loadDurableJournal(): Required<ClientDurableJournal> {
  if (typeof window === 'undefined') return createEmptyJournal();
  try {
    const raw = window.localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (!raw) return createEmptyJournal();
    const parsed = stripEmojisDeep(JSON.parse(raw) as ClientDurableJournal);
    return {
      ...createEmptyJournal(),
      ...parsed,
    };
  } catch {
    return createEmptyJournal();
  }
}

export function saveDurableJournal(journal: ClientDurableJournal): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(stripEmojisDeep(journal)));
  } catch {
    // Ignore storage quota errors
  }
}

export function hasDurableJournalEntries(journal?: ClientDurableJournal | null): boolean {
  if (!journal) return false;
  return Boolean(
    (journal.upsertedContacts && journal.upsertedContacts.length > 0) ||
      (journal.deletedContactIds && journal.deletedContactIds.length > 0) ||
      (journal.upsertedCompanies && journal.upsertedCompanies.length > 0) ||
      (journal.deletedCompanyIds && journal.deletedCompanyIds.length > 0) ||
      (journal.upsertedDeals && journal.upsertedDeals.length > 0) ||
      (journal.deletedDealIds && journal.deletedDealIds.length > 0) ||
      (journal.upsertedPipelines && journal.upsertedPipelines.length > 0) ||
      (journal.upsertedTickets && journal.upsertedTickets.length > 0) ||
      (journal.deletedTicketIds && journal.deletedTicketIds.length > 0) ||
      (journal.upsertedProposals && journal.upsertedProposals.length > 0) ||
      (journal.deletedProposalIds && journal.deletedProposalIds.length > 0) ||
      (journal.upsertedContracts && journal.upsertedContracts.length > 0) ||
      (journal.deletedContractIds && journal.deletedContractIds.length > 0) ||
      (journal.upsertedInvoices && journal.upsertedInvoices.length > 0) ||
      (journal.deletedInvoiceIds && journal.deletedInvoiceIds.length > 0) ||
      (journal.upsertedCatalogItems && journal.upsertedCatalogItems.length > 0) ||
      (journal.deletedCatalogItemIds && journal.deletedCatalogItemIds.length > 0) ||
      (journal.upsertedSuppliers && journal.upsertedSuppliers.length > 0) ||
      (journal.deletedSupplierIds && journal.deletedSupplierIds.length > 0) ||
      (journal.upsertedEmployees && journal.upsertedEmployees.length > 0) ||
      (journal.deletedEmployeeIds && journal.deletedEmployeeIds.length > 0) ||
      (journal.upsertedSalesOrders && journal.upsertedSalesOrders.length > 0) ||
      (journal.deletedSalesOrderIds && journal.deletedSalesOrderIds.length > 0) ||
      (journal.upsertedServiceOrders && journal.upsertedServiceOrders.length > 0) ||
      (journal.deletedServiceOrderIds && journal.deletedServiceOrderIds.length > 0) ||
      (journal.upsertedPurchaseOrders && journal.upsertedPurchaseOrders.length > 0) ||
      (journal.deletedPurchaseOrderIds && journal.deletedPurchaseOrderIds.length > 0) ||
      (journal.upsertedForms && journal.upsertedForms.length > 0) ||
      (journal.upsertedWorkflows && journal.upsertedWorkflows.length > 0) ||
      (journal.upsertedSequences && journal.upsertedSequences.length > 0) ||
      (journal.timelineEvents && journal.timelineEvents.length > 0)
  );
}

function upsertInArray<T extends { id: string }>(arr: T[], item: T): T[] {
  const filtered = arr.filter((x) => x.id !== item.id);
  return [item, ...filtered];
}

export function recordUpsertedContact(contact: Contact): void {
  const j = loadDurableJournal();
  j.deletedContactIds = j.deletedContactIds.filter((id) => id !== contact.id);
  j.upsertedContacts = upsertInArray(j.upsertedContacts, contact);
  saveDurableJournal(j);
}

export function recordDeletedContact(contactId: string): void {
  const j = loadDurableJournal();
  j.upsertedContacts = j.upsertedContacts.filter((c) => c.id !== contactId);
  if (!j.deletedContactIds.includes(contactId)) {
    j.deletedContactIds.push(contactId);
  }
  saveDurableJournal(j);
}

export function recordUpsertedCompany(company: Company): void {
  const j = loadDurableJournal();
  j.deletedCompanyIds = j.deletedCompanyIds.filter((id) => id !== company.id);
  j.upsertedCompanies = upsertInArray(j.upsertedCompanies, company);
  saveDurableJournal(j);
}

export function recordDeletedCompany(companyId: string): void {
  const j = loadDurableJournal();
  j.upsertedCompanies = j.upsertedCompanies.filter((c) => c.id !== companyId);
  if (!j.deletedCompanyIds.includes(companyId)) {
    j.deletedCompanyIds.push(companyId);
  }
  saveDurableJournal(j);
}

export function recordUpsertedDeal(deal: Deal): void {
  const j = loadDurableJournal();
  j.deletedDealIds = j.deletedDealIds.filter((id) => id !== deal.id);
  j.upsertedDeals = upsertInArray(j.upsertedDeals, deal);
  saveDurableJournal(j);
}

export function recordDeletedDeal(dealId: string): void {
  const j = loadDurableJournal();
  j.upsertedDeals = j.upsertedDeals.filter((d) => d.id !== dealId);
  if (!j.deletedDealIds.includes(dealId)) {
    j.deletedDealIds.push(dealId);
  }
  saveDurableJournal(j);
}

export function recordUpsertedPipeline(pipeline: Pipeline): void {
  const j = loadDurableJournal();
  j.upsertedPipelines = upsertInArray(j.upsertedPipelines, pipeline);
  saveDurableJournal(j);
}

export function recordUpsertedTicket(ticket: ServiceTicket): void {
  const j = loadDurableJournal();
  j.deletedTicketIds = j.deletedTicketIds.filter((id) => id !== ticket.id && id !== ticket.key);
  j.upsertedTickets = upsertInArray(j.upsertedTickets, ticket);
  saveDurableJournal(j);
}

export function recordDeletedTicket(ticketIdOrKey: string): void {
  const j = loadDurableJournal();
  j.upsertedTickets = j.upsertedTickets.filter(
    (t) => t.id !== ticketIdOrKey && t.key !== ticketIdOrKey
  );
  if (!j.deletedTicketIds.includes(ticketIdOrKey)) {
    j.deletedTicketIds.push(ticketIdOrKey);
  }
  saveDurableJournal(j);
}

export function recordUpsertedProposal(proposal: ErpCommercialProposal): void {
  const j = loadDurableJournal();
  j.deletedProposalIds = (j.deletedProposalIds || []).filter(
    (id) => id !== proposal.id && id !== proposal.code
  );
  j.upsertedProposals = upsertInArray(j.upsertedProposals, proposal);
  saveDurableJournal(j);
}

export function recordDeletedProposal(proposalIdOrCode: string): void {
  const j = loadDurableJournal();
  j.upsertedProposals = j.upsertedProposals.filter(
    (p) => p.id !== proposalIdOrCode && p.code !== proposalIdOrCode
  );
  if (!j.deletedProposalIds.includes(proposalIdOrCode)) {
    j.deletedProposalIds.push(proposalIdOrCode);
  }
  saveDurableJournal(j);
}

export function recordUpsertedContract(contract: ErpRentalContract): void {
  const j = loadDurableJournal();
  j.deletedContractIds = (j.deletedContractIds || []).filter(
    (id) => id !== contract.id && id !== contract.contractNumber
  );
  j.upsertedContracts = upsertInArray(j.upsertedContracts, contract);
  saveDurableJournal(j);
}

export function recordDeletedContract(contractIdOrNum: string): void {
  const j = loadDurableJournal();
  j.upsertedContracts = j.upsertedContracts.filter(
    (c) => c.id !== contractIdOrNum && c.contractNumber !== contractIdOrNum
  );
  if (!j.deletedContractIds.includes(contractIdOrNum)) {
    j.deletedContractIds.push(contractIdOrNum);
  }
  saveDurableJournal(j);
}

export function recordUpsertedInvoice(invoice: ErpFiscalInvoice): void {
  const j = loadDurableJournal();
  j.deletedInvoiceIds = (j.deletedInvoiceIds || []).filter(
    (id) => id !== invoice.id && id !== invoice.documentNumber
  );
  j.upsertedInvoices = upsertInArray(j.upsertedInvoices, invoice);
  saveDurableJournal(j);
}

export function recordDeletedInvoice(invoiceIdOrDoc: string): void {
  const j = loadDurableJournal();
  j.upsertedInvoices = j.upsertedInvoices.filter(
    (i) => i.id !== invoiceIdOrDoc && i.documentNumber !== invoiceIdOrDoc
  );
  if (!j.deletedInvoiceIds.includes(invoiceIdOrDoc)) {
    j.deletedInvoiceIds.push(invoiceIdOrDoc);
  }
  saveDurableJournal(j);
}

export function recordUpsertedCatalogItem(item: ErpCatalogItem): void {
  const j = loadDurableJournal();
  j.deletedCatalogItemIds = (j.deletedCatalogItemIds || []).filter(
    (id) => id !== item.id && id !== item.gestaoClickCode
  );
  j.upsertedCatalogItems = upsertInArray(j.upsertedCatalogItems || [], item);
  saveDurableJournal(j);
}

export function recordDeletedCatalogItem(idOrSku: string): void {
  const j = loadDurableJournal();
  j.upsertedCatalogItems = (j.upsertedCatalogItems || []).filter(
    (c) => c.id !== idOrSku && c.gestaoClickCode !== idOrSku
  );
  if (!j.deletedCatalogItemIds.includes(idOrSku)) {
    j.deletedCatalogItemIds.push(idOrSku);
  }
  saveDurableJournal(j);
}

export function recordUpsertedSupplier(supplier: ErpSupplierRecord): void {
  const j = loadDurableJournal();
  j.deletedSupplierIds = (j.deletedSupplierIds || []).filter((id) => id !== supplier.id);
  j.upsertedSuppliers = upsertInArray(j.upsertedSuppliers || [], supplier);
  saveDurableJournal(j);
}

export function recordDeletedSupplier(supplierId: string): void {
  const j = loadDurableJournal();
  j.upsertedSuppliers = (j.upsertedSuppliers || []).filter((s) => s.id !== supplierId);
  if (!j.deletedSupplierIds.includes(supplierId)) {
    j.deletedSupplierIds.push(supplierId);
  }
  saveDurableJournal(j);
}

export function recordUpsertedEmployee(emp: ErpEmployeeRecord): void {
  const j = loadDurableJournal();
  j.deletedEmployeeIds = (j.deletedEmployeeIds || []).filter((id) => id !== emp.id);
  j.upsertedEmployees = upsertInArray(j.upsertedEmployees || [], emp);
  saveDurableJournal(j);
}

export function recordDeletedEmployee(empId: string): void {
  const j = loadDurableJournal();
  j.upsertedEmployees = (j.upsertedEmployees || []).filter((e) => e.id !== empId);
  if (!j.deletedEmployeeIds.includes(empId)) {
    j.deletedEmployeeIds.push(empId);
  }
  saveDurableJournal(j);
}

export function recordUpsertedSaleOrder(sale: ErpSaleOrder): void {
  const j = loadDurableJournal();
  j.deletedSalesOrderIds = (j.deletedSalesOrderIds || []).filter(
    (id) => id !== sale.id && id !== sale.code
  );
  j.upsertedSalesOrders = upsertInArray(j.upsertedSalesOrders || [], sale);
  saveDurableJournal(j);
}

export function recordDeletedSaleOrder(saleIdOrCode: string): void {
  const j = loadDurableJournal();
  j.upsertedSalesOrders = (j.upsertedSalesOrders || []).filter(
    (v) => v.id !== saleIdOrCode && v.code !== saleIdOrCode
  );
  if (!j.deletedSalesOrderIds.includes(saleIdOrCode)) {
    j.deletedSalesOrderIds.push(saleIdOrCode);
  }
  saveDurableJournal(j);
}

export function recordUpsertedServiceOrder(os: ErpServiceOrder): void {
  const j = loadDurableJournal();
  j.deletedServiceOrderIds = (j.deletedServiceOrderIds || []).filter(
    (id) => id !== os.id && id !== os.code
  );
  j.upsertedServiceOrders = upsertInArray(j.upsertedServiceOrders || [], os);
  saveDurableJournal(j);
}

export function recordDeletedServiceOrder(osIdOrCode: string): void {
  const j = loadDurableJournal();
  j.upsertedServiceOrders = (j.upsertedServiceOrders || []).filter(
    (o) => o.id !== osIdOrCode && o.code !== osIdOrCode
  );
  if (!j.deletedServiceOrderIds.includes(osIdOrCode)) {
    j.deletedServiceOrderIds.push(osIdOrCode);
  }
  saveDurableJournal(j);
}

export function recordUpsertedPurchaseOrder(po: ErpPurchaseOrder): void {
  const j = loadDurableJournal();
  j.deletedPurchaseOrderIds = (j.deletedPurchaseOrderIds || []).filter(
    (id) => id !== po.id && id !== po.code
  );
  j.upsertedPurchaseOrders = upsertInArray(j.upsertedPurchaseOrders || [], po);
  saveDurableJournal(j);
}

export function recordDeletedPurchaseOrder(poIdOrCode: string): void {
  const j = loadDurableJournal();
  j.upsertedPurchaseOrders = (j.upsertedPurchaseOrders || []).filter(
    (p) => p.id !== poIdOrCode && p.code !== poIdOrCode
  );
  if (!j.deletedPurchaseOrderIds.includes(poIdOrCode)) {
    j.deletedPurchaseOrderIds.push(poIdOrCode);
  }
  saveDurableJournal(j);
}

export function recordUpsertedForm(form: WebForm): void {
  const j = loadDurableJournal();
  j.upsertedForms = upsertInArray(j.upsertedForms, form);
  saveDurableJournal(j);
}

export function recordUpsertedWorkflow(workflow: Workflow): void {
  const j = loadDurableJournal();
  j.upsertedWorkflows = upsertInArray(j.upsertedWorkflows, workflow);
  saveDurableJournal(j);
}

export function recordUpsertedSequence(sequence: EmailSequence): void {
  const j = loadDurableJournal();
  j.upsertedSequences = upsertInArray(j.upsertedSequences, sequence);
  saveDurableJournal(j);
}

export function recordUpsertedTask(task: CrmTask): void {
  const j = loadDurableJournal();
  j.deletedTaskIds = (j.deletedTaskIds || []).filter((id) => id !== task.id);
  j.upsertedTasks = upsertInArray(j.upsertedTasks || [], task);
  saveDurableJournal(j);
}

export function recordDeletedTask(taskId: string): void {
  const j = loadDurableJournal();
  j.upsertedTasks = (j.upsertedTasks || []).filter((t) => t.id !== taskId);
  if (!j.deletedTaskIds.includes(taskId)) {
    j.deletedTaskIds.push(taskId);
  }
  saveDurableJournal(j);
}

export function recordUpsertedEmailTemplate(template: CrmEmailTemplate): void {
  const j = loadDurableJournal();
  j.upsertedEmailTemplates = upsertInArray(j.upsertedEmailTemplates || [], template);
  saveDurableJournal(j);
}

export function recordUpsertedSnippet(snippet: CrmSnippet): void {
  const j = loadDurableJournal();
  j.upsertedSnippets = upsertInArray(j.upsertedSnippets || [], snippet);
  saveDurableJournal(j);
}

export function recordTimelineEvent(event: TimelineEvent): void {
  const j = loadDurableJournal();
  j.timelineEvents = upsertInArray(j.timelineEvents, event).slice(0, 100);
  saveDurableJournal(j);
}

export function mergeContactsWithJournal(
  serverContacts: EnrichedContactItem[],
  companies: EnrichedCompanyItem[]
): EnrichedContactItem[] {
  const j = loadDurableJournal();
  const deletedSet = new Set(j.deletedContactIds);
  const compMap = new Map(companies.map((c) => [c.id, c]));

  const map = new Map<string, EnrichedContactItem>();
  for (const sc of serverContacts) {
    if (!deletedSet.has(sc.id)) {
      map.set(sc.id, sc);
    }
  }

  const missingAtTop: EnrichedContactItem[] = [];
  for (const uc of j.upsertedContacts) {
    if (deletedSet.has(uc.id)) continue;
    const enriched: EnrichedContactItem = {
      ...uc,
      company: (uc as EnrichedContactItem).company || (uc.companyId ? compMap.get(uc.companyId) || null : null),
    };
    const existing = map.get(uc.id);
    if (!existing) {
      missingAtTop.push(enriched);
    } else {
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const journalTime = uc.updatedAt ? new Date(uc.updatedAt).getTime() : 0;
      if (journalTime >= existingTime) {
        map.set(uc.id, { ...existing, ...enriched });
      }
    }
  }

  return [...missingAtTop, ...Array.from(map.values())];
}

export function mergeCompaniesWithJournal(
  serverCompanies: EnrichedCompanyItem[]
): EnrichedCompanyItem[] {
  const j = loadDurableJournal();
  const deletedSet = new Set(j.deletedCompanyIds);
  const map = new Map<string, EnrichedCompanyItem>();

  for (const sc of serverCompanies) {
    if (!deletedSet.has(sc.id)) {
      map.set(sc.id, sc);
    }
  }

  const missingAtTop: EnrichedCompanyItem[] = [];
  for (const uc of j.upsertedCompanies) {
    if (deletedSet.has(uc.id)) continue;
    const existing = map.get(uc.id);
    if (!existing) {
      missingAtTop.push(uc);
    } else {
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const journalTime = uc.updatedAt ? new Date(uc.updatedAt).getTime() : 0;
      if (journalTime >= existingTime) {
        map.set(uc.id, { ...existing, ...uc });
      }
    }
  }

  return [...missingAtTop, ...Array.from(map.values())];
}

export function mergeDealsWithJournal(serverDeals: EnrichedDeal[]): EnrichedDeal[] {
  const j = loadDurableJournal();
  const deletedSet = new Set(j.deletedDealIds);
  const map = new Map<string, EnrichedDeal>();

  for (const sd of serverDeals) {
    if (!deletedSet.has(sd.id)) {
      map.set(sd.id, sd);
    }
  }

  const missingAtTop: EnrichedDeal[] = [];
  for (const ud of j.upsertedDeals) {
    if (deletedSet.has(ud.id)) continue;
    const existing = map.get(ud.id);
    if (!existing) {
      missingAtTop.push({
        ...ud,
        stageName: ud.stageId,
        daysInactive: 0,
        isRotting: false,
        weightedValue: Math.round(ud.value * (ud.probability / 100)),
        contact: null,
        company: null,
      });
    } else {
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const journalTime = ud.updatedAt ? new Date(ud.updatedAt).getTime() : 0;
      if (journalTime >= existingTime) {
        map.set(ud.id, { ...existing, ...ud });
      }
    }
  }

  return [...missingAtTop, ...Array.from(map.values())];
}

export function mergeTicketsWithJournal(
  serverTickets: EnrichedServiceTicket[]
): EnrichedServiceTicket[] {
  const j = loadDurableJournal();
  const deletedSet = new Set(j.deletedTicketIds);
  const map = new Map<string, EnrichedServiceTicket>();

  for (const st of serverTickets) {
    if (!deletedSet.has(st.id) && !deletedSet.has(st.key)) {
      map.set(st.id, st);
    }
  }

  const missingAtTop: EnrichedServiceTicket[] = [];
  for (const ut of j.upsertedTickets) {
    if (deletedSet.has(ut.id) || deletedSet.has(ut.key)) continue;
    const existing = map.get(ut.id);
    if (!existing) {
      missingAtTop.push({
        ...ut,
        contact: null,
        company: null,
        deal: null,
      });
    } else {
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const journalTime = ut.updatedAt ? new Date(ut.updatedAt).getTime() : 0;
      if (journalTime >= existingTime) {
        map.set(ut.id, { ...existing, ...ut });
      }
    }
  }

  return [...missingAtTop, ...Array.from(map.values())];
}
