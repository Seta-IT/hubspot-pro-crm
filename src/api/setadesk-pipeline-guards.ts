// ============================================================================
// Guardas das rotas de pipelines (filas) do SetaDesk.
// Criar e editar: somente admin ou coordenador, com as checagens de papel ja
// existentes (canManageUsersRbac / SUPER_ADMIN / CRM_ADMIN = admin;
// SUPPORT_NOC_OS / CRM_SERVICE_NOC / SALES_MANAGER / CRM_SALES_MANAGER = coordenador).
// Nao altera middleware, auth, _bridge nem portal-access.
// ============================================================================

import { z } from 'zod';

const str = (max: number) => z.string().trim().max(max);

export const SetaDeskPipelineWriteSchema = z
  .object({
    name: str(120).min(1).optional(),
    prefix: z
      .string()
      .trim()
      .max(8)
      .transform((s) => s.toUpperCase().replace(/-$/, ''))
      .optional(),
    mailbox: str(200).nullable().optional(),
    jiraProjectKey: str(20).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

export type SetaDeskPipelineWrite = z.infer<typeof SetaDeskPipelineWriteSchema>;

export function parseSetaDeskPipelineWrite(
  body: unknown,
  opts: { requireNameAndPrefix?: boolean } = {}
): { ok: true; data: SetaDeskPipelineWrite } | { ok: false; error: string } {
  const r = SetaDeskPipelineWriteSchema.safeParse(body && typeof body === 'object' ? body : {});
  if (!r.success) {
    const fields = r.error.issues.map((i) => i.path.join('.') || '(corpo)');
    return { ok: false, error: `Campo(s) invalido(s): ${[...new Set(fields)].join(', ')}.` };
  }
  if (opts.requireNameAndPrefix && (!r.data.name || !r.data.prefix)) {
    return { ok: false, error: 'Informe o nome e o prefixo da fila.' };
  }
  return { ok: true, data: r.data };
}

export interface SetaDeskPipelineActor {
  authenticated?: boolean;
  mfaVerified?: boolean;
  effectiveActionGuards?: { canManageUsersRbac?: boolean } | null;
  user?: { role?: string | null; crmRole?: string | null } | null;
}

const ADMIN_ROLES = new Set(['SUPER_ADMIN']);
const ADMIN_CRM_ROLES = new Set(['CRM_ADMIN']);
const COORDINATOR_ROLES = new Set(['SUPPORT_NOC_OS', 'SALES_MANAGER']);
const COORDINATOR_CRM_ROLES = new Set(['CRM_SERVICE_NOC', 'CRM_SALES_MANAGER']);

/** Admin ou coordenador, com sessao MFA, ou contexto interno confiavel. */
export function canManageSetaDeskPipelines(opts: {
  trustedInternal?: boolean;
  session: SetaDeskPipelineActor | null | undefined;
}): boolean {
  if (opts.trustedInternal) return true;
  const sess = opts.session;
  if (!sess || !sess.authenticated || !sess.mfaVerified) return false;
  if (sess.effectiveActionGuards?.canManageUsersRbac) return true;
  const role = String(sess.user?.role || '');
  const crmRole = String(sess.user?.crmRole || '');
  if (ADMIN_ROLES.has(role) || ADMIN_CRM_ROLES.has(crmRole)) return true;
  if (COORDINATOR_ROLES.has(role) || COORDINATOR_CRM_ROLES.has(crmRole)) return true;
  return false;
}
