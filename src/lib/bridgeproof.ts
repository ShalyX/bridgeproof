import { getReceiptFailureMessage, isFailedReceipt, type Receipt } from "./receipt.js";
import { STUDIONET_CHAIN_ID_HEX } from "./network.js";

const FINALITY_INTERVAL_MS = 5_000;
const FINALITY_RETRIES = 60;
const runtimeEnv = import.meta.env ?? {};

export const bridgeProofAddress = (runtimeEnv.VITE_BRIDGE_PROOF_ADDRESS || "").trim();
export const executorAddress = (runtimeEnv.VITE_GUARDED_EXECUTOR_ADDRESS || "").trim();
export const studioUrl = (
  runtimeEnv.VITE_GENLAYER_ENDPOINT || "https://studio.genlayer.com/api"
).trim();
export const sourceChainLabel = (runtimeEnv.VITE_SOURCE_CHAIN_LABEL || "Sepolia").trim();

type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: Provider;
  }
}

type GenLayerClient = {
  writeContract(request: Record<string, unknown>): Promise<string>;
  readContract(request: Record<string, unknown>): Promise<unknown>;
  waitForTransactionReceipt(request: Record<string, unknown>): Promise<Receipt>;
};

export type BridgeProofRecord = {
  proof_id: string;
  target_id: string;
  target_version: bigint | number;
  reporter: string;
  source_chain_id: string;
  tx_hash: string;
  expected_sender: string;
  expected_recipient: string;
  expected_value: bigint | number;
  expected_payload_hash: string;
  expected_nonce: bigint | number;
  min_confirmations: bigint | number;
  valid_until: bigint | number;
  created_at: bigint | number;
  decided_at: bigint | number;
  status: string;
  outcome: string;
  confidence_band: string;
  reason_code: string;
  rationale: string;
  observed_sender: string;
  observed_recipient: string;
  observed_value: bigint | number;
  observed_payload_hash: string;
  observed_nonce: bigint | number;
  observed_confirmations: bigint | number;
  source_snapshot: string;
  permit_nonce: bigint | number;
  consumed: boolean;
};

export type TargetRecord = {
  target_id: string;
  owner: string;
  source_chain_id: string;
  target_name: string;
  target_description: string;
  transaction_url_template: string;
  logs_url_template: string;
  executor: string;
  finality_depth: bigint | number;
  version: bigint | number;
  active: boolean;
};

export type ExecutionRecord = {
  proof_id: string;
  target_id: string;
  status: string;
  started_at: bigint | number;
  finalized_at: bigint | number;
};

export type WriteResult = { hash: string; receipt: Receipt };

function getProvider(): Provider | null {
  return typeof window !== "undefined" ? window.ethereum ?? null : null;
}

export function hasWallet(): boolean {
  return Boolean(getProvider());
}

export function hasConfiguredDeployment(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(bridgeProofAddress) && /^0x[0-9a-fA-F]{40}$/.test(executorAddress);
}

export async function getConnectedWallet(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
  } catch {
    // A wallet extension may be present but temporarily unavailable or
    // competing with another injected provider. Public reads remain usable.
    return null;
  }
}

export async function connectWallet(): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error("Install a browser wallet to sign BridgeProof transactions.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("The wallet did not return an account.");
  }
  return accounts[0];
}

export async function getWalletChainId(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    return typeof chainId === "string" ? chainId : null;
  } catch {
    // Chain detection is advisory for read-only pages and must not block
    // public proof reconciliation.
    return null;
  }
}

export async function switchToStudioNet(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) throw new Error("Install a browser wallet before switching networks.");
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: STUDIONET_CHAIN_ID_HEX }] });
  return getWalletChainId();
}

async function createGenLayerClient(account?: string): Promise<GenLayerClient> {
  const [{ createClient }, { studionet }] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/chains"),
  ]);
  return createClient({
    chain: studionet,
    ...(account ? { account: account as `0x${string}` } : {}),
    // Public proof pages must be readable without a connected wallet. Only
    // attach the injected provider when a wallet-backed client is requested;
    // otherwise genlayer-js uses the configured HTTP endpoint for reads.
    ...(account && getProvider() ? { provider: getProvider() as never } : {}),
    endpoint: studioUrl,
  }) as unknown as GenLayerClient;
}

async function writeAndFinalize(
  client: GenLayerClient,
  functionName: string,
  args: unknown[],
  onSubmitted?: (hash: string) => void,
  address = bridgeProofAddress,
): Promise<WriteResult> {
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    value: 0n,
  });
  onSubmitted?.(hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    interval: FINALITY_INTERVAL_MS,
    retries: FINALITY_RETRIES,
  });
  if (isFailedReceipt(receipt)) {
    const error = new Error(
      getReceiptFailureMessage(receipt) ?? "GenLayer finalized this call without a successful contract execution.",
    ) as Error & { transactionHash?: string };
    error.transactionHash = hash;
    throw error;
  }
  return { hash, receipt };
}

export class BridgeProofClient {
  constructor(private readonly client: GenLayerClient) {}

  static async create(account?: string): Promise<BridgeProofClient> {
    return new BridgeProofClient(await createGenLayerClient(account));
  }

  getTarget(targetId: string): Promise<TargetRecord> {
    return this.client.readContract({ address: bridgeProofAddress, functionName: "get_target", args: [targetId] }) as Promise<TargetRecord>;
  }

  getProof(proofId: string): Promise<BridgeProofRecord> {
    return this.client.readContract({ address: bridgeProofAddress, functionName: "get_proof", args: [proofId] }) as Promise<BridgeProofRecord>;
  }

  isPermitValid(proofId: string): Promise<boolean> {
    return this.client.readContract({ address: bridgeProofAddress, functionName: "is_permit_valid", args: [proofId] }) as Promise<boolean>;
  }

  openProof(args: unknown[], onSubmitted?: (hash: string) => void): Promise<WriteResult> {
    return writeAndFinalize(this.client, "open_proof", args, onSubmitted);
  }

  registerTarget(args: unknown[], onSubmitted?: (hash: string) => void): Promise<WriteResult> {
    return writeAndFinalize(this.client, "register_target", args, onSubmitted);
  }

  updateTarget(args: unknown[], onSubmitted?: (hash: string) => void): Promise<WriteResult> {
    return writeAndFinalize(this.client, "update_target", args, onSubmitted);
  }

  assessProof(proofId: string, onSubmitted?: (hash: string) => void): Promise<WriteResult> {
    return writeAndFinalize(this.client, "assess_proof", [proofId], onSubmitted);
  }

  retryAssessment(proofId: string, onSubmitted?: (hash: string) => void): Promise<WriteResult> {
    return writeAndFinalize(this.client, "retry_assessment", [proofId], onSubmitted);
  }

  consumePermit(proofId: string, onSubmitted?: (hash: string) => void): Promise<WriteResult> {
    return writeAndFinalize(this.client, "consume_permit", [proofId], onSubmitted);
  }
}

export async function createExecutorClient(account?: string): Promise<GenLayerClient> {
  return createGenLayerClient(account);
}

export async function writeExecutor(
  client: GenLayerClient,
  functionName: string,
  proofId: string,
  onSubmitted?: (hash: string) => void,
): Promise<WriteResult> {
  const hash = await client.writeContract({ address: executorAddress, functionName, args: [proofId], value: 0n });
  onSubmitted?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: FINALITY_INTERVAL_MS, retries: FINALITY_RETRIES });
  if (isFailedReceipt(receipt)) {
    const error = new Error(
      getReceiptFailureMessage(receipt) ?? "The guarded executor finalized with an execution error.",
    ) as Error & { transactionHash?: string };
    error.transactionHash = hash;
    throw error;
  }
  return { hash, receipt };
}
