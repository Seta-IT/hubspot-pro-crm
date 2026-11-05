// ============================================================================
// STI-hub — Persistencia dos Dados da Empresa / Emitente (t143u).
// Linha propria do crm_kv_store (key = erp_company_emitter_v1), fora do estado crm_state_v1:
// bootstrap, overview e o sync completo do estado nao precisam carregar o JSON inteiro para
// ler so o endereco. Sem criptografia: so razao social, endereco e dados fiscais publicos.
// ============================================================================
import { ensurePostgresSchema, getPostgresPool, isPostgresEnabled } from '../../db/postgres';
import {
  DEFAULT_COMPANY_EMITTER_SETTINGS,
  type StiHubCompanyEmitterSettings,
} from './daily-sync-service';

export const COMPANY_EMITTER_KV_KEY = 'erp_company_emitter_v1';

export interface CompanyEmitterStore {
  load(): Promise<StiHubCompanyEmitterSettings | null>;
  save(rec: StiHubCompanyEmitterSettings): Promise<void>;
}

export class MemoryCompanyEmitterStore implements CompanyEmitterStore {
  private rec: StiHubCompanyEmitterSettings | null = null;
  async load(): Promise<StiHubCompanyEmitterSettings | null> {
    return this.rec ? (JSON.parse(JSON.stringify(this.rec)) as StiHubCompanyEmitterSettings) : null;
  }
  async save(rec: StiHubCompanyEmitterSettings): Promise<void> {
    this.rec = JSON.parse(JSON.stringify(rec)) as StiHubCompanyEmitterSettings;
  }
}

export class PostgresCompanyEmitterStore implements CompanyEmitterStore {
  async load(): Promise<StiHubCompanyEmitterSettings | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensurePostgresSchema(pool);
    const r = await pool.query<{ payload: StiHubCompanyEmitterSettings }>(
      `SELECT payload FROM crm_kv_store WHERE key = $1 LIMIT 1`,
      [COMPANY_EMITTER_KV_KEY]
    );
    const row = r.rows[0]?.payload;
    if (!row || typeof row !== 'object') return null;
    return row;
  }
  async save(rec: StiHubCompanyEmitterSettings): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('Postgres indisponivel para gravar Dados da Empresa');
    await ensurePostgresSchema(pool);
    await pool.query(
      `INSERT INTO crm_kv_store (key, payload, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [COMPANY_EMITTER_KV_KEY, JSON.stringify(rec)]
    );
  }
}

let defaultStore: CompanyEmitterStore | null = null;

export function getDefaultCompanyEmitterStore(): CompanyEmitterStore {
  if (!defaultStore) {
    defaultStore = isPostgresEnabled() ? new PostgresCompanyEmitterStore() : new MemoryCompanyEmitterStore();
  }
  return defaultStore;
}

/** Mescla o gravado com o padrao (campos novos do codigo nao somem se o JSON antigo nao tiver). */
export function mergeCompanyEmitter(
  stored: Partial<StiHubCompanyEmitterSettings> | null | undefined
): StiHubCompanyEmitterSettings {
  return {
    ...DEFAULT_COMPANY_EMITTER_SETTINGS,
    ...(stored && typeof stored === 'object' ? stored : {}),
  };
}

export async function loadCompanyEmitterSettings(
  store: CompanyEmitterStore = getDefaultCompanyEmitterStore()
): Promise<StiHubCompanyEmitterSettings> {
  try {
    return mergeCompanyEmitter(await store.load());
  } catch {
    return structuredClone(DEFAULT_COMPANY_EMITTER_SETTINGS);
  }
}

export async function saveCompanyEmitterSettings(
  rec: StiHubCompanyEmitterSettings,
  store: CompanyEmitterStore = getDefaultCompanyEmitterStore()
): Promise<void> {
  await store.save(mergeCompanyEmitter(rec));
}

/** Campos aceitos no PUT/PATCH de Dados da Empresa (lista fechada — CISO 05/11). */
export const COMPANY_EMITTER_ALLOWED_FIELDS = [
  'legalName',
  'tradeName',
  'cnpj',
  'stateRegistration',
  'municipalRegistration',
  'cnaeMain',
  'taxRegime',
  'cep',
  'addressStreet',
  'addressNumber',
  'addressComplement',
  'neighborhood',
  'city',
  'state',
  'ibgeCode',
  'phone',
  'financialEmail',
  'defaultBankInterAccount',
  'defaultBankItauAccount',
] as const;

export type CompanyEmitterField = (typeof COMPANY_EMITTER_ALLOWED_FIELDS)[number];

/** Teto por campo de texto (evita JSON gigante no crm_kv_store). */
export const COMPANY_EMITTER_FIELD_MAX_LEN = 200;
export const COMPANY_EMITTER_TAX_REGIMES = ['LUCRO_PRESUMIDO', 'LUCRO_REAL', 'SIMPLES_NACIONAL'] as const;

export type ParseCompanyEmitterResult =
  | { ok: true; patch: Partial<StiHubCompanyEmitterSettings> }
  | { ok: false; code: 'COMPANY_EMITTER_UNKNOWN_FIELDS' | 'COMPANY_EMITTER_FIELD_INVALID'; fields: string[]; error: string };

/**
 * Allowlist + tipos + tamanho. Chaves extras ou valor invalido => 400 (nada e aplicado).
 * Campos omitidos nao entram no patch (PATCH parcial).
 */
export function parseCompanyEmitterPatch(raw: unknown): ParseCompanyEmitterResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'COMPANY_EMITTER_FIELD_INVALID',
      fields: [],
      error: 'Os Dados da Empresa devem ser enviados como objeto.',
    };
  }
  const body = raw as Record<string, unknown>;
  const allowed = new Set<string>(COMPANY_EMITTER_ALLOWED_FIELDS);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    return {
      ok: false,
      code: 'COMPANY_EMITTER_UNKNOWN_FIELDS',
      fields: unknown.slice(0, 20),
      error: `Campo(s) não aceito(s) nos Dados da Empresa: ${unknown.slice(0, 20).join(', ')}.`,
    };
  }
  const patch: Partial<StiHubCompanyEmitterSettings> = {};
  const invalid: string[] = [];
  for (const key of COMPANY_EMITTER_ALLOWED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const val = body[key];
    if (key === 'taxRegime') {
      if (typeof val !== 'string' || !(COMPANY_EMITTER_TAX_REGIMES as readonly string[]).includes(val)) {
        invalid.push(key);
        continue;
      }
      patch.taxRegime = val as StiHubCompanyEmitterSettings['taxRegime'];
      continue;
    }
    if (typeof val !== 'string') {
      invalid.push(key);
      continue;
    }
    if (val.length > COMPANY_EMITTER_FIELD_MAX_LEN) {
      invalid.push(key);
      continue;
    }
    (patch as Record<string, string>)[key] = val;
  }
  if (invalid.length) {
    return {
      ok: false,
      code: 'COMPANY_EMITTER_FIELD_INVALID',
      fields: invalid,
      error: `Campo(s) inválido(s) nos Dados da Empresa (texto até ${COMPANY_EMITTER_FIELD_MAX_LEN} caracteres; taxRegime: LUCRO_PRESUMIDO | LUCRO_REAL | SIMPLES_NACIONAL): ${invalid.join(', ')}.`,
    };
  }
  return { ok: true, patch };
}
