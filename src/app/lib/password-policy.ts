// ============================================================================
// STI-hub — Politica de senha (Pacote C, 29/10/2026). Edge/cliente-safe (sem node:crypto).
// Vale SO para senhas NOVAS (redefinicao, Minha Conta, aceite de convite). Senhas existentes
// continuam aceitas no login (verifyCorporatePassword nao muda): nada e invalidado.
// ============================================================================
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MIN_MESSAGE = `A senha deve ter pelo menos ${NEW_PASSWORD_MIN_LENGTH} caracteres.`;
export const NEW_PASSWORD_PLACEHOLDER = `Mínimo de ${NEW_PASSWORD_MIN_LENGTH} caracteres`;
