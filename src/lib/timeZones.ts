// For choosing a company's time zone.

// What browsers without `Intl.supportedValuesOf` offer.
const MEXICO = [
  "America/Bahia_Banderas",
  "America/Cancun",
  "America/Chihuahua",
  "America/Ciudad_Juarez",
  "America/Hermosillo",
  "America/Matamoros",
  "America/Mazatlan",
  "America/Merida",
  "America/Mexico_City",
  "America/Monterrey",
  "America/Ojinaga",
  "America/Tijuana",
];

/** Where this device is, as a guess for a new company. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
}

/** Every zone the browser knows, plus `current` (browsers name a few zones differently). */
export function timeZoneOptions(current: string): string[] {
  let zones = MEXICO;
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    // An older browser: the short list.
  }
  return zones.includes(current) ? zones : [current, ...zones].sort();
}

/** "America/Mexico_City" -> "America / Mexico City (UTC-6)". */
export function timeZoneLabel(zone: string): string {
  const name = zone.replace(/_/g, " ").replace(/\//g, " / ");
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(Date.now())
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${name} (${offset.replace("GMT", "UTC")})` : name;
  } catch {
    return name;
  }
}
