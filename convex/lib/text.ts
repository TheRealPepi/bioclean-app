// Shared by the backend and the frontend (client combobox).

/** Display form of a client name: trimmed, single spaces, uppercase. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Comparison key: ignores accents, punctuation and spacing differences. */
export function normalizeKey(text: string): string {
  return cleanName(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanInvoice(invoice: string): string {
  return invoice.trim().replace(/\s+/g, "").toUpperCase();
}

export function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * WhatsApp number as digits with country code and no "+". A 10-digit number is
 * taken as Mexican ("987 123 4567" -> "529871234567").
 */
export function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `52${digits}` : digits;
}

export function isPhone(phone: string): boolean {
  return /^[1-9]\d{10,14}$/.test(phone);
}
