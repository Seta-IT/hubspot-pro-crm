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
