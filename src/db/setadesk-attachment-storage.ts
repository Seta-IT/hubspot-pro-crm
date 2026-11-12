// ============================================================================
// Politica de armazenamento de anexos do SetaDesk.
// ----------------------------------------------------------------------------
// Situacao atual (nov/2026): nao ha uso de Vercel Blob no codigo do SetaDesk.
// A loja "setadesk-anexos" nao aparece no repositorio. Os anexos importados
// do Jira entram como storage = JIRA_REF (URL do Jira), nao como Blob publico.
// Esta guarda vale para qualquer caminho futuro de upload (API, e-mail de
// entrada, fila FIN ou TEC): so e permitido Blob com acesso privado; se nao
// houver opcao privada, o upload e recusado. Nao cria nem configura
// armazenamento pago.
// ============================================================================

export type SetaDeskAttachmentStorage = 'BLOB' | 'JIRA_REF' | 'EXTERNAL_URL';
export type SetaDeskBlobAccess = 'private' | 'public';

export interface SetaDeskAttachmentStorageInput {
  storage: SetaDeskAttachmentStorage;
  blobAccess?: SetaDeskBlobAccess | null;
  pipelinePrefix?: string | null;
  pipelineId?: string | null;
}

export function isSetaDeskFinancePipeline(input: {
  pipelinePrefix?: string | null;
  pipelineId?: string | null;
}): boolean {
  const prefix = String(input.pipelinePrefix || '').trim().toUpperCase().replace(/-$/, '');
  const id = String(input.pipelineId || '').trim().toLowerCase();
  return prefix === 'FIN' || id === 'pl-fin';
}

export type SetaDeskAttachmentStorageDecision =
  | { ok: true }
  | { ok: false; error: string; code: 'BLOB_PRIVATE_REQUIRED' | 'BLOB_PUBLIC_FORBIDDEN' };

/**
 * Anexos nao podem ir para Blob publico. Sem acesso privado configurado,
 * o upload e recusado (em especial na fila Financeiro).
 */
export function assertSetaDeskAttachmentStorage(
  input: SetaDeskAttachmentStorageInput
): SetaDeskAttachmentStorageDecision {
  if (input.storage !== 'BLOB') return { ok: true };
  const fin = isSetaDeskFinancePipeline(input);
  if (input.blobAccess === 'private') return { ok: true };
  if (input.blobAccess === 'public') {
    return {
      ok: false,
      code: 'BLOB_PUBLIC_FORBIDDEN',
      error: fin
        ? 'Anexos da fila Financeiro nao podem ir para armazenamento Blob publico.'
        : 'Anexos do SetaDesk nao podem ir para armazenamento Blob publico. Use acesso privado ou recuse o upload.',
    };
  }
  return {
    ok: false,
    code: 'BLOB_PRIVATE_REQUIRED',
    error: fin
      ? 'Anexos da fila Financeiro exigem armazenamento Blob privado. Nao ha opcao privada configurada; o upload foi recusado.'
      : 'Anexos do SetaDesk exigem armazenamento Blob privado. Nao ha opcao privada configurada; o upload foi recusado.',
  };
}
