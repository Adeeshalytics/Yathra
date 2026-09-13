/**
 * A texted code met an account that already has a password. The server hands back a short-lived
 * proof that this browser holds the phone; signing in with the password once, with the proof,
 * links the number. It is kept for this tab only (sessionStorage), never in a URL.
 */
const KEY = "yathra:phone-proof";

export interface PendingPhoneLink {
  phone: string;
  proof: string;
}

export function savePhoneProof(link: PendingPhoneLink): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(link));
  } catch {
    // Storage can be blocked; the customer can still link the number another time.
  }
}

export function readPhoneProof(): PendingPhoneLink | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingPhoneLink>;
    return typeof value.phone === "string" && typeof value.proof === "string"
      ? { phone: value.phone, proof: value.proof }
      : null;
  } catch {
    return null;
  }
}

export function clearPhoneProof(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
