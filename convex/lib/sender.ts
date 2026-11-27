// Who a company's reminder emails come from. Every company sends through the
// same Resend account, so the address is never something a company types in
// full: the domain is either one the operator verified for that company
// (`companies.senderDomain`) or the shared one in REMINDER_DEFAULT_FROM_EMAIL.
// Otherwise one company could send as another one's domain.
import { isEmail } from "./text";

export const DEFAULT_LOCAL_PART = "avisos";

/** A display name that is safe inside `"Name" <address>`. */
export function cleanSenderName(name: string): string {
  return name
    .replace(/[<>"\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What goes before the "@": letters, digits and single dots, dashes or underscores. */
export function isLocalPart(value: string): boolean {
  return value.length <= 64 && /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(value);
}

export function isDomain(value: string): boolean {
  return value.length <= 253 && /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value);
}

/** The address in `Name <correo@dominio>` or `correo@dominio`. */
export function addressOf(value: string | undefined): string | null {
  const address = (/<([^<>]+)>\s*$/.exec(value ?? "")?.[1] ?? value ?? "").trim().toLowerCase();
  return isEmail(address) ? address : null;
}

export type Sender =
  | { from: string; replyTo: string | undefined; shared: boolean }
  | { error: string };

/**
 * The From and Reply-To of a company's emails. `defaultFrom` is the shared
 * address, for companies without a domain of their own; they need a reply-to,
 * since nobody of theirs reads that mailbox.
 */
export function emailSender(
  company: {
    name: string;
    senderDomain?: string;
    reminders?: { fromName?: string; fromLocalPart?: string; replyTo?: string };
  },
  defaultFrom: string | undefined,
): Sender {
  const { fromName, fromLocalPart, replyTo } = company.reminders ?? {};
  const name = cleanSenderName(fromName ?? "") || cleanSenderName(company.name);

  if (company.senderDomain) {
    const address = `${fromLocalPart || DEFAULT_LOCAL_PART}@${company.senderDomain}`;
    return { from: `"${name}" <${address}>`, replyTo, shared: false };
  }

  const shared = addressOf(defaultFrom);
  if (!shared) {
    return { error: "Los recordatorios por correo todavía no están activados para tu empresa." };
  }
  if (!replyTo) {
    return {
      error:
        "Escribe el correo de respuesta en Configuración › Recordatorios: tus clientes tienen que poder contestarte.",
    };
  }
  return { from: `"${name}" <${shared}>`, replyTo, shared: true };
}
