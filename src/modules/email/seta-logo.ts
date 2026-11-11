// Marca oficial SETA | IT já usada no cabeçalho da proposta (src/app/proposta/[id]/page.tsx).
// Não é um logo novo: é o mesmo cartão tipográfico (SETA #0d2b4e, barra e IT #f26522)
// materializado em PNG para a assinatura do e-mail (CID inline no Graph).
// A URL pública /brand/seta-it-logo.png serve só a prévia no compositor autenticado;
// o envio usa a cópia embutida (CID), sem depender de arquivo em disco nem de storage.

export const SETA_LOGO_CID = 'seta-it-logo';
export const SETA_LOGO_FILENAME = 'seta-it-logo.png';
export const SETA_LOGO_CONTENT_TYPE = 'image/png';
export const SETA_LOGO_PUBLIC_PATH = '/brand/seta-it-logo.png';
export const SETA_LOGO_ALT = 'SETA | IT';

/** PNG da marca (base64), para anexo isInline do Graph. Não importar no bundle do navegador. */
export const SETA_LOGO_CONTENT_BASE64 =
  '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';

export function setaLogoCidSrc(): string {
  return `cid:${SETA_LOGO_CID}`;
}
