// HTML of the payment reminder email. Email clients (Outlook above all) only
// support a small part of HTML and CSS, so the layout is made of tables and
// every style is inline.

const NAVY = "#2e3192";
const GREEN = "#8cc63f";
const INK = "#1f2433";
const MUTED = "#667085";
const LINE = "#e1e5ef";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Shown at half the image's size so it stays sharp on retina screens. */
const LOGO_DISPLAY_WIDTH = 220;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const label = (text: string) =>
  `<div style="font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${MUTED};">${text}</div>`;

export function reminderEmailHtml(email: {
  company: string;
  logo: { url: string; width: number; height: number };
  clientName: string;
  /** The sentence that says what is due and when. */
  intro: string;
  /** The payment deadline, already formatted ("20 de noviembre de 2026"). */
  date: string;
  invoiceNumbers: string[];
  closing: string;
}): string {
  const company = escapeHtml(email.company);
  const logoHeight = Math.round((LOGO_DISPLAY_WIDTH * email.logo.height) / email.logo.width);

  const invoices = email.invoiceNumbers
    .map(
      (number, i) =>
        `<tr><td style="padding:8px 0;${
          i > 0 ? `border-top:1px solid ${LINE};` : ""
        }font-family:${FONT};font-size:16px;line-height:22px;font-weight:600;color:${INK};">${escapeHtml(number)}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Recordatorio de pago</title>
</head>
<body style="margin:0;padding:0;background-color:#eef1f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(email.intro.replace(/:$/, "."))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef1f7;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">

<tr><td align="center" style="padding:28px 24px 22px;background-color:#ffffff;">
<img src="${escapeHtml(email.logo.url)}" width="${LOGO_DISPLAY_WIDTH}" height="${logoHeight}" alt="Bio Clean Green" style="display:block;width:${LOGO_DISPLAY_WIDTH}px;max-width:100%;height:auto;border:0;outline:none;font-family:${FONT};font-size:22px;font-weight:700;color:${NAVY};">
</td></tr>

<tr><td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="75%" height="4" style="height:4px;line-height:4px;font-size:0;background-color:${NAVY};">&nbsp;</td>
<td width="25%" height="4" style="height:4px;line-height:4px;font-size:0;background-color:${GREEN};">&nbsp;</td>
</tr></table>
</td></tr>

<tr><td style="padding:32px 28px 28px;font-family:${FONT};color:${INK};">
<h1 style="margin:0 0 20px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${NAVY};">Recordatorio de pago</h1>
<p style="margin:0 0 12px;font-size:16px;line-height:24px;">Estimado cliente <strong>${escapeHtml(email.clientName)}</strong>:</p>
<p style="margin:0 0 24px;font-size:16px;line-height:24px;">${escapeHtml(email.intro)}</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f7fb;border-left:4px solid ${GREEN};border-radius:8px;">
<tr><td style="padding:18px 20px 16px;font-family:${FONT};">
${label("Fecha límite de pago")}
<div style="margin-top:4px;font-size:21px;line-height:28px;font-weight:700;color:${NAVY};">${escapeHtml(email.date)}</div>
</td></tr>
<tr><td style="padding:16px 20px 10px;border-top:1px solid ${LINE};font-family:${FONT};">
${label(email.invoiceNumbers.length > 1 ? "Facturas" : "Factura")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:2px;">${invoices}</table>
</td></tr>
</table>

<p style="margin:24px 0 0;font-size:14px;line-height:22px;color:${MUTED};">${escapeHtml(email.closing)}</p>
<p style="margin:24px 0 0;font-size:16px;line-height:24px;">Gracias,<br><strong style="color:${NAVY};">${company}</strong></p>
</td></tr>

<tr><td align="center" style="padding:18px 24px;background-color:#f8f9fc;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
${company} &middot; Servicio integral para su negocio desde 1996<br>
Este es un recordatorio automático de pago.
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
