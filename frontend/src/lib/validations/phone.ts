const SEPARATORS = /[\s\-().]/g;

/**
 * Mirrors the API's phone rules: Sri Lankan numbers in local (077 123 4567) or
 * international (+94 77 123 4567) form, or any E.164 number with a leading "+".
 */
export function isValidPhone(value: string): boolean {
  let raw = value.replace(SEPARATORS, "");
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  if (raw.startsWith("+94")) return /^[1-9]\d{8}$/.test(raw.slice(3));
  if (raw.startsWith("+")) return /^\d{8,15}$/.test(raw.slice(1));
  if (/^94\d{9}$/.test(raw)) return /^[1-9]/.test(raw.slice(2));
  if (/^0\d{9}$/.test(raw)) return raw[1] !== "0";
  return /^[1-9]\d{8}$/.test(raw);
}
