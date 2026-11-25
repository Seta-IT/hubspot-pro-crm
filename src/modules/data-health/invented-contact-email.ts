// STI-hub — e-mails inventados pelo cadastro de contato quando o campo vinha vazio.
// Padrão exato do gerador antigo (createContact):
//   `${slugName}.${Date.now().toString(36).slice(-4)}@contato.setatelecom.com.br`
// slugName = normalizeSearchText(`${first}.${last}`).replace(/[^a-z0-9.]+/g, "").replace(/^\.+|\.+$/g, "") || "contato"
// Não gerar mais. Na leitura, tratar como vazio e exibir "--". Não apagar o valor persistido.

export const INVENTED_CONTACT_EMAIL_DOMAIN = "contato.setatelecom.com.br";

/** slug alfanumérico (com pontos) + "." + 4 chars base36 + @contato.setatelecom.com.br */
export const INVENTED_CONTACT_EMAIL_PATTERN =
  /^[a-z0-9]+(?:\.[a-z0-9]+)*\.[0-9a-z]{4}@contato\.setatelecom\.com\.br$/i;

export function isInventedContactEmail(raw: string | null | undefined): boolean {
  return INVENTED_CONTACT_EMAIL_PATTERN.test(String(raw || "").trim());
}

/** E-mail visível/utilizável: vazio se não houver valor real ou se for o padrão inventado. */
export function contactEmailForRead(raw: string | null | undefined): string {
  const e = String(raw || "").trim();
  if (!e || isInventedContactEmail(e)) return "";
  return e;
}

/** Exibição no CRM: e-mail real ou "--". */
export function displayContactEmail(raw: string | null | undefined): string {
  return contactEmailForRead(raw) || "--";
}

/** Cópia rasa para leitura: e-mail inventado vira vazio, sem mutar o registro persistido. */
export function presentContactEmail<T extends { email?: string | null; isValidEmail?: boolean }>(contact: T): T {
  if (!isInventedContactEmail(contact.email)) return contact;
  return { ...contact, email: "", isValidEmail: false };
}
