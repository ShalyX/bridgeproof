export const STUDIONET_CHAIN_ID = "61999";
export const STUDIONET_CHAIN_ID_HEX = "0xf22f";

export function normalizeChainId(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  try {
    return BigInt(text).toString(10);
  } catch {
    return null;
  }
}

export function isStudioNetChainId(value: unknown): boolean {
  return normalizeChainId(value) === STUDIONET_CHAIN_ID;
}

export function chainIdLabel(value: unknown): string {
  const normalized = normalizeChainId(value);
  return normalized ? `chain ${normalized}` : "wallet network unavailable";
}
