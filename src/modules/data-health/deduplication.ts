// ============================================================================
// Data Health & Hygiene - Exact & Fuzzy Deduplication + Smart Merge Engine
// ============================================================================

import { Company, Contact, Deal, SuggestedMergePlan, TimelineEvent } from '../../db/types';
import { normalizeAndValidatePhone, normalizeCorporateDomain, validateCnpj, validateEmail } from './validators';

export function normalizeTextForComparison(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompanyNameForComparison(name: string | null | undefined): string {
  const base = normalizeTextForComparison(name);
  if (!base) return '';
  const suffixes = new Set([
    'ltda',
    'sa',
    's a',
    'me',
    'epp',
    'eireli',
    'inc',
    'corp',
    'llc',
    'co',
    'holding',
    'participacoes',
    'brasil',
  ]);
  const tokens = base.split(' ').filter((token) => !suffixes.has(token));
  return tokens.join(' ').trim() || base;
}

export function levenshteinDistance(a: string, b: string): number {
  const s1 = a;
  const s2 = b;
  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function levenshteinSimilarity(a: string, b: string): number {
  const s1 = normalizeTextForComparison(a);
  const s2 = normalizeTextForComparison(b);
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(s1, s2) / maxLen;
}

export function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array<boolean>(len1).fill(false);
  const s2Matches = new Array<boolean>(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }

  const transpositions = t / 2;
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

export function jaroWinklerSimilarity(a: string, b: string): number {
  const s1 = normalizeTextForComparison(a);
  const s2 = normalizeTextForComparison(b);
  if (!s1 || !s2) return 0;
  const jaro = jaroSimilarity(s1, s2);
  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export interface DuplicateCandidatePair<T> {
  entityType: 'CONTACT' | 'COMPANY';
  primary: T;
  duplicate: T;
  confidenceScore: number;
  matchReasons: string[];
  suggestedMerge: SuggestedMergePlan;
}

function choosePrimaryRecord<T extends { completenessScore: number; updatedAt: string; createdAt: string }>(
  a: T,
  b: T
): { primary: T; duplicate: T } {
  if (a.completenessScore !== b.completenessScore) {
    return a.completenessScore > b.completenessScore
      ? { primary: a, duplicate: b }
      : { primary: b, duplicate: a };
  }
  const aUpdated = new Date(a.updatedAt).getTime();
  const bUpdated = new Date(b.updatedAt).getTime();
  return aUpdated >= bUpdated ? { primary: a, duplicate: b } : { primary: b, duplicate: a };
}

export function buildContactMergePlan(
  primary: Contact,
  duplicate: Contact,
  matchReasons: string[],
  confidenceScore: number,
  deals: Deal[] = [],
  timelineEvents: TimelineEvent[] = []
): SuggestedMergePlan {
  const fieldResolution: SuggestedMergePlan['fieldResolution'] = {};
  const mergedFields: Record<string, unknown> = {};

  const scalarFields: Array<keyof Contact> = [
    'email',
    'firstName',
    'lastName',
    'phone',
    'jobTitle',
    'seniority',
    'department',
    'companyId',
    'ownerId',
    'lifecycleStage',
    'leadStatus',
  ];

  const lifecycleOrder: Record<string, number> = {
    SUBSCRIBER: 1,
    LEAD: 2,
    MQL: 3,
    SQL: 4,
    OPPORTUNITY: 5,
    CUSTOMER: 6,
    EVANGELIST: 7,
    OTHER: 0,
  };

  for (const field of scalarFields) {
    const pVal = primary[field];
    const dVal = duplicate[field];

    if (field === 'lifecycleStage') {
      const pRank = lifecycleOrder[String(pVal)] ?? 0;
      const dRank = lifecycleOrder[String(dVal)] ?? 0;
      const usePrimary = pRank >= dRank;
      const chosenValue = usePrimary ? pVal : dVal;
      mergedFields[field] = chosenValue;
      fieldResolution[field] = {
        chosenValue,
        source: usePrimary ? 'PRIMARY' : 'DUPLICATE',
        primaryValue: pVal,
        duplicateValue: dVal,
      };
      continue;
    }

    if (field === 'phone') {
      const pPhone = normalizeAndValidatePhone(String(pVal || ''));
      const dPhone = normalizeAndValidatePhone(String(dVal || ''));
      if (pPhone.isValid) {
        mergedFields[field] = pPhone.formatted || pVal;
        fieldResolution[field] = {
          chosenValue: mergedFields[field],
          source: 'PRIMARY',
          primaryValue: pVal,
          duplicateValue: dVal,
        };
      } else if (dPhone.isValid) {
        mergedFields[field] = dPhone.formatted || dVal;
        fieldResolution[field] = {
          chosenValue: mergedFields[field],
          source: 'DUPLICATE',
          primaryValue: pVal,
          duplicateValue: dVal,
        };
      } else {
        const chosen = pVal || dVal || null;
        mergedFields[field] = chosen;
        fieldResolution[field] = {
          chosenValue: chosen,
          source: pVal ? 'PRIMARY' : 'DUPLICATE',
          primaryValue: pVal,
          duplicateValue: dVal,
        };
      }
      continue;
    }

    // Prefer non-empty and longer/more complete value
    const pHas = pVal !== null && pVal !== undefined && String(pVal).trim() !== '';
    const dHas = dVal !== null && dVal !== undefined && String(dVal).trim() !== '';

    let source: 'PRIMARY' | 'DUPLICATE' = 'PRIMARY';
    let chosenValue: unknown = pVal;

    if (!pHas && dHas) {
      source = 'DUPLICATE';
      chosenValue = dVal;
    } else if (pHas && dHas && (field === 'firstName' || field === 'lastName' || field === 'jobTitle')) {
      if (String(dVal).trim().length > String(pVal).trim().length + 2) {
        source = 'DUPLICATE';
        chosenValue = dVal;
      }
    }

    mergedFields[field] = chosenValue;
    fieldResolution[field] = {
      chosenValue,
      source,
      primaryValue: pVal,
      duplicateValue: dVal,
    };
  }

  // Combine customProperties without losing keys
  const combinedCustom = {
    ...(duplicate.customProperties || {}),
    ...(primary.customProperties || {}),
  };
  mergedFields.customProperties = combinedCustom;
  fieldResolution.customProperties = {
    chosenValue: combinedCustom,
    source: 'COMBINED',
    primaryValue: primary.customProperties,
    duplicateValue: duplicate.customProperties,
  };

  // Preserve highest leadScore
  mergedFields.leadScore = Math.max(primary.leadScore || 0, duplicate.leadScore || 0);

  const timelineEventsToMove = timelineEvents.filter((e) => e.contactId === duplicate.id).length;
  const dealsToMove = deals.filter((d) => d.contactId === duplicate.id).length;

  return {
    entityType: 'CONTACT',
    primaryId: primary.id,
    duplicateId: duplicate.id,
    matchReasons,
    confidenceScore,
    mergedFields,
    fieldResolution,
    timelineEventsToMove,
    dealsToMove,
  };
}

export function buildCompanyMergePlan(
  primary: Company,
  duplicate: Company,
  matchReasons: string[],
  confidenceScore: number,
  contacts: Contact[] = [],
  deals: Deal[] = [],
  timelineEvents: TimelineEvent[] = []
): SuggestedMergePlan {
  const fieldResolution: SuggestedMergePlan['fieldResolution'] = {};
  const mergedFields: Record<string, unknown> = {};

  const scalarFields: Array<keyof Company> = [
    'name',
    'domain',
    'cnpj',
    'industry',
    'size',
    'annualRevenue',
    'city',
    'state',
    'country',
  ];

  for (const field of scalarFields) {
    const pVal = primary[field];
    const dVal = duplicate[field];
    const pHas = pVal !== null && pVal !== undefined && String(pVal).trim() !== '';
    const dHas = dVal !== null && dVal !== undefined && String(dVal).trim() !== '';

    const usePrimary = pHas || !dHas;
    const chosenValue = usePrimary ? pVal : dVal;
    mergedFields[field] = chosenValue;
    fieldResolution[field] = {
      chosenValue,
      source: usePrimary ? 'PRIMARY' : 'DUPLICATE',
      primaryValue: pVal,
      duplicateValue: dVal,
    };
  }

  const combinedCustom = {
    ...(duplicate.customProperties || {}),
    ...(primary.customProperties || {}),
  };
  mergedFields.customProperties = combinedCustom;
  fieldResolution.customProperties = {
    chosenValue: combinedCustom,
    source: 'COMBINED',
    primaryValue: primary.customProperties,
    duplicateValue: duplicate.customProperties,
  };

  const timelineEventsToMove = timelineEvents.filter((e) => e.companyId === duplicate.id).length;
  const dealsToMove = deals.filter((d) => d.companyId === duplicate.id).length;
  const contactsToMove = contacts.filter((c) => c.companyId === duplicate.id).length;

  return {
    entityType: 'COMPANY',
    primaryId: primary.id,
    duplicateId: duplicate.id,
    matchReasons,
    confidenceScore,
    mergedFields,
    fieldResolution,
    timelineEventsToMove,
    dealsToMove,
    contactsToMove,
  };
}

export function detectDuplicateContacts(
  contacts: Contact[],
  deals: Deal[] = [],
  timelineEvents: TimelineEvent[] = []
): DuplicateCandidatePair<Contact>[] {
  const results: DuplicateCandidatePair<Contact>[] = [];

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const c1 = contacts[i];
      const c2 = contacts[j];

      const matchReasons: string[] = [];
      let maxConfidence = 0;

      // 1. Exact Email Match
      const e1 = validateEmail(c1.email);
      const e2 = validateEmail(c2.email);
      if (e1.normalizedEmail && e1.normalizedEmail === e2.normalizedEmail) {
        matchReasons.push(`E-mail idêntico (${e1.normalizedEmail})`);
        maxConfidence = Math.max(maxConfidence, 99);
      }

      // 2. Exact E.164 Phone Match
      const p1 = normalizeAndValidatePhone(c1.phone);
      const p2 = normalizeAndValidatePhone(c2.phone);
      if (p1.isValid && p2.isValid && p1.e164 && p1.e164 === p2.e164) {
        matchReasons.push(`Telefone E.164 idêntico (${p1.e164})`);
        maxConfidence = Math.max(maxConfidence, 94);
      }

      // 3. Fuzzy Full Name + Same Company or Same Corporate Domain
      const fullName1 = `${c1.firstName || ''} ${c1.lastName || ''}`.trim();
      const fullName2 = `${c2.firstName || ''} ${c2.lastName || ''}`.trim();
      const jwName = jaroWinklerSimilarity(fullName1, fullName2);
      const levName = levenshteinSimilarity(fullName1, fullName2);
      const bestNameSim = Math.max(jwName, levName);

      const sameCompany = Boolean(c1.companyId && c2.companyId && c1.companyId === c2.companyId);
      const sameCorpDomain = Boolean(
        e1.isCorporate && e2.isCorporate && e1.domain && e1.domain === e2.domain
      );
      const sameEmailLocalPrefix = Boolean(
        e1.normalizedEmail &&
          e2.normalizedEmail &&
          e1.normalizedEmail.split('@')[0].replace(/[._-]/g, '') ===
            e2.normalizedEmail.split('@')[0].replace(/[._-]/g, '')
      );

      if (bestNameSim >= 0.84 && (sameCompany || sameCorpDomain)) {
        const fuzzyScore = Math.min(93, Math.round(bestNameSim * 95));
        matchReasons.push(
          `Nome similar (${Math.round(bestNameSim * 100)}% Jaro-Winkler) + ${
            sameCompany ? 'mesma empresa vinculada' : `mesmo domínio corporativo (@${e1.domain})`
          }`
        );
        maxConfidence = Math.max(maxConfidence, fuzzyScore);
      } else if (bestNameSim >= 0.9 && sameEmailLocalPrefix) {
        const fuzzyScore = Math.min(89, Math.round(bestNameSim * 92));
        matchReasons.push(
          `Nome muito similar (${Math.round(bestNameSim * 100)}%) + mesmo prefixo de e-mail`
        );
        maxConfidence = Math.max(maxConfidence, fuzzyScore);
      }

      if (matchReasons.length > 0 && maxConfidence >= 75) {
        if (matchReasons.length >= 2) {
          maxConfidence = Math.min(100, maxConfidence + 3);
        }
        const { primary, duplicate } = choosePrimaryRecord(c1, c2);
        const suggestedMerge = buildContactMergePlan(
          primary,
          duplicate,
          matchReasons,
          maxConfidence,
          deals,
          timelineEvents
        );

        results.push({
          entityType: 'CONTACT',
          primary,
          duplicate,
          confidenceScore: maxConfidence,
          matchReasons,
          suggestedMerge,
        });
      }
    }
  }

  return results.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

export function detectDuplicateCompanies(
  companies: Company[],
  contacts: Contact[] = [],
  deals: Deal[] = [],
  timelineEvents: TimelineEvent[] = []
): DuplicateCandidatePair<Company>[] {
  const results: DuplicateCandidatePair<Company>[] = [];

  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const comp1 = companies[i];
      const comp2 = companies[j];

      const matchReasons: string[] = [];
      let maxConfidence = 0;

      // 1. Exact CNPJ match
      const cnpj1 = validateCnpj(comp1.cnpj);
      const cnpj2 = validateCnpj(comp2.cnpj);
      if (cnpj1. digits && cnpj2.digits && cnpj1.digits === cnpj2.digits) {
        matchReasons.push(`CNPJ idêntico (${cnpj1.formatted || cnpj1.digits})`);
        maxConfidence = Math.max(maxConfidence, 100);
      }

      // 2. Exact Corporate Domain match
      const dom1 = normalizeCorporateDomain(comp1.domain);
      const dom2 = normalizeCorporateDomain(comp2.domain);
      if (dom1.isValid && dom2.isValid && dom1.domain && dom1.domain === dom2.domain) {
        matchReasons.push(`Domínio corporativo idêntico (${dom1.domain})`);
        maxConfidence = Math.max(maxConfidence, 97);
      }

      // 3. Fuzzy Company Name similarity
      const clean1 = normalizeCompanyNameForComparison(comp1.name);
      const clean2 = normalizeCompanyNameForComparison(comp2.name);
      const jwName = jaroWinklerSimilarity(clean1, clean2);
      const levName = levenshteinSimilarity(clean1, clean2);
      const bestSim = Math.max(jwName, levName);

      if (bestSim >= 0.85) {
        const fuzzyScore = Math.min(92, Math.round(bestSim * 94));
        matchReasons.push(`Razão social / nome similar (${Math.round(bestSim * 100)}%)`);
        maxConfidence = Math.max(maxConfidence, fuzzyScore);
      }

      if (matchReasons.length > 0 && maxConfidence >= 75) {
        const { primary, duplicate } = choosePrimaryRecord(comp1, comp2);
        const suggestedMerge = buildCompanyMergePlan(
          primary,
          duplicate,
          matchReasons,
          maxConfidence,
          contacts,
          deals,
          timelineEvents
        );

        results.push({
          entityType: 'COMPANY',
          primary,
          duplicate,
          confidenceScore: maxConfidence,
          matchReasons,
          suggestedMerge,
        });
      }
    }
  }

  return results.sort((a, b) => b.confidenceScore - a.confidenceScore);
}
