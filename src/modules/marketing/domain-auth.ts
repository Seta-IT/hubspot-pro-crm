// ============================================================================
// STI-hub — Fase 3: verificacao SPF / DKIM / DMARC do dominio remetente (somente leitura, DNS TXT).
// Envio real de campanha e BLOQUEADO se o dominio nao passar. Resolver injetavel (testes sem rede).
// ============================================================================
import dns from 'node:dns';

export type TxtResolver = (host: string) => Promise<string[][]>;

export interface DomainCheckItem {
  ok: boolean;
  host: string;
  record: string | null;
  detail: string;
}

export interface DomainAuthResult {
  domain: string;
  checkedAt: string;
  spf: DomainCheckItem;
  dkim: DomainCheckItem;
  dmarc: DomainCheckItem & { policy: 'none' | 'quarantine' | 'reject' | null };
  pass: boolean;
  warnings: string[];
}

const TWO_LEVEL_SUFFIXES = ['com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'co.uk', 'com.au'];

export const defaultTxtResolver: TxtResolver = async (host) => {
  try {
    return await dns.promises.resolveTxt(host);
  } catch (err) {
    const code = String((err as { code?: string })?.code || '');
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') return [];
    throw err;
  }
};

async function txt(resolver: TxtResolver, host: string): Promise<string[]> {
  try {
    return (await resolver(host)).map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

/** Dominio + pais ate o dominio organizacional (para heranca de DMARC). */
export function dmarcCandidates(domain: string): string[] {
  const labels = domain.toLowerCase().split('.').filter(Boolean);
  const suffix2 = TWO_LEVEL_SUFFIXES.some((s) => domain.toLowerCase().endsWith(`.${s}`));
  const minLabels = suffix2 ? 3 : 2;
  const out: string[] = [];
  for (let i = 0; labels.length - i >= minLabels; i++) out.push(labels.slice(i).join('.'));
  return out;
}

export async function checkDomainAuth(
  domain: string,
  opts: { dkimSelectors: string[]; spfHost?: string | null; resolver?: TxtResolver; now?: Date }
): Promise<DomainAuthResult> {
  const resolver = opts.resolver || defaultTxtResolver;
  const d = domain.toLowerCase();
  const warnings: string[] = [];

  const spfHost = (opts.spfHost || d).toLowerCase();
  const spfRec = (await txt(resolver, spfHost)).find((r) => /^v=spf1(\s|$)/i.test(r.trim())) || null;
  const spfOk = Boolean(spfRec) && !/^v=spf1\s+-all\s*$/i.test(spfRec!.trim());
  if (spfRec && /\+all/i.test(spfRec)) warnings.push('SPF com "+all" autoriza qualquer servidor; corrija o registro.');
  const spf: DomainCheckItem = {
    ok: spfOk && !/\+all/i.test(spfRec || ''),
    host: spfHost,
    record: spfRec,
    detail: spfRec ? (spfOk ? 'Registro SPF encontrado.' : 'SPF não autoriza nenhum servidor.') : 'Nenhum registro SPF (v=spf1) encontrado.',
  };

  let dkim: DomainCheckItem = { ok: false, host: `${opts.dkimSelectors[0] || 'resend'}._domainkey.${d}`, record: null, detail: 'Nenhuma chave DKIM encontrada para os seletores configurados.' };
  for (const sel of opts.dkimSelectors) {
    const host = `${sel}._domainkey.${d}`;
    const rec = (await txt(resolver, host)).find((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(r)) || null;
    if (rec) {
      dkim = { ok: true, host, record: rec.length > 120 ? `${rec.slice(0, 117)}...` : rec, detail: `Chave DKIM encontrada (seletor ${sel}).` };
      break;
    }
  }

  let dmarc: DomainAuthResult['dmarc'] = { ok: false, host: `_dmarc.${d}`, record: null, detail: 'Nenhum registro DMARC encontrado.', policy: null };
  for (const cand of dmarcCandidates(d)) {
    const host = `_dmarc.${cand}`;
    const rec = (await txt(resolver, host)).find((r) => /^v=DMARC1/i.test(r.trim())) || null;
    if (!rec) continue;
    const pm = /(?:^|;)\s*p=(none|quarantine|reject)/i.exec(rec);
    const sp = cand !== d ? /(?:^|;)\s*sp=(none|quarantine|reject)/i.exec(rec) : null;
    const policy = ((sp?.[1] || pm?.[1] || '').toLowerCase() || null) as 'none' | 'quarantine' | 'reject' | null;
    dmarc = {
      ok: Boolean(policy),
      host,
      record: rec,
      policy,
      detail: policy ? `DMARC com política ${policy}${cand !== d ? ` (herdada de ${cand})` : ''}.` : 'Registro DMARC sem política (p=) válida.',
    };
    if (policy === 'none') warnings.push('DMARC em p=none apenas monitora; recomendado evoluir para quarantine ou reject.');
    break;
  }

  return {
    domain: d,
    checkedAt: (opts.now || new Date()).toISOString(),
    spf,
    dkim,
    dmarc,
    pass: spf.ok && dkim.ok && dmarc.ok,
    warnings,
  };
}

const cache = new Map<string, { at: number; result: DomainAuthResult }>();
export const DOMAIN_AUTH_CACHE_MS = 10 * 60 * 1000;

export async function checkDomainAuthCached(
  domain: string,
  opts: { dkimSelectors: string[]; spfHost?: string | null; resolver?: TxtResolver; force?: boolean }
): Promise<DomainAuthResult> {
  const key = `${domain}|${opts.spfHost || ''}|${opts.dkimSelectors.join(',')}`;
  const hit = cache.get(key);
  if (!opts.force && !opts.resolver && hit && Date.now() - hit.at < DOMAIN_AUTH_CACHE_MS) return hit.result;
  const result = await checkDomainAuth(domain, opts);
  if (!opts.resolver) cache.set(key, { at: Date.now(), result });
  return result;
}
