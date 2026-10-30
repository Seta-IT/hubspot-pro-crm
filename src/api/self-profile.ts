// ============================================================================
// STI-hub — PATCH /api/auth/me (Minha Conta, self-service)
// Spec: /workspace/specs/self-profile-patch-auth-me.md (CRM Supervisor, 29/10/2026).
// O alvo e SEMPRE o usuario da sessao; allowlist zod .strict(); department/jobTitle FORA
// do schema (somente leitura ate decisao do Marcello); newEmail fora do schema.
// ============================================================================
import { z } from 'zod';
import { normalizeAndValidatePhone } from '../modules/data-health/validators';
import type { StiHubUserRecord } from '../db/types';
import { PASSWORD_RESET_MIN_LENGTH } from './password-reset';

/** Campos que exigem step-up MFA recente (STEP_UP_FRESH_MS). */
export const SELF_PROFILE_STEP_UP_FIELDS = ['mfaMethod', 'newPassword', 'currentPassword'] as const;

/** Sempre proibidos (alem do .strict): cada um tem teste. Qualquer chave "_*" tambem. */
export const SELF_PROFILE_DENYLIST = [
  'roleId', 'role', 'permissions', 'crmPermissions', 'erpPermissions', 'erpRole', 'enabledModules',
  'moduleAccess', 'scope', 'actionGuards', 'canManageUsersRbac', 'active', 'status', 'deletedAt',
  'mfaEnabled', 'totpSecret', 'totpSecretFormatted', 'totpConfigured', 'totpConfiguredAt', 'totpEpoch',
  'lastUsedTotpTimeStep', 'passwordHash', 'password', 'iamSeal', 'homeScreenUpdatedAt', 'email', 'id',
  'gestaoClickId', 'hubspotOwnerId',
] as const;

/** Chaves que tentam escolher o alvo (=> 400 SELF_TARGET_ONLY). */
export const SELF_TARGET_KEYS = ['id', 'userId', 'email'] as const;

/** Politica de senha atual do STI-hub (mesma da redefinicao). */
export const SELF_PASSWORD_MIN_LENGTH = PASSWORD_RESET_MIN_LENGTH;
export const SELF_PASSWORD_MAX_LENGTH = 128;
export const AVATAR_DATA_URL_MAX_BYTES = 200 * 1024;
export const AVATAR_ALLOWED_HOSTS = ['sti-hub.vercel.app', 'setatelecom.com.br', 'gravatar.com', 'googleusercontent.com'] as const;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e]/;
const HTML_CHARS = /[<>&"`]/;

function isAllowedAvatarUrl(v: string): boolean {
  if (v.startsWith('data:')) {
    const m = v.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!m) return false;
    return Math.floor((m[2].length * 3) / 4) <= AVATAR_DATA_URL_MAX_BYTES;
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return AVATAR_ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export const selfProfilePatchSchema = z
  .object({
    name: z
      .string()
      .transform((s) => s.trim().replace(/\s+/g, ' '))
      .refine((s) => s.length >= 2 && s.length <= 120, 'O nome deve ter de 2 a 120 caracteres.')
      .refine((s) => !CONTROL_CHARS.test(s) && !HTML_CHARS.test(s), 'O nome não pode ter caracteres de controle nem HTML.'),
    phone: z
      .string()
      .max(20, 'Telefone com no máximo 20 caracteres.')
      .transform((s, ctx) => {
        const r = normalizeAndValidatePhone(s);
        if (!r.isValid) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone inválido.' });
          return z.NEVER;
        }
        return (r.formatted || s.trim()).slice(0, 20);
      }),
    preferences: z
      .object({ homeScreen: z.union([z.string().max(40), z.null()]) })
      .strict(),
    avatarUrl: z
      .string()
      .max(AVATAR_DATA_URL_MAX_BYTES * 2)
      .refine(isAllowedAvatarUrl, 'Avatar: use https em domínio permitido ou imagem PNG/JPEG/WebP até 200 KB.'),
    mfaMethod: z.enum(['TOTP_AUTHENTICATOR', 'EMAIL_OTP']),
    newPassword: z.string().min(SELF_PASSWORD_MIN_LENGTH, `A nova senha deve ter pelo menos ${SELF_PASSWORD_MIN_LENGTH} caracteres.`).max(SELF_PASSWORD_MAX_LENGTH),
    currentPassword: z.string().min(1).max(SELF_PASSWORD_MAX_LENGTH),
  })
  .partial()
  .strict();

export type SelfProfilePatch = z.infer<typeof selfProfilePatchSchema>;

/** Chaves rejeitadas antes do zod: denylist explicita, "_*" e qualquer chave fora do schema. */
export function rejectedSelfProfileKeys(body: Record<string, unknown>): string[] {
  const allowed = Object.keys(selfProfilePatchSchema.shape);
  return Object.keys(body)
    .filter((k) => k.startsWith('_') || (SELF_PROFILE_DENYLIST as readonly string[]).includes(k) || !allowed.includes(k))
    .map((k) => k.slice(0, 60))
    .slice(0, 30);
}

/** DTO publico de "Minha Conta" (nada de segredo, hash, permissao ou selo). */
export function selfProfileDto(u: StiHubUserRecord): Record<string, unknown> {
  const rec = u as StiHubUserRecord & { avatarUrl?: string };
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    phone: rec.phone || '',
    department: rec.department || '',
    jobTitle: rec.jobTitle || '',
    mfaMethod: rec.mfaMethod,
    preferences: { homeScreen: rec.homeScreen ?? null },
    avatarUrl: rec.avatarUrl || null,
    roleId: rec.roleId,
  };
}
