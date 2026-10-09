import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  bridgeProofAddress,
  BridgeProofClient,
  BridgeProofRecord,
  connectWallet,
  createExecutorClient,
  ExecutionRecord,
  executorAddress,
  getConnectedWallet,
  getWalletChainId,
  hasConfiguredDeployment,
  TargetRecord,
  sourceChainLabel,
  switchToStudioNet,
  writeExecutor,
} from "./lib/bridgeproof";
import { chainIdLabel, isStudioNetChainId } from "./lib/network";
import { fetchSourceReceipt, SourceReceipt } from "./lib/source";
import { defaultExpiry, HASH_RE, ProofForm, toUnixSeconds, validateProofForm } from "./lib/validation";

const EXPLORER_BASE = "https://explorer-studio.genlayer.com";
const DEFAULT_TX_TEMPLATE = "https://eth-sepolia.blockscout.com/api/v2/transactions/{tx_hash}";
const DEFAULT_LOGS_TEMPLATE = "https://eth-sepolia.blockscout.com/api/v2/transactions/{tx_hash}/logs";

type Route =
  | { kind: "overview" }
  | { kind: "new-proof" }
  | { kind: "proof-detail"; proofId: string }
  | { kind: "operator" };

const initialForm = (): ProofForm => ({
  proofId: `proof-${Date.now().toString(36)}`,
  targetId: "sepolia-receipt-v2",
  sourceChainId: "11155111",
  txHash: "",
  expectedSender: "",
  expectedRecipient: "",
  expectedValue: "1",
  expectedPayloadHash: "",
  expectedNonce: "1",
  minConfirmations: "12",
  validUntil: defaultExpiry(),
});

type OperatorForm = {
  targetId: string;
  sourceChainId: string;
  targetName: string;
  targetDescription: string;
  transactionUrlTemplate: string;
  logsUrlTemplate: string;
  executor: string;
  finalityDepth: string;
};

const initialOperatorForm = (): OperatorForm => ({
  targetId: "sepolia-receipt-v2",
  sourceChainId: "11155111",
  targetName: "Sepolia transaction receipt",
  targetDescription: "Verifies authoritative Sepolia receipt fields and confirmation depth. Version 1 does not decode or assert bridge-message event semantics.",
  transactionUrlTemplate: DEFAULT_TX_TEMPLATE,
  logsUrlTemplate: DEFAULT_LOGS_TEMPLATE,
  executor: executorAddress,
  finalityDepth: "12",
});

type Notice = { tone: "info" | "success" | "error"; text: string } | null;

function parseRoute(pathname = window.location.pathname): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/proofs/new") return { kind: "new-proof" };
  if (path === "/operator") return { kind: "operator" };
  if (path.startsWith("/proofs/")) return { kind: "proof-detail", proofId: decodeURIComponent(path.slice("/proofs/".length)) };
  return { kind: "overview" };
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function numberValue(value: bigint | number | undefined): string {
  return value === undefined ? "—" : String(value);
}

function explorerLink(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

function statusLabel(status: string | undefined): string {
  return (status || "not_started").replaceAll("_", " ");
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [account, setAccount] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<string | null>(null);
  const [client, setClient] = useState<BridgeProofClient | null>(null);
  const [executorClient, setExecutorClient] = useState<Awaited<ReturnType<typeof createExecutorClient>> | null>(null);
  const [form, setForm] = useState<ProofForm>(initialForm);
  const [operatorForm, setOperatorForm] = useState<OperatorForm>(initialOperatorForm);
  const [proof, setProof] = useState<BridgeProofRecord | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofReadError, setProofReadError] = useState<string | null>(null);
  const [sourceReceipt, setSourceReceipt] = useState<SourceReceipt | null>(null);
  const [sourceLookupHash, setSourceLookupHash] = useState("");
  const [target, setTarget] = useState<TargetRecord | null>(null);
  const [execution, setExecution] = useState<ExecutionRecord | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const configured = hasConfiguredDeployment();
  const walletOnStudioNet = isStudioNetChainId(walletChainId);
  const canWrite = Boolean(account && walletOnStudioNet);
  const formErrors = useMemo(() => validateProofForm(form), [form]);
  const currentStatus = execution?.status || proof?.status || "draft";
  const isPending = Boolean(busy);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    void (async () => {
      const connected = await getConnectedWallet();
      setWalletChainId(await getWalletChainId());
      if (configured) {
        setClient(await BridgeProofClient.create(connected || undefined));
        setExecutorClient(await createExecutorClient(connected || undefined));
      }
      if (!connected) return;
      setAccount(connected);
    })();

    const provider = window.ethereum;
    if (!provider?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] : [];
      const connected = typeof accounts[0] === "string" ? accounts[0] : null;
      setAccount(connected);
      void getWalletChainId().then(setWalletChainId);
      if (!configured) return;
      void BridgeProofClient.create(connected || undefined).then(setClient);
      void createExecutorClient(connected || undefined).then(setExecutorClient);
    };

    const onChainChanged = (chainId: unknown) => {
      setWalletChainId(typeof chainId === "string" ? chainId : null);
      if (!configured) return;
      void BridgeProofClient.create(account || undefined).then(setClient);
      void createExecutorClient(account || undefined).then(setExecutorClient);
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [account, configured]);

  useEffect(() => {
    if (route.kind !== "proof-detail" || !client || !route.proofId) return;
    setProof(null);
    setProofReadError(null);
    setForm((current) => ({ ...current, proofId: route.proofId }));
    void refreshProof(route.proofId);
    if (executorClient) void refreshExecution(route.proofId);
  }, [route, client, executorClient]);

  function go(path: string) {
    window.history.pushState({}, "", path);
    setRoute(parseRoute(path));
    setNotice(null);
  }

  async function handleConnect() {
    try {
      const connected = await connectWallet();
      const chainId = await getWalletChainId();
      setAccount(connected);
      setWalletChainId(chainId);
      if (configured) {
        setClient(await BridgeProofClient.create(connected));
        setExecutorClient(await createExecutorClient(connected));
      }
      setNotice({ tone: isStudioNetChainId(chainId) ? "success" : "info", text: isStudioNetChainId(chainId) ? `Wallet connected: ${shortAddress(connected)}` : "Wallet connected. Switch to GenLayer StudioNet before signing." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleSwitchNetwork() {
    setBusy("switch-network");
    try {
      const chainId = await switchToStudioNet();
      setWalletChainId(chainId);
      setNotice({ tone: "success", text: "Wallet switched to GenLayer StudioNet. Writes are enabled." });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: number }).code
        : undefined;
      const text = code === 4902
        ? "GenLayer StudioNet is not added to this wallet. Add chain 61999, then try again."
        : error instanceof Error ? error.message : String(error);
      setNotice({ tone: "error", text });
    } finally {
      setBusy(null);
    }
  }

  function patchForm(field: keyof ProofForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "txHash" || field === "targetId") {
      setSourceReceipt(null);
    }
  }

  function patchOperator(field: keyof OperatorForm, value: string) {
    setOperatorForm((current) => ({ ...current, [field]: value }));
  }

  async function refreshProof(proofId = form.proofId) {
    if (!client || !proofId.trim()) return;
    setProofLoading(true);
    setProofReadError(null);
    try {
      setProof(await client.getProof(proofId.trim()));
    } catch {
      setProof(null);
      setProofReadError("StudioNet did not return this proof. Refresh to try the read again.");
    } finally {
      setProofLoading(false);
    }
  }

  async function refreshExecution(proofId: string) {
    if (!executorClient || !proofId.trim()) return;
    try {
      const nextExecution = await executorClient.readContract({
        address: executorAddress,
        functionName: "get_execution",
        args: [proofId.trim()],
      }) as ExecutionRecord;
      setExecution(nextExecution);
    } catch {
      setExecution(null);
    }
  }

  async function loadSourceReceipt() {
    if (busy === "source") return;
    if (!client) return setNotice({ tone: "error", text: "Connect to the configured deployment before fetching source data." });
    const txHash = form.txHash.trim().toLowerCase();
    if (!HASH_RE.test(txHash)) return setNotice({ tone: "error", text: "Enter a complete 32-byte source transaction hash first." });
    if (!form.targetId.trim()) return setNotice({ tone: "error", text: "Enter a target ID before fetching source data." });

    setBusy("source");
    setNotice({ tone: "info", text: "Fetching the source transaction and logs…" });
    try {
      const sourceTarget = await client.getTarget(form.targetId.trim());
      const nextReceipt = await fetchSourceReceipt(
        sourceTarget.transaction_url_template,
        sourceTarget.logs_url_template,
        txHash,
      );
      setSourceReceipt(nextReceipt);
      setSourceLookupHash(txHash);
      setForm((current) => ({
        ...current,
        sourceChainId: sourceTarget.source_chain_id,
        expectedSender: nextReceipt.sender,
        expectedRecipient: nextReceipt.recipient,
        expectedValue: nextReceipt.value,
        expectedPayloadHash: nextReceipt.payloadHash,
        expectedNonce: nextReceipt.nonce,
        minConfirmations: String(sourceTarget.finality_depth),
      }));
      setNotice({ tone: "success", text: `Source receipt loaded. Review the populated claim before signing (${nextReceipt.logCount} logs).` });
    } catch (error) {
      setSourceReceipt(null);
      setSourceLookupHash("");
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function loadExistingProof() {
    setNotice(null);
    try {
      await refreshProof();
      go(`/proofs/${encodeURIComponent(form.proofId.trim())}`);
      setNotice({ tone: "success", text: `Loaded proof ${form.proofId.trim()}.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submitProof() {
    setNotice(null);
    if (!client || !account) return setNotice({ tone: "error", text: "Connect a wallet before submitting a proof." });
    if (!walletOnStudioNet) return setNotice({ tone: "error", text: "Switch the wallet to GenLayer StudioNet (chain ID 61999) before submitting." });
    if (formErrors.length) return setNotice({ tone: "error", text: formErrors[0] });
    setBusy("open");
    try {
      const result = await client.openProof([
        form.proofId.trim(), form.targetId.trim(), form.sourceChainId.trim(), form.txHash.trim(),
        form.expectedSender.trim(), form.expectedRecipient.trim(), BigInt(form.expectedValue),
        form.expectedPayloadHash.trim(), BigInt(form.expectedNonce), BigInt(form.minConfirmations), toUnixSeconds(form.validUntil),
      ], (hash) => setNotice({ tone: "info", text: `Proof transaction submitted: ${hash.slice(0, 12)}…` }));
      await refreshProof();
      go(`/proofs/${encodeURIComponent(form.proofId.trim())}`);
      setNotice({ tone: "success", text: `Proof opened and finalized: ${result.hash.slice(0, 12)}…` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function assessProof() {
    if (!client || !proof) return;
    if (!canWrite) return setNotice({ tone: "error", text: "Switch the wallet to GenLayer StudioNet (chain ID 61999) before assessing." });
    setBusy("assess");
    try {
      const result = await client.assessProof(proof.proof_id, (hash) => setNotice({ tone: "info", text: `Assessment submitted: ${hash.slice(0, 12)}…` }));
      await refreshProof(proof.proof_id);
      setNotice({ tone: "success", text: `Consensus assessment finalized: ${result.hash.slice(0, 12)}…` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function executeProof() {
    if (!executorClient || !proof) return;
    if (!canWrite) return setNotice({ tone: "error", text: "Switch the wallet to GenLayer StudioNet (chain ID 61999) before executing." });
    setBusy("execute");
    try {
      const result = await writeExecutor(executorClient, "start_execution", proof.proof_id, (hash) => setNotice({ tone: "info", text: `Execution queued: ${hash.slice(0, 12)}…` }));
      await refreshProof(proof.proof_id);
      await refreshExecution(proof.proof_id);
      setNotice({ tone: "success", text: `Permit consumption finalized: ${result.hash.slice(0, 12)}…` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function finalizeProof() {
    if (!executorClient || !proof) return;
    if (!canWrite) return setNotice({ tone: "error", text: "Switch the wallet to GenLayer StudioNet (chain ID 61999) before finalizing." });
    setBusy("finalize");
    try {
      const result = await writeExecutor(executorClient, "finalize_execution", proof.proof_id, (hash) => setNotice({ tone: "info", text: `Finalization submitted: ${hash.slice(0, 12)}…` }));
      await refreshProof(proof.proof_id);
      await refreshExecution(proof.proof_id);
      setNotice({ tone: "success", text: `Guarded action finalized: ${result.hash.slice(0, 12)}…` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function retryAssessment() {
    if (!client || !proof) return;
    if (!canWrite) return setNotice({ tone: "error", text: "Switch the wallet to GenLayer StudioNet (chain ID 61999) before retrying." });
    setBusy("retry");
    try {
      await client.retryAssessment(proof.proof_id, (hash) => setNotice({ tone: "info", text: `Retry submitted: ${hash.slice(0, 12)}…` }));
      await refreshProof(proof.proof_id);
      setNotice({ tone: "success", text: "Proof reset for a bounded retry." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function registerTarget() {
    setNotice(null);
    if (!client || !account) return setNotice({ tone: "error", text: "Connect the owner wallet before registering a target." });
    if (!walletOnStudioNet) return setNotice({ tone: "error", text: "Switch the wallet to GenLayer StudioNet (chain ID 61999) before registering a target." });
    if (!/^0x[0-9a-fA-F]{40}$/.test(operatorForm.executor)) return setNotice({ tone: "error", text: "Executor must be a valid deployed contract address." });
    setBusy("register-target");
    try {
      const result = await client.registerTarget([
        operatorForm.targetId.trim(), operatorForm.sourceChainId.trim(), operatorForm.targetName.trim(),
        operatorForm.targetDescription.trim(), operatorForm.transactionUrlTemplate.trim(), operatorForm.logsUrlTemplate.trim(),
        operatorForm.executor.trim(), BigInt(operatorForm.finalityDepth),
      ], (hash) => setNotice({ tone: "info", text: `Target registration submitted: ${hash.slice(0, 12)}…` }));
      const nextTarget = await client.getTarget(operatorForm.targetId.trim());
      setTarget(nextTarget);
      setNotice({ tone: "success", text: `Target registered and read back after ${result.hash.slice(0, 12)}…` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function loadTarget() {
    if (!client || !operatorForm.targetId.trim()) return;
    setBusy("load-target");
    try {
      const nextTarget = await client.getTarget(operatorForm.targetId.trim());
      setTarget(nextTarget);
      setNotice({ tone: "success", text: `Loaded target ${operatorForm.targetId.trim()} from chain state.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  const deploymentBanner = !configured ? (
    <section className="config-banner" role="status"><div className="banner-icon"><LockKeyhole size={18} /></div><div><strong>Deployment not configured.</strong><span>This product does not simulate contract success. Add the deployed BridgeProof and GuardedExecutor addresses before enabling writes.</span></div><button className="quiet-button" onClick={() => go("/operator")}>Open operator setup</button></section>
  ) : null;

  const networkBanner = account && walletChainId && !walletOnStudioNet ? (
    <section className="network-warning" role="alert"><div className="banner-icon"><CircleAlert size={18} /></div><div><strong>Wallet is on the wrong network.</strong><span>BridgeProof writes live on GenLayer StudioNet (chain ID 61999). Your wallet is currently on {chainIdLabel(walletChainId)}. Source receipts still come from Ethereum Sepolia.</span></div><button className="quiet-button" onClick={() => { void handleSwitchNetwork(); }} disabled={isPending}>{busy === "switch-network" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Switch to StudioNet</button></section>
  ) : null;

  const proofDetail = proof ? (
    <div className="proof-detail">
      <div className="proof-head"><div><span className="proof-label">{proof.proof_id}</span><strong className={`status-badge status-${proof.status.replaceAll("_", "-")}`}>{statusLabel(proof.status)}</strong></div><button className="icon-button" onClick={() => { void refreshProof(proof.proof_id); void refreshExecution(proof.proof_id); }} aria-label="Refresh proof"><RefreshCw size={16} /></button></div>
      <div className="rail"><span className={proof.status === "pending" ? "active" : "done"}>Claim</span><i /><span className={proof.status === "approved" || proof.status === "rejected" || proof.status === "insufficient_evidence" || proof.status === "permit_consumed" ? "active" : ""}>Consensus</span><i /><span className={proof.status === "permit_consumed" ? "active" : ""}>Guarded action</span></div>
      <dl className="receipt-list"><div><dt>Source tx</dt><dd>{shortAddress(proof.tx_hash)} <a href={explorerLink(proof.tx_hash)} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a></dd></div><div><dt>Sender → recipient</dt><dd>{shortAddress(proof.observed_sender || proof.expected_sender)} → {shortAddress(proof.observed_recipient || proof.expected_recipient)}</dd></div><div><dt>Value / nonce</dt><dd>{numberValue(proof.observed_value || proof.expected_value)} / {numberValue(proof.observed_nonce || proof.expected_nonce)}</dd></div><div><dt>Finality</dt><dd>{numberValue(proof.observed_confirmations)} / {numberValue(proof.min_confirmations)} confirmations</dd></div><div><dt>Decision</dt><dd>{proof.reason_code.replaceAll("_", " ")} · {proof.confidence_band}</dd></div></dl>
      {proof.rationale && <div className="rationale"><span>Validator rationale</span><p>{proof.rationale}</p></div>}
      <div className="detail-actions">
        {proof.status === "pending" && <button className="secondary-button" onClick={assessProof} disabled={isPending || !canWrite}>{busy === "assess" ? <LoaderCircle className="spin" size={16} /> : <ScanSearch size={16} />} {!account ? "Connect wallet to assess" : !walletOnStudioNet ? "Switch to StudioNet to assess" : "Assess with consensus"}</button>}
        {proof.status === "approved" && <button className="primary-button" onClick={executeProof} disabled={isPending || !canWrite}>{busy === "execute" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />} {!account ? "Connect wallet to execute" : !walletOnStudioNet ? "Switch to StudioNet to execute" : "Start guarded action"}</button>}
        {proof.status === "permit_consumed" && execution?.status === "awaiting_permit" && <button className="primary-button" onClick={finalizeProof} disabled={isPending || !canWrite}>{busy === "finalize" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {!account ? "Connect wallet to finalize" : !walletOnStudioNet ? "Switch to StudioNet to finalize" : "Finalize action"}</button>}
        {proof.status === "permit_consumed" && execution?.status === "finalized" && <span className="action-note">Guarded action finalized on chain.</span>}
        {proof.status === "insufficient_evidence" && <button className="secondary-button" onClick={retryAssessment} disabled={isPending || !canWrite}><RefreshCw size={16} /> {!walletOnStudioNet && account ? "Switch to StudioNet to retry" : "Retry assessment"}</button>}
      </div>
    </div>
  ) : proofReadError ? (
    <div className="empty-state"><div className="empty-icon"><CircleAlert size={22} /></div><strong>Proof read failed</strong><p>{proofReadError}</p></div>
  ) : proofLoading || (route.kind === "proof-detail" && configured && !client) ? (
    <div className="empty-state"><div className="empty-icon"><LoaderCircle className="spin" size={22} /></div><strong>Reading proof state</strong><p>Reconciles the proof from the deployed contract. A pending screen is not a success signal.</p></div>
  ) : <div className="empty-state"><div className="empty-icon"><ScanSearch size={22} /></div><strong>No proof loaded</strong><p>Open a proof to reconcile its real contract state here. Pending is a state, not a success signal.</p></div>;

  function OverviewScreen() {
    return <><section className="hero"><div className="hero-copy"><p className="eyebrow"><span className="eyebrow-line" /> Transaction-receipt verification for guarded execution</p><h1>Verify the receipt before execution.</h1><p className="hero-lede">BridgeProof checks a source-chain transaction receipt against a complete claim, then lets a guarded executor act only after GenLayer consensus agrees on the evidence.</p><div className="hero-actions"><button className="primary-button" onClick={() => go("/proofs/new")}>Create a proof <ChevronRight size={17} /></button><button className="text-link" onClick={() => document.getElementById("principles")?.scrollIntoView({ behavior: "smooth" })}>How it works <ArrowUpRight size={15} /></button></div></div><div className="hero-stamp" aria-label="No permit without a complete match"><div className="stamp-ring"><ShieldCheck size={40} strokeWidth={1.4} /></div><span>NO PERMIT</span><strong>without a complete match</strong></div></section><section className="status-strip" aria-label="BridgeProof status"><div><span className="stat-label">Network</span><strong>{sourceChainLabel}</strong><small>receipt integration</small></div><div><span className="stat-label">Contract</span><strong>{configured ? "Connected" : "Not configured"}</strong><small>{configured ? shortAddress(bridgeProofAddress) : "deployment required"}</small></div><div><span className="stat-label">Proof state</span><strong className={`state-${currentStatus.replaceAll("_", "-")}`}>{statusLabel(currentStatus)}</strong><small>derived from chain state</small></div><div><span className="stat-label">Guard</span><strong>{executorAddress ? "Bound executor" : "Awaiting deployment"}</strong><small>{executorAddress ? shortAddress(executorAddress) : "no bypass path"}</small></div></section>{deploymentBanner}<section className="onboarding-panel" aria-labelledby="onboarding-title"><div className="onboarding-copy"><p className="eyebrow"><span className="eyebrow-line" /> First run / engineer onboarding</p><h2 id="onboarding-title">From deployed boundary to first verified proof.</h2><p>BridgeProof is for the engineer responsible for releasing an action from verified transaction-receipt evidence. Configure the boundary once, then use each proof as an auditable decision.</p><button className="primary-button" onClick={() => go(account ? "/proofs/new" : "/operator")}>{account ? "Create your first proof" : "Start with operator setup"} <ArrowRight size={16} /></button></div><div className="onboarding-steps"><div className={`onboarding-step ${configured ? "done" : "current"}`}><span>01</span><div><strong>Confirm the deployment</strong><p>Use the configured StudioNet contracts and source-chain target.</p></div><Check size={15} /></div><div className={`onboarding-step ${account ? "done" : "current"}`}><span>02</span><div><strong>Connect the operator wallet</strong><p>Writes require a wallet; public proof pages stay read-only.</p></div>{account && <Check size={15} />}</div><div className="onboarding-step"><span>03</span><div><strong>Open and assess a proof</strong><p>State the expected receipt fields. Validators fetch the evidence themselves.</p></div></div><div className="onboarding-step"><span>04</span><div><strong>Release only after approval</strong><p>The executor rechecks the active target and bound version before acting.</p></div></div></div></section><section className="overview-grid"><article className="overview-card accent-mint"><span className="card-index">01 / PROOF WORKSPACE</span><h2>Make the claim explicit.</h2><p>Bind sender, recipient, value, input commitment, nonce, and finality before a validator sees the source evidence.</p><button className="text-link" onClick={() => go("/proofs/new")}>Open workspace <ArrowUpRight size={15} /></button></article><article className="overview-card accent-blue"><span className="card-index">02 / PUBLIC DETAIL</span><h2>Follow the lifecycle.</h2><p>One route shows the stored claim, live receipt fields, consensus result, and guarded execution status.</p><button className="text-link" onClick={() => proof ? go(`/proofs/${encodeURIComponent(proof.proof_id)}`) : go("/proofs/new")}>{proof ? "View current proof" : "Load a proof"} <ArrowUpRight size={15} /></button></article><article className="overview-card accent-orange"><span className="card-index">03 / OPERATOR SETUP</span><h2>Configure the boundary.</h2><p>Register a source-chain target, authoritative endpoints, finality depth, and the only executor allowed to consume permits.</p><button className="text-link" onClick={() => go("/operator")}>Open setup <ArrowUpRight size={15} /></button></article></section><Principles /></>;
  }

  function NewProofScreen() {
    const hasFetchedSource = Boolean(sourceReceipt && sourceLookupHash === form.txHash.trim().toLowerCase());
    return <>
      <div className="screen-heading">
        <button className="back-link" onClick={() => go("/")}><ArrowLeft size={15} /> Overview</button>
        <p className="eyebrow"><span className="eyebrow-line" /> Proof workspace</p>
        <h1>Open a receipt proof.</h1>
        <p>Make the expected source-chain state explicit. Enter a real transaction and BridgeProof will fetch the evidence needed to populate the claim before you sign.</p>
      </div>
      {deploymentBanner}
      <section className="workspace-single panel claim-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">01 / Claim</p><h2>What should be true?</h2></div>
          <span className="panel-number">{configured ? "READY" : "SETUP"}</span>
        </div>
        <div className="proof-callout"><CircleHelp size={18} /><div><strong>This is a transaction-receipt claim, not a bridge-event proof.</strong><p>GenLayer validators fetch the transaction and logs response, then compare every consequential transaction field. This release does not decode protocol-specific bridge events.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>Proof ID</span><input value={form.proofId} onChange={(event) => patchForm("proofId", event.target.value)} /></label>
          <label className="field"><span>Target ID</span><input value={form.targetId} onChange={(event) => patchForm("targetId", event.target.value)} /></label>
          <label className="field"><span>Source chain ID</span><input value={form.sourceChainId} onChange={(event) => patchForm("sourceChainId", event.target.value)} /></label>
          <label className="field field-wide source-hash-field">
            <span>Source transaction hash</span>
            <div className="source-hash-control">
              <input aria-label="Source transaction hash" placeholder="0x…" value={form.txHash} onChange={(event) => patchForm("txHash", event.target.value)} onBlur={() => { if (HASH_RE.test(form.txHash.trim())) void loadSourceReceipt(); }} />
              <button className="secondary-button" type="button" onClick={() => { void loadSourceReceipt(); }} disabled={!configured || !client || isPending || !HASH_RE.test(form.txHash.trim())}>
                {busy === "source" ? <LoaderCircle className="spin" size={16} /> : <ScanSearch size={16} />} {busy === "source" ? "Fetching…" : "Fetch source data"}
              </button>
            </div>
            <small>Paste a real source-chain transaction. BridgeProof reads its transaction and logs endpoints, then fills the claim below.</small>
          </label>
          <label className="field"><span>Expected sender</span><input placeholder="0x…" value={form.expectedSender} onChange={(event) => patchForm("expectedSender", event.target.value)} /></label>
          <label className="field"><span>Expected recipient</span><input placeholder="0x…" value={form.expectedRecipient} onChange={(event) => patchForm("expectedRecipient", event.target.value)} /></label>
          <label className="field"><span>Expected value</span><input inputMode="numeric" value={form.expectedValue} onChange={(event) => patchForm("expectedValue", event.target.value)} /></label>
          <label className="field"><span>Expected nonce</span><input inputMode="numeric" value={form.expectedNonce} onChange={(event) => patchForm("expectedNonce", event.target.value)} /></label>
          <label className="field field-wide"><span>Expected payload hash</span><input placeholder="sha256(raw input)" value={form.expectedPayloadHash} onChange={(event) => patchForm("expectedPayloadHash", event.target.value)} /></label>
          <label className="field"><span>Min confirmations</span><input inputMode="numeric" value={form.minConfirmations} onChange={(event) => patchForm("minConfirmations", event.target.value)} /></label>
          <label className="field"><span>Proof expires</span><input type="datetime-local" value={form.validUntil} onChange={(event) => patchForm("validUntil", event.target.value)} /></label>
        </div>
        {formErrors.length > 0 && <p className="field-hint"><CircleAlert size={14} /> {formErrors[0]}</p>}
        {hasFetchedSource && sourceReceipt && <section className="source-receipt" aria-live="polite"><div className="source-receipt-head"><div><p className="eyebrow">Source receipt fetched</p><strong>Review the populated claim before signing.</strong></div><span className={`source-status source-status-${sourceReceipt.status || "unknown"}`}>{sourceReceipt.status || "unknown"}</span></div><div className="source-receipt-grid"><div><span>Raw input</span><code>{sourceReceipt.rawInput}</code></div><div><span>Payload commitment</span><code>{sourceReceipt.payloadHash}</code></div><div><span>Evidence</span><strong>{sourceReceipt.confirmations} confirmations · {sourceReceipt.logCount} logs</strong></div></div><p className="source-receipt-note">These values came from the configured source endpoints. You can edit the expected fields when intentionally testing a mismatch.</p></section>}
        <div className="source-field-guide"><div><span>Receipt fields</span><p>Fetched from the configured transaction endpoint.</p></div><div><span>Payload commitment</span><p>Derived automatically from normalized transaction input.</p></div><div><span>Finality</span><p>Minimum confirmations come from the registered target.</p></div></div>
        <div className="form-secondary-action"><button className="secondary-button" onClick={loadExistingProof} disabled={!configured || !client || isPending || !form.proofId.trim()}><ScanSearch size={16} /> Load existing proof</button><span>Read-only reconciliation does not require a wallet.</span></div>
        <button className="primary-button full-button" onClick={submitProof} disabled={!configured || !canWrite || isPending || formErrors.length > 0}>{busy === "open" ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />} {!account ? "Connect wallet to continue" : !walletOnStudioNet ? "Switch to StudioNet to continue" : "Sign and open proof"}</button>
      </section>
    </>;
  }

  function ProofDetailScreen() {
    return <><div className="screen-heading"><button className="back-link" onClick={() => go("/proofs/new")}><ArrowLeft size={15} /> New proof</button><p className="eyebrow"><span className="eyebrow-line" /> Public proof detail</p><h1>{route.kind === "proof-detail" ? route.proofId : "Proof detail"}</h1><p>Every value below is read from the deployed contract after finalization. A transaction badge alone is never treated as success.</p></div><section className="panel detail-panel detail-screen-panel"><div className="panel-heading"><div><p className="eyebrow">02 / Decision</p><h2>Lifecycle and evidence</h2></div><ScanSearch size={20} className="panel-icon" /></div>{proofDetail}</section></>;
  }

  function OperatorScreen() {
    return <>
      <div className="screen-heading"><button className="back-link" onClick={() => go("/")}><ArrowLeft size={15} /> Overview</button><p className="eyebrow"><span className="eyebrow-line" /> Operator control plane</p><h1>Set the boundary once.</h1><p>Register the authoritative source endpoints and the guarded executor that may consume approved permits. This is an owner-only operation and does not store private keys.</p></div>
      {deploymentBanner}
      <section className="setup-guide" aria-labelledby="setup-guide-title"><div><p className="eyebrow"><span className="eyebrow-line" /> One-time setup</p><h2 id="setup-guide-title">Register the source boundary your proofs will trust.</h2><p>Use a stable target ID for one source-chain integration. The contract stores the endpoint templates and executor binding so validators can fetch the same evidence every time.</p></div><ol><li><strong>Point to authoritative data</strong><span>Transaction and logs URLs must accept <code>{"{tx_hash}"}</code>.</span></li><li><strong>Bind the executor</strong><span>Only this deployed contract can consume an approved permit.</span></li><li><strong>Read it back</strong><span>Confirm the target is active before opening proofs.</span></li></ol></section>
      <section className="operator-layout"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">01 / Target registry</p><h2>Source-chain target</h2></div><Settings2 size={20} className="panel-icon" /></div><p className="panel-intro">The contract stores these templates. Validators substitute the claimed transaction hash and fetch both views during assessment.</p><div className="form-grid"><label className="field"><span>Target ID</span><input value={operatorForm.targetId} onChange={(event) => patchOperator("targetId", event.target.value)} /></label><label className="field"><span>Source chain ID</span><input value={operatorForm.sourceChainId} onChange={(event) => patchOperator("sourceChainId", event.target.value)} /></label><label className="field field-wide"><span>Target name</span><input value={operatorForm.targetName} onChange={(event) => patchOperator("targetName", event.target.value)} /></label><label className="field field-wide"><span>Description</span><textarea value={operatorForm.targetDescription} onChange={(event) => patchOperator("targetDescription", event.target.value)} /></label><label className="field field-wide"><span>Transaction JSON endpoint</span><input value={operatorForm.transactionUrlTemplate} onChange={(event) => patchOperator("transactionUrlTemplate", event.target.value)} /></label><label className="field field-wide"><span>Logs JSON endpoint</span><input value={operatorForm.logsUrlTemplate} onChange={(event) => patchOperator("logsUrlTemplate", event.target.value)} /></label><label className="field field-wide"><span>Guarded executor address</span><input placeholder="0x…" value={operatorForm.executor} onChange={(event) => patchOperator("executor", event.target.value)} /></label><label className="field"><span>Finality depth</span><input inputMode="numeric" value={operatorForm.finalityDepth} onChange={(event) => patchOperator("finalityDepth", event.target.value)} /></label></div><div className="operator-actions"><button className="primary-button" onClick={registerTarget} disabled={!configured || !canWrite || isPending}>{busy === "register-target" ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />} {!account ? "Connect owner wallet" : !walletOnStudioNet ? "Switch to StudioNet to register" : "Sign and register target"}</button><button className="secondary-button" onClick={loadTarget} disabled={!configured || !client || isPending}>{busy === "load-target" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} Read target</button></div></div><div className="panel readback-panel"><div className="panel-heading"><div><p className="eyebrow">02 / Readback</p><h2>Stored configuration</h2></div><span className="panel-number">CHAIN</span></div>{target ? <dl className="receipt-list"><div><dt>ID / version</dt><dd>{target.target_id} / {numberValue(target.version)}</dd></div><div><dt>Owner</dt><dd>{shortAddress(target.owner)}</dd></div><div><dt>Source</dt><dd>{target.source_chain_id} · {target.active ? "active" : "inactive"}</dd></div><div><dt>Executor</dt><dd>{shortAddress(target.executor)}</dd></div><div><dt>Finality</dt><dd>{numberValue(target.finality_depth)} confirmations</dd></div><div><dt>Tx template</dt><dd className="wrap-value">{target.transaction_url_template}</dd></div></dl> : <div className="empty-state compact"><div className="empty-icon"><Settings2 size={22} /></div><strong>No target read back</strong><p>Register or load a target to see the exact configuration held by BridgeProof.</p></div>}<div className="boundary-note"><ShieldCheck size={17} /><span>Only the configured executor can consume an approved permit. The browser cannot bypass this boundary.</span></div></div></section>
    </>;
  }

  function Principles() {
    return <section className="proof-principles" id="principles"><div><p className="eyebrow">The boundary</p><h2>A receipt is evidence. A permit is a decision.</h2></div><div className="principle-grid"><article><span>01</span><strong>Fetch inside consensus</strong><p>The browser submits a claim; validators inspect the configured source evidence themselves.</p></article><article><span>02</span><strong>Compare every field</strong><p>Sender, recipient, value, payload, nonce, status, and finality all bind the stored decision.</p></article><article><span>03</span><strong>Execute once</strong><p>The guarded executor cannot act until a valid permit is consumed, and cannot consume it twice.</p></article></div></section>;
  }

  const nav = (label: string, path: string, active: boolean) => <button className={`nav-item ${active ? "active" : ""}`} onClick={() => go(path)} aria-current={active ? "page" : undefined}>{label}</button>;

  return <div className="app-shell">
    <header className="topbar"><button className="wordmark" onClick={() => go("/")} aria-label="BridgeProof home"><span className="mark" aria-hidden="true"><span /></span><span>BridgeProof</span></button><nav className="primary-nav" aria-label="Primary navigation">{nav("Overview", "/", route.kind === "overview")}{nav("Proof workspace", "/proofs/new", route.kind === "new-proof")}{nav("Operator setup", "/operator", route.kind === "operator")}</nav><div className="topbar-right"><span className={`network-chip ${account && !walletOnStudioNet ? "network-chip-warning" : ""}`}><span className="live-dot" /> {account ? (walletOnStudioNet ? `${sourceChainLabel} / StudioNet ready` : "Switch to StudioNet") : `${sourceChainLabel} / StudioNet`}</span><button className="wallet-button" onClick={handleConnect} disabled={isPending}><Wallet size={16} /> {account ? shortAddress(account) : "Connect wallet"}</button></div></header>
    <main className="page">{networkBanner}{route.kind === "overview" && <OverviewScreen />}{route.kind === "new-proof" && <NewProofScreen />}{route.kind === "proof-detail" && <ProofDetailScreen />}{route.kind === "operator" && <OperatorScreen />}{notice && <div className={`notice notice-${notice.tone}`} role="status"><span>{notice.tone === "success" ? <Check size={16} /> : notice.tone === "error" ? <CircleAlert size={16} /> : <LoaderCircle className={busy ? "spin" : ""} size={16} />}</span><p>{notice.text}</p><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}</main>
    <footer className="footer"><span>BridgeProof / production build in progress</span><span>Source-first. Fail-closed. Observable.</span></footer>
  </div>;
}

export default App;
