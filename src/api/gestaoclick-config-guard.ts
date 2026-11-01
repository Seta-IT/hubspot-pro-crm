// ============================================================================
// Pacote I (01/11/2026): PATCH/POST /api/erp/gestaoclick/config (dados fiscais da empresa).
//  - Antes: o corpo inteiro era gravado em gestaoClickConfig por qualquer usuario com ERP
//    (vendedor mudava ISS, regime, CNPJ, auto-NF, syncHistory...). Afeta a emissao fiscal.
//  - Agora: zod .strict() com allowlist FECHADA so dos campos editaveis pela tela de config
//    (ErpGestaoClickTab: "Editar Parametros Fiscais", "Editar Dados da Empresa" e o seletor de
//    regime). Qualquer outro campo => 400. A guarda de permissao (2FA + admin/ERP FULL) e a
//    auditoria antes/depois ficam no router.
//  - Leitura: toGestaoClickConfigView remove de quem nao e admin/ERP FULL os campos tecnicos
//    (tokens mascarados, URLs da API/MCP, usuarios do GestaoClick) e encurta a mascara do token.
// ============================================================================
import { z } from 'zod';
import type { GestaoClickConfig } from '../db/types';
import { validateCnpj } from '../modules/data-health/validators';

/** Campos que NUNCA entram pelo corpo (credenciais, endpoints, estado calculado/sincronizado). */
export const GESTAOCLICK_CONFIG_FORBIDDEN_KEYS: readonly string[] = Object.freeze([
  'apiBaseUrl',
  'mcpServerUrl',
  'accessTokenMasked',
  'secretTokenMasked',
  'syncHistory',
  'liveTotals',
  'users',
]);

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const GestaoClickConfigPatchSchema = z
  .object({
    companyLegalName: text(2, 200).optional(),
    companyCnpj: text(14, 18)
      // Mesma trava de /api/admin/settings: CNPJ valido e da raiz oficial da Seta (14.806.925).
      .refine((v) => {
        const c = validateCnpj(v);
        return c.isValid && Boolean(c.digits?.startsWith('14806925'));
      }, { message: 'CNPJ inválido ou fora da raiz 14.806.925' })
      .optional(),
    municipalRegistration: z.string().trim().max(40).optional(),
    stateRegistration: z.string().trim().max(40).optional(),
    storeName: text(1, 120).optional(),
    taxRegime: z.enum(['LUCRO_PRESUMIDO', 'LUCRO_REAL', 'SIMPLES_NACIONAL']).optional(),
    // ISSQN (LC 116/2003): teto legal de 5%.
    defaultIssRatePercent: z.number().finite().min(0).max(5).optional(),
  })
  .strict();

export type GestaoClickConfigPatch = z.infer<typeof GestaoClickConfigPatchSchema>;
export const GESTAOCLICK_CONFIG_EDITABLE_KEYS = Object.freeze(
  Object.keys(GestaoClickConfigPatchSchema.shape) as Array<keyof GestaoClickConfigPatch>
);

const isMaskedKey = (k: string) => /masked$/i.test(k);
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORBIDDEN_NORM = new Set(GESTAOCLICK_CONFIG_FORBIDDEN_KEYS.map(norm));

export function parseGestaoClickConfigPatch(
  body: unknown
):
  | { ok: true; data: GestaoClickConfigPatch }
  | { ok: false; code: 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED' | 'GESTAOCLICK_CONFIG_INVALID' | 'GESTAOCLICK_CONFIG_EMPTY'; fields: string[] } {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const keys = Object.keys(raw);
  const forbidden = keys.filter((k) => FORBIDDEN_NORM.has(norm(k)) || isMaskedKey(k));
  if (forbidden.length > 0) return { ok: false, code: 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED', fields: forbidden };
  if (keys.length === 0) return { ok: false, code: 'GESTAOCLICK_CONFIG_EMPTY', fields: [] };
  const r = GestaoClickConfigPatchSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const unknown = new Set<string>();
  const invalid = new Set<string>();
  for (const issue of r.error.issues) {
    if (issue.code === 'unrecognized_keys') for (const k of issue.keys) unknown.add(k);
    else invalid.add(issue.path.join('.') || '(corpo)');
  }
  if (unknown.size > 0) return { ok: false, code: 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED', fields: [...unknown] };
  return { ok: false, code: 'GESTAOCLICK_CONFIG_INVALID', fields: [...invalid] };
}

/** Antes/depois so dos campos editaveis que mudaram (nenhum segredo entra aqui). */
export function diffGestaoClickConfig(
  before: Partial<GestaoClickConfig>,
  after: Partial<GestaoClickConfig>
): Array<{ field: string; before: unknown; after: unknown }> {
  const out: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const k of GESTAOCLICK_CONFIG_EDITABLE_KEYS) {
    const b = (before as Record<string, unknown>)[k];
    const a = (after as Record<string, unknown>)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field: k, before: b ?? null, after: a ?? null });
  }
  return out;
}

/** Mascara curta: so os 4 ultimos caracteres visiveis (o resto da mascara gravada e descartado). */
export function shortMask(masked: unknown): string {
  const s = String(masked || '').replace(/[•*]/g, '');
  if (!s) return '';
  return `••••${s.slice(-4)}`;
}

/**
 * Projecao de leitura da config. privileged = contexto interno, ou sessao 2FA de admin/ERP FULL.
 * Nao privilegiado: sem tokens mascarados, sem URLs da API/MCP e sem a lista de usuarios.
 */
export function toGestaoClickConfigView<T extends Partial<GestaoClickConfig>>(cfg: T, privileged: boolean): T {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out = { ...cfg } as Record<string, unknown>;
  if (privileged) {
    if ('accessTokenMasked' in out) out.accessTokenMasked = shortMask(out.accessTokenMasked);
    if ('secretTokenMasked' in out) out.secretTokenMasked = shortMask(out.secretTokenMasked);
    return out as T;
  }
  for (const k of ['accessTokenMasked', 'secretTokenMasked']) if (k in out) out[k] = out[k] ? '••••' : '';
  delete out.apiBaseUrl;
  delete out.mcpServerUrl;
  delete out.users;
  return out as T;
}
