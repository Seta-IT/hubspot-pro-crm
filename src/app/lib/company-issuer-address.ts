// STI-hub — endereco da emitente (Seta Telecom LTDA) para o cabecalho da Proposta Comercial.
// Modulo puro: o servidor monta a linha a partir do cadastro da empresa (companyEmitter) e
// devolve SO esta string (nada de CNPJ, IE, contas ou e-mails) junto da proposta, inclusive no
// link publico. Campos vazios sao omitidos sem deixar separadores soltos.
export interface IssuerAddressInput {
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

export function formatIssuerAddress(e: IssuerAddressInput | null | undefined): string {
  if (!e) return '';
  const street = [clean(e.addressStreet), clean(e.addressNumber), clean(e.addressComplement)]
    .filter(Boolean)
    .join(', ');
  const uf = clean(e.state).toUpperCase();
  // O cadastro as vezes guarda "Campinas / São Paulo": fica so a cidade, a UF vem do campo proprio.
  let city = clean(e.city);
  if (city.includes('/')) city = clean(city.split('/')[0]);
  const cityUf = city && uf ? `${city}/${uf}` : city || uf;
  const cepDigits = clean(e.cep).replace(/\D+/g, '');
  const cep = cepDigits.length === 8 ? `CEP ${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : '';
  return [street, clean(e.neighborhood), cityUf, cep].filter(Boolean).join(' - ');
}
