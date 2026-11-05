// STI-hub — endereco da emitente (Seta Telecom LTDA) para cabecalhos de documentos.
// Modulo puro: o servidor monta a linha a partir do cadastro da empresa (companyEmitter) e
// devolve SO esta string (nada de CNPJ, IE, contas ou e-mails). Campos vazios sao omitidos
// sem deixar separadores soltos. O CEP so entra se vier preenchido no cadastro.
export interface IssuerAddressInput {
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

/** Endereco confirmado pelo Marcéllo (t143u/t146u). CEP nao informado — omitido. */
export const SETA_ISSUER_ADDRESS_DEFAULT: IssuerAddressInput = {
  addressStreet: 'Rua Guapuruvu',
  addressNumber: '242',
  addressComplement: 'Sala 31',
  neighborhood: 'Loteamento Alphaville',
  city: 'Campinas',
  state: 'SP',
  cep: '',
};

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Se o bairro terminar com o nome da cidade (ex.: "Loteamento Alphaville Campinas"), remove a repeticao. */
export function stripTrailingCityFromNeighborhood(neighborhood: string, city: string): string {
  const n = clean(neighborhood);
  const c = clean(city);
  if (!n || !c) return n;
  const lowerN = n.toLowerCase();
  const lowerC = c.toLowerCase();
  for (const sep of [' ', '-', '/', ',']) {
    const suffix = sep + lowerC;
    if (lowerN.endsWith(suffix)) {
      return n.slice(0, n.length - suffix.length).replace(/[\s,/-]+$/, '').trim();
    }
  }
  return n;
}

export function formatIssuerAddress(e: IssuerAddressInput | null | undefined): string {
  if (!e) return '';
  const street = [clean(e.addressStreet), clean(e.addressNumber), clean(e.addressComplement)]
    .filter(Boolean)
    .join(', ');
  const uf = clean(e.state).toUpperCase();
  // O cadastro as vezes guarda "Campinas / São Paulo": fica so a cidade, a UF vem do campo proprio.
  let city = clean(e.city);
  if (city.includes('/')) city = clean(city.split('/')[0]);
  const neighborhood = stripTrailingCityFromNeighborhood(clean(e.neighborhood), city);
  const cityUf = city && uf ? `${city}/${uf}` : city || uf;
  const cepDigits = clean(e.cep).replace(/\D+/g, '');
  const cep = cepDigits.length === 8 ? `CEP ${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : '';
  return [street, neighborhood, cityUf, cep].filter(Boolean).join(' - ');
}

/** Endereco completo no cabecalho da proposta (modelo comercial; Guapuruvu + 3º andar + CEP). */
export const SETA_PROPOSAL_HEADER_ADDRESS =
  'Rua Guapuruvu, 242 — 3º andar, Alphaville, Campinas/SP — CEP 13098-323';

/** Linha usada quando o cliente ainda nao recebeu issuerAddress do servidor. */
export function defaultIssuerAddressLine(): string {
  return formatIssuerAddress(SETA_ISSUER_ADDRESS_DEFAULT);
}
