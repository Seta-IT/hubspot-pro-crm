// ============================================================================
// Data Health & Hygiene - Weighted Completeness Score Engine (0-100)
// ============================================================================

import { Company, Contact } from '../../db/types';
import { normalizeAndValidatePhone, normalizeCorporateDomain, validateCnpj, validateEmail } from './validators';

export interface CompletenessResult {
  score: number;
  missingFields: string[];
  breakdown: Record<string, { earned: number; max: number; satisfied: boolean }>;
  isCriticalIncomplete: boolean;
}

/**
 * Calcula de 0 a 100 o índice de preenchimento ponderado de Contatos:
 * - email: 25 pts
 * - phone: 20 pts
 * - nome (firstName + lastName): 15 pts
 * - cargo (jobTitle): 15 pts
 * - empresa vinculada (companyId): 15 pts
 * - estágio do funil (lifecycleStage): 10 pts
 */
export function calculateContactCompleteness(contact: Partial<Contact>): CompletenessResult {
  const breakdown: Record<string, { earned: number; max: number; satisfied: boolean }> = {};
  const missingFields: string[] = [];

  // 1. E-mail (25 pts)
  const emailCheck = validateEmail(contact.email);
  const hasValidEmail = emailCheck.isValid;
  breakdown.email = { earned: hasValidEmail ? 25 : 0, max: 25, satisfied: hasValidEmail };
  if (!hasValidEmail) missingFields.push('email');

  // 2. Telefone (20 pts)
  const phoneCheck = normalizeAndValidatePhone(contact.phone);
  const hasValidPhone = phoneCheck.isValid;
  breakdown.phone = { earned: hasValidPhone ? 20 : 0, max: 20, satisfied: hasValidPhone };
  if (!hasValidPhone) missingFields.push('phone');

  // 3. Nome completo (15 pts)
  const hasFirst = Boolean(contact.firstName && contact.firstName.trim().length > 0);
  const hasLast = Boolean(contact.lastName && contact.lastName.trim().length > 0);
  const nameEarned = hasFirst && hasLast ? 15 : hasFirst ? 8 : 0;
  breakdown.name = { earned: nameEarned, max: 15, satisfied: nameEarned === 15 };
  if (nameEarned < 15) missingFields.push(hasFirst ? 'lastName' : 'firstName');

  // 4. Cargo / Job Title (15 pts)
  const hasJobTitle = Boolean(contact.jobTitle && contact.jobTitle.trim().length > 0);
  breakdown.jobTitle = { earned: hasJobTitle ? 15 : 0, max: 15, satisfied: hasJobTitle };
  if (!hasJobTitle) missingFields.push('jobTitle');

  // 5. Empresa vinculada / companyId (15 pts)
  const hasCompany = Boolean(contact.companyId && contact.companyId.trim().length > 0);
  breakdown.companyId = { earned: hasCompany ? 15 : 0, max: 15, satisfied: hasCompany };
  if (!hasCompany) missingFields.push('companyId');

  // 6. Estágio do funil / lifecycleStage (10 pts)
  const hasStage = Boolean(contact.lifecycleStage && contact.lifecycleStage.trim().length > 0);
  breakdown.lifecycleStage = { earned: hasStage ? 10 : 0, max: 10, satisfied: hasStage };
  if (!hasStage) missingFields.push('lifecycleStage');

  const score = Object.values(breakdown).reduce((sum, item) => sum + item.earned, 0);

  return {
    score: Math.min(100, Math.max(0, score)),
    missingFields,
    breakdown,
    isCriticalIncomplete: score < 65 || !hasValidEmail || (!hasValidPhone && !hasCompany),
  };
}

/**
 * Calcula de 0 a 100 o índice de preenchimento ponderado de Empresas:
 * - domínio (domain): 30 pts
 * - nome (name): 20 pts
 * - CNPJ/taxId (cnpj): 20 pts
 * - setor (industry): 15 pts
 * - porte/receita (size / annualRevenue): 15 pts
 */
export function calculateCompanyCompleteness(company: Partial<Company>): CompletenessResult {
  const breakdown: Record<string, { earned: number; max: number; satisfied: boolean }> = {};
  const missingFields: string[] = [];

  // 1. Domínio (30 pts)
  const domainCheck = normalizeCorporateDomain(company.domain);
  const hasDomain = domainCheck.isValid;
  breakdown.domain = { earned: hasDomain ? 30 : 0, max: 30, satisfied: hasDomain };
  if (!hasDomain) missingFields.push('domain');

  // 2. Nome (20 pts)
  const hasName = Boolean(company.name && company.name.trim().length >= 2);
  breakdown.name = { earned: hasName ? 20 : 0, max: 20, satisfied: hasName };
  if (!hasName) missingFields.push('name');

  // 3. CNPJ / taxId (20 pts)
  const cnpjCheck = validateCnpj(company.cnpj);
  const hasCnpj = cnpjCheck.isValid;
  breakdown.cnpj = { earned: hasCnpj ? 20 : 0, max: 20, satisfied: hasCnpj };
  if (!hasCnpj) missingFields.push('cnpj');

  // 4. Setor / Industry (15 pts)
  const hasIndustry = Boolean(company.industry && company.industry.trim().length > 0);
  breakdown.industry = { earned: hasIndustry ? 15 : 0, max: 15, satisfied: hasIndustry };
  if (!hasIndustry) missingFields.push('industry');

  // 5. Porte / Receita (15 pts)
  const hasSize = Boolean(company.size && company.size.trim().length > 0);
  const hasRevenue = typeof company.annualRevenue === 'number' && company.annualRevenue > 0;
  const sizeRevenueEarned = hasSize && hasRevenue ? 15 : hasSize || hasRevenue ? 15 : 0;
  breakdown.sizeOrRevenue = {
    earned: sizeRevenueEarned,
    max: 15,
    satisfied: sizeRevenueEarned === 15,
  };
  if (sizeRevenueEarned === 0) missingFields.push('size');

  const score = Object.values(breakdown).reduce((sum, item) => sum + item.earned, 0);

  return {
    score: Math.min(100, Math.max(0, score)),
    missingFields,
    breakdown,
    isCriticalIncomplete: score < 65 || !hasDomain || !hasName,
  };
}
