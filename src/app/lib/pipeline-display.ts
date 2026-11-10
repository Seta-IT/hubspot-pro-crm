/** Remove o prefixo técnico "Pipeline N:" do nome exibido ao usuário. */
export function formatPipelineDisplayName(name: string | null | undefined): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return raw.replace(/^Pipeline\s*\d+\s*:\s*/i, '').trim() || raw;
}
