// ============================================================================
// STI-hub — Validacao do aceite publico de Proposta Comercial pelo cliente
// POST /api/erp/proposals/:id/approve (rota publica, sem login).
// Todos os dados da assinatura e do aceite chegam no corpo do proprio POST.
// ============================================================================

export const PROPOSAL_APPROVAL_MODALITIES = ['ICP_BRASIL_A1', 'ICP_BRASIL_A3', 'GOV_BR_OURO'] as const;
export type ProposalApprovalModality = (typeof PROPOSAL_APPROVAL_MODALITIES)[number];

/** Status em que a proposta ainda pode ser aceita pelo cliente. */
export const PROPOSAL_APPROVABLE_STATUSES = ['RASCUNHO', 'ENVIADA', 'EM_NEGOCIACAO', 'APROVADA'] as const;

export interface ProposalApprovalInput {
  signerName: string;
  signerCpf: string;
  signerRole: string;
  signerEmail?: string;
  modality: ProposalApprovalModality;
  acceptedTerms: true;
  statusObservation?: string;
}

export type ProposalApprovalValidation =
  | { ok: true; status: 200; data: ProposalApprovalInput }
  | { ok: false; status: 400 | 409; code: string; error: string; fields?: string[] };

export function isValidCpf(raw: unknown): boolean {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

function formatCpf(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

/**
 * Valida o corpo do aceite e o status atual da proposta.
 * @param body corpo recebido no POST /approve
 * @param currentStatus status atual da proposta no servidor (ou do payload compartilhado), se conhecido
 * @param convertedContractId contrato ja gerado para a proposta, se houver
 */
export function validateProposalApprovalInput(
  body: unknown,
  currentStatus?: string | null,
  convertedContractId?: string | null
): ProposalApprovalValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fields: string[] = [];

  const signerName = typeof b.signerName === 'string' ? b.signerName.trim() : '';
  if (signerName.length < 3 || signerName.length > 160) fields.push('signerName');

  const signerCpfRaw = typeof b.signerCpf === 'string' ? b.signerCpf.trim() : '';
  if (!isValidCpf(signerCpfRaw)) fields.push('signerCpf');

  const signerRole = typeof b.signerRole === 'string' ? b.signerRole.trim() : '';
  if (signerRole.length < 2 || signerRole.length > 160) fields.push('signerRole');

  const modality = typeof b.modality === 'string' ? b.modality : '';
  if (!(PROPOSAL_APPROVAL_MODALITIES as readonly string[]).includes(modality)) fields.push('modality');

  if (b.acceptedTerms !== true) fields.push('acceptedTerms');

  let signerEmail: string | undefined;
  if (b.signerEmail !== undefined && b.signerEmail !== null && String(b.signerEmail).trim() !== '') {
    signerEmail = String(b.signerEmail).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail) || signerEmail.length > 200) fields.push('signerEmail');
  }

  if (fields.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_APPROVAL_INPUT',
      error:
        'Dados do aceite inválidos. Informe nome completo, CPF válido, cargo do signatário, modalidade de assinatura e confirme a aceitação dos termos.',
      fields,
    };
  }

  const status = String(currentStatus || '').toUpperCase();
  if (convertedContractId || status === 'CONVERTIDA_CONTRATO') {
    return {
      ok: false,
      status: 409,
      code: 'PROPOSAL_ALREADY_APPROVED',
      error: 'Esta proposta já foi aceita e convertida em contrato.',
    };
  }
  if (status && !(PROPOSAL_APPROVABLE_STATUSES as readonly string[]).includes(status)) {
    return {
      ok: false,
      status: 409,
      code: 'PROPOSAL_STATUS_NOT_APPROVABLE',
      error: `Esta proposta está com status ${status} e não pode mais ser aceita. Fale com o seu consultor Seta Telecom.`,
    };
  }

  const statusObservation =
    typeof b.statusObservation === 'string' && b.statusObservation.trim()
      ? b.statusObservation.trim().slice(0, 500)
      : undefined;

  return {
    ok: true,
    status: 200,
    data: {
      signerName,
      signerCpf: formatCpf(signerCpfRaw),
      signerRole,
      signerEmail,
      modality: modality as ProposalApprovalModality,
      acceptedTerms: true,
      statusObservation,
    },
  };
}
