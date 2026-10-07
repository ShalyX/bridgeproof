export type SourceReceipt = {
  txHash: string;
  sender: string;
  recipient: string;
  value: string;
  rawInput: string;
  payloadHash: string;
  nonce: string;
  confirmations: string;
  status: string;
  logCount: number;
};

type JsonResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchLike = (input: string) => Promise<JsonResponse>;

function sourceAddress(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    value = record.hash || record.address || "";
  }
  return String(value || "").trim().toLowerCase();
}

function normalizeSourceStatus(value: unknown): string {
  const status = String(value || "").trim().toLowerCase();
  if (["1", "success", "succeeded", "successful", "true"].includes(status)) return "ok";
  if (["0", "failed", "failure", "false"].includes(status)) return "error";
  return status;
}

export function normalizeSourceInteger(value: unknown, fieldName: string): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "0";
  if (text.startsWith("-")) throw new Error(`${fieldName} cannot be negative.`);
  try {
    return BigInt(text).toString(10);
  } catch {
    throw new Error(`Source transaction returned an invalid ${fieldName}.`);
  }
}

export async function derivePayloadHash(rawInput: unknown): Promise<string> {
  const normalized = String(rawInput || "0x").toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sourceUrl(template: string, txHash: string): string {
  return template.replaceAll("{tx_hash}", txHash);
}

async function readJson(fetchImpl: FetchLike, url: string, label: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${label} returned an invalid JSON object.`);
  }
  return body as Record<string, unknown>;
}

export async function fetchSourceReceipt(
  transactionUrlTemplate: string,
  logsUrlTemplate: string,
  txHash: string,
  fetchImpl: FetchLike = fetch,
): Promise<SourceReceipt> {
  const normalizedTxHash = txHash.trim().toLowerCase();
  const [transaction, logs] = await Promise.all([
    readJson(fetchImpl, sourceUrl(transactionUrlTemplate, normalizedTxHash), "Transaction source"),
    readJson(fetchImpl, sourceUrl(logsUrlTemplate, normalizedTxHash), "Logs source"),
  ]);

  if (!Array.isArray(logs.items)) throw new Error("Logs source did not return an items list.");

  const sender = sourceAddress(transaction.from || transaction.sender);
  const recipient = sourceAddress(transaction.to || transaction.recipient);
  if (!sender || !recipient) throw new Error("Transaction source omitted the sender or recipient.");

  const rawInput = String(transaction.raw_input || transaction.input || transaction.data || "0x").toLowerCase();
  return {
    txHash: String(transaction.hash || transaction.transaction_hash || normalizedTxHash).toLowerCase(),
    sender,
    recipient,
    value: normalizeSourceInteger(transaction.value, "value"),
    rawInput,
    payloadHash: await derivePayloadHash(rawInput),
    nonce: normalizeSourceInteger(transaction.nonce, "nonce"),
    confirmations: normalizeSourceInteger(transaction.confirmations, "confirmations"),
    status: normalizeSourceStatus(transaction.status || transaction.result),
    logCount: logs.items.length,
  };
}
