// ============================================================================
// Configuracao do cron OIDC, segura para o Edge (sem node:crypto).
// O middleware so usa isto para decidir se um Bearer em forma de JWT pode
// passar; a verificacao criptografica fica no bridge (Node).
// ============================================================================

/**
 * OIDC do Cloud Scheduler esta configurado quando ha service account e audience
 * (CRON_OIDC_AUDIENCE ou STI_HUB_PUBLIC_ORIGIN).
 */
export function isCronOidcConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const sa = String(env.CRON_OIDC_SERVICE_ACCOUNT || '').trim();
  const audience =
    String(env.CRON_OIDC_AUDIENCE || '').trim() || String(env.STI_HUB_PUBLIC_ORIGIN || '').trim();
  return Boolean(sa && audience);
}

/** Bearer com tres segmentos base64url (forma de JWT). Nao valida assinatura. */
export function looksLikeBearerJwt(authorizationHeader: string | null | undefined): boolean {
  return /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
    String(authorizationHeader || '')
  );
}
