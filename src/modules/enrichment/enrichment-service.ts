// ============================================================================
// Smart Data & Enrichment Engine - Domain Catalog, Job Normalization,
// Lead Scoring & Next Best Action
// ============================================================================

import { Company, Contact, Deal, NextBestAction, TimelineEvent } from '../../db/types';
import { calculateCompanyCompleteness, calculateContactCompleteness } from '../data-health/completeness';
import { normalizeAndValidatePhone, normalizeCorporateDomain, validateEmail } from '../data-health/validators';

export interface CatalogCompanyProfile {
  name: string;
  domain: string;
  cnpj: string;
  industry: string;
  size: string;
  annualRevenue: number;
  city: string;
  state: string;
  country: string;
}

export interface EnrichmentAdapter {
  name: string;
  lookupByDomain(domain: string): CatalogCompanyProfile | null;
}

const BUILTIN_CORPORATE_CATALOG: Record<string, CatalogCompanyProfile> = {
  'nubank.com.br': {
    name: 'Nu Pagamentos S.A. (Nubank)',
    domain: 'nubank.com.br',
    cnpj: '18.236.120/0001-58',
    industry: 'Fintech & Serviços Financeiros',
    size: '1000+ funcionários',
    annualRevenue: 42000000000,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
  'totvs.com.br': {
    name: 'TOTVS S.A.',
    domain: 'totvs.com.br',
    cnpj: '53.113.791/0001-22',
    industry: 'Software Enterprise & ERP',
    size: '1000+ funcionários',
    annualRevenue: 5100000000,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
  'rdstation.com': {
    name: 'RD Station (Resultados Digitais)',
    domain: 'rdstation.com',
    cnpj: '13.021.784/0001-86',
    industry: 'SaaS Marketing & CRM',
    size: '501-1000 funcionários',
    annualRevenue: 480000000,
    city: 'Florianópolis',
    state: 'SC',
    country: 'Brasil',
  },
  'vtex.com': {
    name: 'VTEX Commerce Cloud Brasil',
    domain: 'vtex.com',
    cnpj: '05.314.972/0001-74',
    industry: 'E-commerce Cloud & Digital Commerce',
    size: '1000+ funcionários',
    annualRevenue: 1150000000,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
  'mercadolivre.com.br': {
    name: 'Mercado Livre Brasil Ltda.',
    domain: 'mercadolivre.com.br',
    cnpj: '03.007.331/0001-41',
    industry: 'Marketplace & Logística Tech',
    size: '1000+ funcionários',
    annualRevenue: 65000000000,
    city: 'Osasco',
    state: 'SP',
    country: 'Brasil',
  },
  'creditas.com': {
    name: 'Creditas Soluções Financeiras Ltda.',
    domain: 'creditas.com',
    cnpj: '17.770.708/0001-24',
    industry: 'Fintech & Crédito com Garantia',
    size: '1000+ funcionários',
    annualRevenue: 1950000000,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
  'asaas.com.br': {
    name: 'Asaas Gestão Financeira Instituição de Pagamento S.A.',
    domain: 'asaas.com.br',
    cnpj: '19.540.550/0001-21',
    industry: 'Fintech B2B & Automação Financeira',
    size: '501-1000 funcionários',
    annualRevenue: 340000000,
    city: 'Joinville',
    state: 'SC',
    country: 'Brasil',
  },
  'loggi.com': {
    name: 'Loggi Tecnologia Ltda.',
    domain: 'loggi.com',
    cnpj: '18.277.493/0001-77',
    industry: 'Logística & Last-Mile Tech',
    size: '1000+ funcionários',
    annualRevenue: 1400000000,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
  'atlascloud.com.br': {
    name: 'Atlas Cloud Tecnologia S.A.',
    domain: 'atlascloud.com.br',
    cnpj: '11.222.333/0001-81',
    industry: 'Cloud Computing & DevOps',
    size: '201-500 funcionários',
    annualRevenue: 92000000,
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
};

export class BuiltinCatalogEnrichmentAdapter implements EnrichmentAdapter {
  name = 'HubSpotPro-CorporateCatalog-v2';

  lookupByDomain(domain: string): CatalogCompanyProfile | null {
    const clean = domain.trim().toLowerCase();
    return BUILTIN_CORPORATE_CATALOG[clean] || null;
  }
}

export class HeuristicDomainEnrichmentAdapter implements EnrichmentAdapter {
  name = 'HubSpotPro-HeuristicDomainEngine';

  lookupByDomain(domain: string): CatalogCompanyProfile | null {
    const norm = normalizeCorporateDomain(domain);
    if (!norm.isValid || !norm.isCorporate || !norm.domain) {
      return null;
    }

    const d = norm.domain;
    const brand = norm.rootBrand || 'Empresa Corporativa';
    const isBr = d.endsWith('.br');

    let industry = 'Tecnologia & Serviços B2B';
    if (/fin|pay|bank|cred|invest|capital/i.test(d)) {
      industry = 'Fintech & Serviços Financeiros';
    } else if (/log|transp|cargo|envio|entrega/i.test(d)) {
      industry = 'Logística & Supply Chain';
    } else if (/med|saude|health|clinic|farma|bio/i.test(d)) {
      industry = 'Healthtech & Saúde';
    } else if (/agro|farm|rural|terra/i.test(d)) {
      industry = 'Agrotech & Agronegócio';
    } else if (/edu|ensino|escola|academy/i.test(d)) {
      industry = 'Edtech & Educação';
    } else if (/shop|store|varejo|commerce|market/i.test(d)) {
      industry = 'E-commerce & Varejo';
    } else if (/cloud|soft|data|tech|sys|ai|dev/i.test(d)) {
      industry = 'SaaS & Software B2B';
    }

    return {
      name: isBr ? `${brand} Brasil Ltda.` : `${brand} Inc.`,
      domain: d,
      cnpj: '',
      industry,
      size: '51-200 funcionários',
      annualRevenue: 24000000,
      city: isBr ? 'São Paulo' : 'San Francisco',
      state: isBr ? 'SP' : 'CA',
      country: isBr ? 'Brasil' : 'Estados Unidos',
    };
  }
}

export interface JobRoleClassification {
  normalizedTitle: string | null;
  seniority: 'C_LEVEL' | 'VP' | 'DIRECTOR' | 'MANAGER' | 'SENIOR' | 'ANALYST';
  department: 'EXECUTIVE' | 'REVENUE' | 'MARKETING' | 'TECH' | 'OPERATIONS' | 'FINANCE' | 'OTHER';
  decisionPowerScore: number; // 0 to 25
}

export function normalizeAndClassifyJobTitle(rawTitle: string | null | undefined): JobRoleClassification {
  if (!rawTitle || !rawTitle.trim()) {
    return {
      normalizedTitle: null,
      seniority: 'ANALYST',
      department: 'OTHER',
      decisionPowerScore: 5,
    };
  }

  const t = rawTitle.trim();
  const lower = t.toLowerCase();

  let seniority: JobRoleClassification['seniority'] = 'ANALYST';
  let decisionPowerScore = 8;

  if (/\b(ceo|cto|cfo|coo|cmo|cro|cpo|founder|co-founder|fundador|sócio|socio|presidente)\b/i.test(lower)) {
    seniority = 'C_LEVEL';
    decisionPowerScore = 25;
  } else if (/\b(vp|vice-presidente|vice president)\b/i.test(lower)) {
    seniority = 'VP';
    decisionPowerScore = 22;
  } else if (/\b(diretor|diretora|director|head)\b/i.test(lower)) {
    seniority = 'DIRECTOR';
    decisionPowerScore = 20;
  } else if (/\b(gerente|manager|coordenador|coordenadora|lead)\b/i.test(lower)) {
    seniority = 'MANAGER';
    decisionPowerScore = 15;
  } else if (/\b(senior|sênior|sr\.|especialista|specialist)\b/i.test(lower)) {
    seniority = 'SENIOR';
    decisionPowerScore = 11;
  }

  let department: JobRoleClassification['department'] = 'OTHER';
  if (/\b(ceo|founder|fundador|presidente|sócio|socio)\b/i.test(lower)) {
    department = 'EXECUTIVE';
  } else if (/\b(vendas|sales|comercial|revenue|cro|account|parcerias|negócios)\b/i.test(lower)) {
    department = 'REVENUE';
  } else if (/\b(marketing|growth|cmo|brand|aquisição)\b/i.test(lower)) {
    department = 'MARKETING';
  } else if (/\b(cto|engenharia|engineering|ti|it|tech|produto|product|dados|data|software)\b/i.test(lower)) {
    department = 'TECH';
  } else if (/\b(cfo|financeiro|finanças|finance|compras|procurement|jurídico)\b/i.test(lower)) {
    department = 'FINANCE';
  } else if (/\b(coo|operações|operations|logística|cs|sucesso do cliente|customer)\b/i.test(lower)) {
    department = 'OPERATIONS';
  }

  const normalizedTitle = t
    .split(/\s+/)
    .map((w) => {
      if (/^(ceo|cto|cfo|coo|cmo|cro|vp|ti|rh|b2b|saas)$/i.test(w)) {
        return w.toUpperCase();
      }
      if (/^(de|da|do|das|dos|e|em)$/i.test(w)) {
        return w.toLowerCase();
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');

  return {
    normalizedTitle,
    seniority,
    department,
    decisionPowerScore,
  };
}

/**
 * Calcula automaticamente o Lead Score (0 a 100) combinando:
 * - Completude & Validade de Dados (até 25 pts)
 * - Senioridade / Poder de Decisão (até 25 pts)
 * - Fit Corporativo / Porte da Empresa (até 20 pts)
 * - Engajamento & Negócios Ativos (até 30 pts)
 */
export function calculateLeadScore(
  contact: Partial<Contact>,
  company?: Partial<Company> | null,
  deals: Deal[] = [],
  timelineEvents: TimelineEvent[] = []
): number {
  const completeness = calculateContactCompleteness(contact).score;
  const dataPoints = Math.round((completeness / 100) * 25);

  const jobInfo = normalizeAndClassifyJobTitle(contact.jobTitle);
  const seniorityPoints = jobInfo.decisionPowerScore; // 0..25

  const emailInfo = validateEmail(contact.email);
  let companyFitPoints = emailInfo.isCorporate ? 12 : 3;
  if (company) {
    if (company.annualRevenue && company.annualRevenue >= 50000000) {
      companyFitPoints += 8;
    } else if (company.size && /1000|501|201/.test(company.size)) {
      companyFitPoints += 6;
    } else if (company.industry) {
      companyFitPoints += 4;
    }
  }
  companyFitPoints = Math.min(20, companyFitPoints);

  const contactDeals = deals.filter((d) => d.contactId === contact.id || (contact.companyId && d.companyId === contact.companyId));
  const contactEvents = timelineEvents.filter((e) => e.contactId === contact.id);

  let engagementPoints = 0;
  if (contactDeals.some((d) => d.status === 'OPEN')) {
    engagementPoints += 15;
  }
  if (contactDeals.some((d) => d.status === 'WON')) {
    engagementPoints += 20;
  }
  engagementPoints += Math.min(15, contactEvents.length * 4);

  // Penalty for stale > 90 days
  if (contact.lastActivityAt) {
    const daysInactive = (Date.now() - new Date(contact.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysInactive > 90) {
      engagementPoints = Math.max(0, engagementPoints - 10);
    }
  }

  engagementPoints = Math.min(30, engagementPoints);

  return Math.min(100, Math.max(0, dataPoints + seniorityPoints + companyFitPoints + engagementPoints));
}

export function computeContactNextBestAction(
  contact: Contact,
  deals: Deal[] = []
): NextBestAction {
  if (!contact.isValidEmail || !contact.isValidPhone) {
    return {
      actionType: 'CLEAN_DATA',
      title: 'Corrigir dados de contato inválidos',
      reason: 'E-mail ou telefone com formato inválido impede cadências automáticas.',
      priority: 'HIGH',
      suggestedDueInDays: 1,
    };
  }

  if (contact.completenessScore < 70 && !contact.enrichedAt) {
    return {
      actionType: 'ENRICH',
      title: 'Executar Enriquecimento Corporativo',
      reason: `Completude em ${contact.completenessScore}%. Domínio corporativo permite inferir empresa, CNPJ e porte.`,
      priority: 'MEDIUM',
      suggestedDueInDays: 1,
    };
  }

  const openDeals = deals.filter((d) => d.contactId === contact.id && d.status === 'OPEN');
  if (openDeals.length === 0 && contact.leadScore >= 75) {
    return {
      actionType: 'CREATE_DEAL',
      title: 'Abrir oportunidade comercial (SQL)',
      reason: `Lead Score alto (${contact.leadScore}/100) e perfil decisor (${contact.jobTitle || 'Executivo'}) sem negócio ativo.`,
      priority: 'HIGH',
      suggestedDueInDays: 1,
    };
  }

  if (contact.lastActivityAt) {
    const daysSince = Math.floor((Date.now() - new Date(contact.lastActivityAt).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > 30) {
      return {
        actionType: 'FOLLOW_UP',
        title: 'Reengajar contato inativo',
        reason: `Sem interação registrada há ${daysSince} dias. Incluir em cadência de reengajamento.`,
        priority: contact.leadScore >= 70 ? 'HIGH' : 'MEDIUM',
        suggestedDueInDays: 2,
      };
    }
  }

  if (contact.leadScore >= 80) {
    return {
      actionType: 'MEETING',
      title: 'Agendar reunião executiva de diagnóstico',
      reason: `Lead altamente qualificado (Score ${contact.leadScore}) pronto para avanço comercial.`,
      priority: 'HIGH',
      suggestedDueInDays: 2,
    };
  }

  return {
    actionType: 'EMAIL',
    title: 'Enviar conteúdo consultivo da cadência',
    reason: 'Nutrir relacionamento para elevar qualificação (MQL -> SQL).',
    priority: 'LOW',
    suggestedDueInDays: 3,
  };
}

export interface EnrichmentExecutionResult {
  entityType: 'CONTACT' | 'COMPANY';
  entityId: string;
  enriched: boolean;
  isCorporateDomain: boolean;
  domain: string | null;
  source: string | null;
  fieldsUpdated: string[];
  companyLinkedOrCreated?: Company | null;
  updatedContact?: Contact;
  updatedCompany?: Company;
  timelineEvent?: TimelineEvent;
  reason?: string;
}

export class EnrichmentService {
  private adapters: EnrichmentAdapter[];

  constructor(customAdapters: EnrichmentAdapter[] = []) {
    this.adapters = [
      ...customAdapters,
      new BuiltinCatalogEnrichmentAdapter(),
      new HeuristicDomainEnrichmentAdapter(),
    ];
  }

  lookupDomain(domainOrEmail: string): {
    isCorporate: boolean;
    isFreeProvider: boolean;
    domain: string | null;
    profile: CatalogCompanyProfile | null;
    adapterName: string | null;
  } {
    const norm = normalizeCorporateDomain(domainOrEmail);
    if (!norm.isValid || !norm.domain) {
      return {
        isCorporate: false,
        isFreeProvider: false,
        domain: null,
        profile: null,
        adapterName: null,
      };
    }

    if (!norm.isCorporate) {
      return {
        isCorporate: false,
        isFreeProvider: norm.isFreeProvider,
        domain: norm.domain,
        profile: null,
        adapterName: null,
      };
    }

    for (const adapter of this.adapters) {
      const profile = adapter.lookupByDomain(norm.domain);
      if (profile) {
        return {
          isCorporate: true,
          isFreeProvider: false,
          domain: norm.domain,
          profile,
          adapterName: adapter.name,
        };
      }
    }

    return {
      isCorporate: true,
      isFreeProvider: false,
      domain: norm.domain,
      profile: null,
      adapterName: null,
    };
  }

  /**
   * Enriches a Company record without overwriting manually confirmed fields unless overwrite=true.
   */
  enrichCompanyRecord(
    company: Company,
    options: { overwrite?: boolean } = {}
  ): { company: Company; fieldsUpdated: string[]; source: string | null } {
    const overwrite = Boolean(options.overwrite);
    const fieldsUpdated: string[] = [];

    const lookup = this.lookupDomain(company.domain || '');
    if (!lookup.profile) {
      const completeness = calculateCompanyCompleteness(company).score;
      return {
        company: { ...company, completenessScore: completeness },
        fieldsUpdated: [],
        source: null,
      };
    }

    const profile = lookup.profile;
    const updated: Company = { ...company };

    const applyIfEmpty = <K extends keyof Company>(field: K, value: Company[K]) => {
      if (value === null || value === undefined || value === '') return;
      const current = updated[field];
      const isEmpty = current === null || current === undefined || String(current).trim() === '';
      if (isEmpty || overwrite) {
        if (updated[field] !== value) {
          updated[field] = value;
          fieldsUpdated.push(String(field));
        }
      }
    };

    applyIfEmpty('name', profile.name);
    applyIfEmpty('domain', profile.domain);
    if (profile.cnpj) applyIfEmpty('cnpj', profile.cnpj);
    applyIfEmpty('industry', profile.industry);
    applyIfEmpty('size', profile.size);
    applyIfEmpty('annualRevenue', profile.annualRevenue);
    applyIfEmpty('city', profile.city);
    applyIfEmpty('state', profile.state);
    applyIfEmpty('country', profile.country);

    const now = new Date().toISOString();
    updated.enrichedAt = now;
    updated.enrichmentSource = lookup.adapterName;
    updated.completenessScore = calculateCompanyCompleteness(updated).score;
    updated.updatedAt = now;

    return {
      company: updated,
      fieldsUpdated,
      source: lookup.adapterName,
    };
  }

  /**
   * Enriches a Contact record from its email domain and job title without overwriting manual fields.
   */
  enrichContactRecord(
    contact: Contact,
    existingCompanies: Company[],
    deals: Deal[] = [],
    timelineEvents: TimelineEvent[] = [],
    options: { overwrite?: boolean } = {}
  ): {
    contact: Contact;
    matchedOrCreatedCompany: Company | null;
    isNewCompany: boolean;
    fieldsUpdated: string[];
    companyFieldsUpdated: string[];
    source: string | null;
    isCorporateDomain: boolean;
    domain: string | null;
  } {
    const overwrite = Boolean(options.overwrite);
    const fieldsUpdated: string[] = [];
    const companyFieldsUpdated: string[] = [];

    const emailValidation = validateEmail(contact.email);
    const updatedContact: Contact = {
      ...contact,
      email: emailValidation.normalizedEmail || contact.email,
      isValidEmail: emailValidation.isValid,
      isDisposableEmail: emailValidation.isDisposable,
      isCorporateEmail: emailValidation.isCorporate,
    };

    if (contact.phone) {
      const phoneVal = normalizeAndValidatePhone(contact.phone);
      updatedContact.isValidPhone = phoneVal.isValid;
      if (phoneVal.isValid && phoneVal.e164) {
        updatedContact.normalizedPhone = phoneVal.e164;
        if (updatedContact.phone !== phoneVal.formatted && phoneVal.formatted) {
          updatedContact.phone = phoneVal.formatted;
          fieldsUpdated.push('phone');
        }
      }
    }

    // Normalize Job Title & infer Seniority / Department
    if (updatedContact.jobTitle) {
      const roleInfo = normalizeAndClassifyJobTitle(updatedContact.jobTitle);
      if (roleInfo.normalizedTitle && roleInfo.normalizedTitle !== updatedContact.jobTitle) {
        updatedContact.jobTitle = roleInfo.normalizedTitle;
        fieldsUpdated.push('jobTitle');
      }
      if (!updatedContact.seniority || overwrite) {
        updatedContact.seniority = roleInfo.seniority;
        fieldsUpdated.push('seniority');
      }
      if (!updatedContact.department || overwrite) {
        updatedContact.department = roleInfo.department;
        fieldsUpdated.push('department');
      }
    }

    const lookup = this.lookupDomain(updatedContact.email);
    let matchedCompany: Company | null = null;
    let isNewCompany = false;

    if (lookup.isCorporate && lookup.domain) {
      // Find existing company by contact.companyId or domain
      matchedCompany =
        existingCompanies.find((c) => c.id === updatedContact.companyId) ||
        existingCompanies.find(
          (c) => normalizeCorporateDomain(c.domain).domain === lookup.domain
        ) ||
        null;

      if (!matchedCompany && lookup.profile) {
        const now = new Date().toISOString();
        const newComp: Company = {
          id: `comp-enr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: lookup.profile.name,
          domain: lookup.profile.domain,
          cnpj: lookup.profile.cnpj || null,
          industry: lookup.profile.industry,
          size: lookup.profile.size,
          annualRevenue: lookup.profile.annualRevenue,
          city: lookup.profile.city,
          state: lookup.profile.state,
          country: lookup.profile.country,
          completenessScore: 0,
          enrichedAt: now,
          enrichmentSource: lookup.adapterName,
          customProperties: { autoCreatedByEnrichment: true },
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        };
        newComp.completenessScore = calculateCompanyCompleteness(newComp).score;
        matchedCompany = newComp;
        isNewCompany = true;
        companyFieldsUpdated.push('name', 'domain', 'industry', 'size', 'annualRevenue');
      } else if (matchedCompany) {
        const enrichedCompResult = this.enrichCompanyRecord(matchedCompany, { overwrite });
        matchedCompany = enrichedCompResult.company;
        companyFieldsUpdated.push(...enrichedCompResult.fieldsUpdated);
      }

      if (matchedCompany && (!updatedContact.companyId || overwrite)) {
        if (updatedContact.companyId !== matchedCompany.id) {
          updatedContact.companyId = matchedCompany.id;
          fieldsUpdated.push('companyId');
        }
      }

      // Enrich custom properties with company context without overwriting manual keys
      if (lookup.profile) {
        const existingCustom = updatedContact.customProperties || {};
        const nextCustom = { ...existingCustom };
        if (!nextCustom.inferredIndustry) {
          nextCustom.inferredIndustry = lookup.profile.industry;
          fieldsUpdated.push('customProperties.inferredIndustry');
        }
        if (!nextCustom.inferredCompanySize) {
          nextCustom.inferredCompanySize = lookup.profile.size;
          fieldsUpdated.push('customProperties.inferredCompanySize');
        }
        if (!nextCustom.inferredCity && lookup.profile.city) {
          nextCustom.inferredCity = `${lookup.profile.city}/${lookup.profile.state}`;
        }
        updatedContact.customProperties = nextCustom;
      }
    }

    const now = new Date().toISOString();
    if (lookup.isCorporate) {
      updatedContact.enrichedAt = now;
      updatedContact.enrichmentSource = lookup.adapterName || 'DomainHeuristics';
    }
    updatedContact.completenessScore = calculateContactCompleteness(updatedContact).score;
    updatedContact.leadScore = calculateLeadScore(
      updatedContact,
      matchedCompany,
      deals,
      timelineEvents
    );
    updatedContact.nextBestAction = computeContactNextBestAction(updatedContact, deals);
    updatedContact.updatedAt = now;

    return {
      contact: updatedContact,
      matchedOrCreatedCompany: matchedCompany,
      isNewCompany,
      fieldsUpdated,
      companyFieldsUpdated,
      source: lookup.adapterName,
      isCorporateDomain: lookup.isCorporate,
      domain: lookup.domain,
    };
  }
}
