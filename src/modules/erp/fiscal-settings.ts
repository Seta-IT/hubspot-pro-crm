// ============================================================================
// Configurações Fiscais do ERP (espelho da tela Fiscal do GestaoClick)
//  - NF-e (mod. 55), NFC-e (mod. 65), NFS-e (RPS), autorização de download do XML (autXML)
//    e certificado digital (só modelo de dados; upload desabilitado — "em breve").
//  - Ambiente padrão de TODOS os documentos: HOMOLOGAÇÃO. Ir para Produção exige confirmação
//    explícita + alçada fiscal (canIssueFiscalDocuments) ou administrador, com auditoria (router).
//  - Numeração separada por ambiente no numerador atômico do #11 (repository.reserveFiscalNumber).
//  - CSC é segredo: nunca devolvido em claro (só máscara) e nunca registrado em log/auditoria.
//  - CNPJ, regime tributário e município do emitente NÃO são editáveis aqui (só leitura).
// ============================================================================
import { z } from 'zod';
import type {
  FiscalDocumentSettings,
  FiscalEnvironment,
  GestaoClickConfig,
  NfseOperationNature,
  NfseSpecialRegime,
  NfseStandard,
  NfseTaxApportionment,
} from '../../db/types';
import { validateCnpj, validateCpf } from '../data-health/validators';

export const FISCAL_ENVIRONMENTS: readonly FiscalEnvironment[] = ['HOMOLOGACAO', 'PRODUCAO'];

/** Literal exigido no corpo do PUT para ir de Homologação para Produção. */
export const FISCAL_PRODUCTION_CONFIRMATION = 'CONFIRMO_PRODUCAO';

/** Modelos do numerador (chave do reserveFiscalNumber). */
export const FISCAL_MODEL_NFE = '55';
export const FISCAL_MODEL_NFCE = '65';
export const FISCAL_MODEL_RPS = 'RPS';

/**
 * Últimos números já emitidos em PRODUÇÃO pelo GestaoClick (prints do Marcéllo, 02/11/2026).
 * Entram como seed do numerador de produção: próxima NF-e de produção = 2177.
 */
export const FISCAL_PRODUCTION_SEED: ReadonlyArray<{ modelo: string; serie: string; lastIssued: number; label: string }> =
  Object.freeze([
    { modelo: FISCAL_MODEL_NFE, serie: '1', lastIssued: 2176, label: 'NF-e' },
    { modelo: FISCAL_MODEL_NFCE, serie: '2', lastIssued: 0, label: 'NFC-e' },
    { modelo: FISCAL_MODEL_RPS, serie: '10001', lastIssued: 735, label: 'RPS (NFS-e)' },
  ]);

export const FISCAL_PRODUCTION_GESTAOCLICK_WARNING =
  'Atenção: ao emitir em PRODUÇÃO pelo ERP, o GestaoClick deve PARAR de emitir na mesma série. ' +
  'Duas origens emitindo na mesma série geram números duplicados e rejeição na SEFAZ/prefeitura.';

export const FISCAL_TAX_REGIME_NOTE = 'aguardando confirmação';

export const NFSE_STANDARD_LABELS: Record<NfseStandard, string> = {
  INTEGRADORA: 'Integradora',
  NACIONAL: 'Padrão Nacional (NFS-e Nacional)',
};

export const NFSE_OPERATION_NATURE_LABELS: Record<NfseOperationNature, string> = {
  TRIBUTAVEL_NAO_RETER_PIS_COFINS: 'Operação tributável - Não reter PIS/Cofins',
  TRIBUTAVEL_RETER_PIS_COFINS: 'Operação tributável - Reter PIS/Cofins',
  TRIBUTACAO_FORA_MUNICIPIO: 'Tributação fora do município',
  ISENCAO: 'Isenção',
  IMUNE: 'Imune',
  EXIGIBILIDADE_SUSPENSA_JUDICIAL: 'Exigibilidade suspensa por decisão judicial',
  EXIGIBILIDADE_SUSPENSA_ADMINISTRATIVA: 'Exigibilidade suspensa por procedimento administrativo',
};

export const NFSE_SPECIAL_REGIME_LABELS: Record<NfseSpecialRegime, string> = {
  NENHUM: 'Nenhum',
  MICROEMPRESA_MUNICIPAL: 'Microempresa municipal',
  ESTIMATIVA: 'Estimativa',
  SOCIEDADE_PROFISSIONAIS: 'Sociedade de profissionais',
  COOPERATIVA: 'Cooperativa',
  MEI: 'Microempresário Individual (MEI)',
  MEEPP: 'Microempresário e Empresa de Pequeno Porte (MEEPP)',
};

export const NFSE_TAX_APPORTIONMENT_LABELS: Record<NfseTaxApportionment, string> = {
  '': 'Selecione',
  SN_FEDERAIS_E_MUNICIPAL: 'Tributos federais e municipal apurados pelo Simples Nacional',
  SN_FEDERAIS_ISSQN_FORA: 'Federais pelo Simples Nacional e ISSQN fora do SN (legislação municipal)',
  FORA_DO_SN: 'Tributos federais e municipal fora do Simples Nacional',
};

export const DEFAULT_NFE_ADDITIONAL_INFO =
  'Empresa ME ou EPP optante pelo simples nacional, não gera direito a crédito fiscal de ISS e IPI';

/** Padrão do ERP: tudo em HOMOLOGAÇÃO; séries e opções iguais às do GestaoClick. */
export function createDefaultFiscalDocumentSettings(): FiscalDocumentSettings {
  return {
    nfe: {
      environment: 'HOMOLOGACAO',
      serie: '1',
      removeIcmsFromPisCofinsBase: false,
      simplifiedDanfe: false,
      additionalInfo: DEFAULT_NFE_ADDITIONAL_INFO,
    },
    nfce: {
      environment: 'HOMOLOGACAO',
      serie: '2',
      tokenId: '000001',
      csc: '',
      additionalInfo: '',
    },
    nfse: {
      standard: 'INTEGRADORA',
      environment: 'HOMOLOGACAO',
      rpsSerie: '10001',
      operationNature: 'TRIBUTAVEL_NAO_RETER_PIS_COFINS',
      specialRegime: 'MEEPP',
      taxApportionment: '',
      cityClassification: '',
      cityOperationIndicator: '',
      additionalInfo: '',
    },
    xmlDownloadAuthorizations: [],
    certificate: { status: 'NAO_CONFIGURADO', validUntil: null, certificateCnpj: null, uploadEnabled: false },
    productionSeedApplied: false,
    updatedAt: null,
    updatedBy: null,
  };
}

/** Completa um registro persistido antigo/parcial com os padrões (leitura tolerante). */
export function normalizeFiscalDocumentSettings(raw: unknown): FiscalDocumentSettings {
  const d = createDefaultFiscalDocumentSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<FiscalDocumentSettings>;
  const env = (v: unknown): FiscalEnvironment => (v === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO');
  return {
    nfe: { ...d.nfe, ...(r.nfe || {}), environment: env(r.nfe?.environment) },
    nfce: { ...d.nfce, ...(r.nfce || {}), environment: env(r.nfce?.environment) },
    nfse: { ...d.nfse, ...(r.nfse || {}), environment: env(r.nfse?.environment) },
    xmlDownloadAuthorizations: Array.isArray(r.xmlDownloadAuthorizations)
      ? r.xmlDownloadAuthorizations.map((v) => String(v || '').replace(/\D/g, '')).filter(Boolean)
      : [],
    // Certificado: nunca vem com .pfx/senha; upload sempre desabilitado nesta versão.
    certificate: {
      status: r.certificate?.status === 'VALIDO' || r.certificate?.status === 'VENCIDO' ? r.certificate.status : 'NAO_CONFIGURADO',
      validUntil: r.certificate?.validUntil ?? null,
      certificateCnpj: r.certificate?.certificateCnpj ?? null,
      uploadEnabled: false,
    },
    productionSeedApplied: Boolean(r.productionSeedApplied),
    updatedAt: r.updatedAt ?? null,
    updatedBy: r.updatedBy ?? null,
  };
}

/** Máscara do CSC: só os 4 últimos caracteres. Vazio => ''. */
export function maskCsc(csc: string | null | undefined): string {
  const v = String(csc || '');
  if (!v) return '';
  const tail = v.length > 8 ? v.slice(-4) : '';
  return `${'•'.repeat(12)}${tail}`;
}

/** CPF ou CNPJ com DV válido => só dígitos; caso contrário null. */
export function normalizeCpfOrCnpj(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11) return validateCpf(digits).isValid ? digits : null;
  if (digits.length === 14) return validateCnpj(digits).isValid ? digits : null;
  return null;
}

export function formatCpfOrCnpj(digits: string): string {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

// ----------------------------------------------------------------------------
// Validação do PUT (zod .strict(): campo fora da allowlist => 400)
// ----------------------------------------------------------------------------
const envSchema = z.enum(['HOMOLOGACAO', 'PRODUCAO']);
const serieSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, 'série deve ter de 1 a 3 dígitos')
  .refine((v) => Number(v) >= 0 && Number(v) <= 999, 'série entre 0 e 999');
const infoSchema = z.string().max(2000, 'informações complementares com no máximo 2000 caracteres');

export const FiscalSettingsUpdateSchema = z
  .object({
    nfe: z
      .object({
        environment: envSchema.optional(),
        serie: serieSchema.optional(),
        removeIcmsFromPisCofinsBase: z.boolean().optional(),
        simplifiedDanfe: z.boolean().optional(),
        additionalInfo: infoSchema.optional(),
      })
      .strict()
      .optional(),
    nfce: z
      .object({
        environment: envSchema.optional(),
        serie: serieSchema.optional(),
        tokenId: z.string().trim().regex(/^\d{1,6}$/, 'ID do token: até 6 dígitos').optional(),
        // CSC: 16 a 36 caracteres alfanuméricos (gerado na SEFAZ). '' limpa o CSC.
        csc: z
          .string()
          .trim()
          .refine((v) => v === '' || /^[A-Za-z0-9]{16,36}$/.test(v), 'CSC deve ter de 16 a 36 caracteres alfanuméricos')
          .optional(),
        additionalInfo: infoSchema.optional(),
      })
      .strict()
      .optional(),
    nfse: z
      .object({
        standard: z.enum(['INTEGRADORA', 'NACIONAL']).optional(),
        environment: envSchema.optional(),
        rpsSerie: z.string().trim().regex(/^\d{1,5}$/, 'série do RPS: até 5 dígitos').optional(),
        operationNature: z
          .enum([
            'TRIBUTAVEL_NAO_RETER_PIS_COFINS',
            'TRIBUTAVEL_RETER_PIS_COFINS',
            'TRIBUTACAO_FORA_MUNICIPIO',
            'ISENCAO',
            'IMUNE',
            'EXIGIBILIDADE_SUSPENSA_JUDICIAL',
            'EXIGIBILIDADE_SUSPENSA_ADMINISTRATIVA',
          ])
          .optional(),
        specialRegime: z
          .enum(['NENHUM', 'MICROEMPRESA_MUNICIPAL', 'ESTIMATIVA', 'SOCIEDADE_PROFISSIONAIS', 'COOPERATIVA', 'MEI', 'MEEPP'])
          .optional(),
        taxApportionment: z.enum(['', 'SN_FEDERAIS_E_MUNICIPAL', 'SN_FEDERAIS_ISSQN_FORA', 'FORA_DO_SN']).optional(),
        cityClassification: z.string().trim().max(60).optional(),
        cityOperationIndicator: z.string().trim().max(60).optional(),
        additionalInfo: infoSchema.optional(),
      })
      .strict()
      .optional(),
    // autXML: até 10 CPF/CNPJ (limite do leiaute NF-e 4.00), DV validado
    xmlDownloadAuthorizations: z
      .array(z.string().trim().max(18))
      .max(10, 'no máximo 10 CPF/CNPJ autorizados')
      .superRefine((list, ctx) => {
        list.forEach((v, i) => {
          if (!normalizeCpfOrCnpj(v)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: `CPF/CNPJ inválido (DV): ${v}` });
          }
        });
      })
      .optional(),
    confirmProductionSwitch: z.literal(FISCAL_PRODUCTION_CONFIRMATION).optional(),
  })
  .strict();

export type FiscalSettingsUpdate = z.infer<typeof FiscalSettingsUpdateSchema>;

export function parseFiscalSettingsUpdate(
  body: unknown
): { ok: true; data: FiscalSettingsUpdate } | { ok: false; issues: Array<{ path: string; message: string }> } {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const r = FiscalSettingsUpdateSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({
      path: i.path.join('.') || '(corpo)',
      // Nunca ecoa o valor do CSC na mensagem de erro.
      message: i.path[0] === 'nfce' && i.path[1] === 'csc' ? 'CSC inválido' : i.code === 'unrecognized_keys' ? `campo(s) não aceito(s): ${(i as { keys?: string[] }).keys?.join(', ')}` : i.message,
    })),
  };
}

export type FiscalDocKey = 'nfe' | 'nfce' | 'nfse';

export interface FiscalSettingsChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Aplica o PUT validado. Devolve o novo estado, a lista de mudanças (CSC sempre redigido) e
 * quais documentos estão passando de HOMOLOGAÇÃO para PRODUÇÃO.
 */
export function applyFiscalSettingsUpdate(
  current: FiscalDocumentSettings,
  patch: FiscalSettingsUpdate
): { next: FiscalDocumentSettings; changes: FiscalSettingsChange[]; productionSwitches: FiscalDocKey[] } {
  const next: FiscalDocumentSettings = JSON.parse(JSON.stringify(current));
  const changes: FiscalSettingsChange[] = [];
  const productionSwitches: FiscalDocKey[] = [];
  const docs: FiscalDocKey[] = ['nfe', 'nfce', 'nfse'];
  for (const doc of docs) {
    const p = patch[doc] as Record<string, unknown> | undefined;
    if (!p) continue;
    const target = next[doc] as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      const before = target[k];
      if (before === v) continue;
      if (doc === 'nfe' || doc === 'nfce' || doc === 'nfse') {
        if (k === 'environment' && before === 'HOMOLOGACAO' && v === 'PRODUCAO') productionSwitches.push(doc);
      }
      target[k] = v;
      const secret = doc === 'nfce' && k === 'csc';
      changes.push({
        field: `${doc}.${k}`,
        before: secret ? (before ? '[CSC REDIGIDO]' : '(vazio)') : before,
        after: secret ? (v ? '[CSC REDIGIDO]' : '(vazio)') : v,
      });
    }
  }
  if (patch.xmlDownloadAuthorizations) {
    const list = Array.from(
      new Set(patch.xmlDownloadAuthorizations.map((v) => normalizeCpfOrCnpj(v)).filter((v): v is string => Boolean(v)))
    );
    if (JSON.stringify(list) !== JSON.stringify(current.xmlDownloadAuthorizations)) {
      changes.push({ field: 'xmlDownloadAuthorizations', before: current.xmlDownloadAuthorizations, after: list });
      next.xmlDownloadAuthorizations = list;
    }
  }
  return { next, changes, productionSwitches };
}

export interface FiscalNumberingView {
  modelo: string;
  serie: string;
  /** Último número usado/reservado por ambiente (0 = nenhum) */
  lastIssued: Record<FiscalEnvironment, number>;
  /** Próximo número por ambiente */
  next: Record<FiscalEnvironment, number>;
}

export type FiscalPeekFn = (modelo: string, serie: string, environment: FiscalEnvironment) => number;

function numbering(modelo: string, serie: string, peek: FiscalPeekFn): FiscalNumberingView {
  const nh = peek(modelo, serie, 'HOMOLOGACAO');
  const np = peek(modelo, serie, 'PRODUCAO');
  return {
    modelo,
    serie,
    lastIssued: { HOMOLOGACAO: nh - 1, PRODUCAO: np - 1 },
    next: { HOMOLOGACAO: nh, PRODUCAO: np },
  };
}

/** Visão devolvida no GET: CSC mascarado, numeração por ambiente e emitente só leitura. */
export function toFiscalSettingsView(settings: FiscalDocumentSettings, cfg: GestaoClickConfig | null | undefined, peek: FiscalPeekFn) {
  const { csc, ...nfceRest } = settings.nfce;
  return {
    nfe: { ...settings.nfe, numbering: numbering(FISCAL_MODEL_NFE, settings.nfe.serie, peek) },
    nfce: {
      ...nfceRest,
      cscConfigured: Boolean(csc),
      cscMasked: maskCsc(csc),
      numbering: numbering(FISCAL_MODEL_NFCE, settings.nfce.serie, peek),
    },
    nfse: { ...settings.nfse, numbering: numbering(FISCAL_MODEL_RPS, settings.nfse.rpsSerie, peek) },
    xmlDownloadAuthorizations: settings.xmlDownloadAuthorizations.map((d) => ({ document: d, formatted: formatCpfOrCnpj(d), type: d.length === 11 ? 'CPF' : 'CNPJ' })),
    certificate: { ...settings.certificate, uploadEnabled: false as const, note: 'Upload do certificado digital A1 (.pfx): em breve.' },
    emitter: {
      // Somente leitura: CNPJ, regime e município não são alterados por esta tela.
      companyLegalName: cfg?.companyLegalName || '',
      companyCnpj: cfg?.companyCnpj || '',
      taxRegime: cfg?.taxRegime || null,
      taxRegimeNote: FISCAL_TAX_REGIME_NOTE,
      readOnly: true as const,
    },
    productionWarning: FISCAL_PRODUCTION_GESTAOCLICK_WARNING,
    productionConfirmationToken: FISCAL_PRODUCTION_CONFIRMATION,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

export type FiscalSettingsView = ReturnType<typeof toFiscalSettingsView>;
