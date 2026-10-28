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
