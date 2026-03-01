"use client";

import { useState } from "react";
import { useUnlink, useDeposit } from "@unlink-xyz/react";
import { useAccount, useWalletClient } from "wagmi";
import { parseEther, encodeFunctionData, maxUint256 } from "viem";
import { publicClient } from "@/lib/viem";
import { WMON, ERC20_ABI } from "@/lib/contracts";

// WMON deposit() ABI — wraps native MON into WMON
const WMON_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

type Step = "create" | "backup" | "deposit" | "ready";

export function UnlinkOnboarding() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const {
    walletExists,
    createWallet,
    importWallet,
    unlink,
    activeAccount,
    balances,
    busy,
    error,
    clearError,
    refresh,
  } = useUnlink();
  const { deposit, isPending: depositPending } = useDeposit();

  const [step, setStep] = useState<Step>(walletExists ? "ready" : "create");
  const [mnemonic, setMnemonic] = useState("");
  const [importInput, setImportInput] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [depositAmount, setDepositAmount] = useState("0.01");
  const [depositTx, setDepositTx] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [depositPhase, setDepositPhase] = useState<string | null>(null);

  if (walletExists && step === "create") {
    setStep("ready");
  }

  // Check both casings for WMON balance
  const wmonLower = WMON.toLowerCase();
  const shieldedBalance = balances[wmonLower] ?? balances[WMON] ?? 0n;

  async function handleCreate() {
    clearError();
    try {
      const result = await createWallet();
      setMnemonic(result.mnemonic);
      setStep("backup");
    } catch {
      // error captured in useUnlink error state
    }
  }

  async function handleImport() {
    clearError();
    try {
      await importWallet(importInput.trim());
      setStep("ready");
    } catch {
      // error captured in useUnlink error state
    }
  }

  async function handleDeposit() {
    if (!address || !walletClient) return;
    clearError();
    setDepositError(null);
    setDepositPhase(null);

    try {
      const amountWei = parseEther(depositAmount);

      // ── Step 1: Wrap MON → WMON ──
      setDepositPhase("WRAPPING MON → WMON...");
      const wrapHash = await walletClient.sendTransaction({
        to: WMON as `0x${string}`,
        value: amountWei,
        data: encodeFunctionData({ abi: WMON_ABI, functionName: "deposit" }),
      });
      await publicClient.waitForTransactionReceipt({ hash: wrapHash });

      // ── Step 2: Approve WMON for the pool BEFORE getting commitment ──
      // We approve first so the pool can transferFrom when we deposit
      setDepositPhase("APPROVING WMON FOR POOL...");

      const poolAddress = unlink?.poolAddress as `0x${string}` | undefined;
      if (!poolAddress) {
        throw new Error("Unlink pool is not initialized yet. Please retry.");
      }

      // Check current allowance first
      const currentAllowance = await publicClient.readContract({
        address: WMON as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, poolAddress],
      });

      if (currentAllowance < amountWei) {
        const approveHash = await walletClient.sendTransaction({
          to: WMON as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [poolAddress, maxUint256],
          }),
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // ── Step 3: Submit deposit tx on-chain ──
      setDepositPhase("DEPOSITING INTO PRIVACY POOL...");
      const depositResult = await deposit([
        { token: WMON, amount: amountWei, depositor: address },
      ]);

      // Log for debugging
      console.log("[CTF-Chain] Deposit details:", {
        to: depositResult.to,
        calldata: depositResult.calldata?.slice(0, 20) + "...",
        value: depositResult.value?.toString(),
        relayId: depositResult.relayId,
      });

      // Simulate first to catch revert reasons
      try {
        await publicClient.call({
          account: address,
          to: depositResult.to as `0x${string}`,
          data: depositResult.calldata as `0x${string}`,
          value: depositResult.value ?? 0n,
        });
      } catch (simErr: unknown) {
        const simMsg = simErr instanceof Error ? simErr.message : String(simErr);
        console.error("[CTF-Chain] Deposit simulation failed:", simMsg);
        throw new Error(`Pool deposit reverted: ${simMsg.slice(0, 150)}`);
      }

      const depositHash = await walletClient.sendTransaction({
        to: depositResult.to as `0x${string}`,
        data: depositResult.calldata as `0x${string}`,
        value: depositResult.value ?? 0n,
      });
      setDepositTx(depositHash);
      await publicClient.waitForTransactionReceipt({ hash: depositHash });

      // ── Step 5: Wait for Unlink to index the deposit ──
      setDepositPhase("SYNCING SHIELDED BALANCE...");

      // Wait for the indexer to pick up the deposit, then refresh balances
      // The SDK's auto-sync will eventually catch it, but we force it here
      await new Promise((r) => setTimeout(r, 5000));
      await refresh();
      // Second refresh in case the first was too early
      await new Promise((r) => setTimeout(r, 3000));
      await refresh();

      setDepositPhase(null);
      setStep("ready");
    } catch (e: unknown) {
      setDepositPhase(null);
      const msg = e instanceof Error ? e.message : "Deposit failed";
      setDepositError(msg.length > 200 ? msg.slice(0, 200) + "..." : msg);
    }
  }

  // ── Already set up ──
  if (walletExists && step === "ready") {
    return (
      <div className="bg-bg-card border border-accent-green/30 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-accent-green animate-pulse" />
            <div>
              <div className="text-xs font-bold text-accent-green tracking-wider">
                UNLINK PRIVACY WALLET — ACTIVE
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                {activeAccount
                  ? `Shielded: ${formatWMON(shieldedBalance)} WMON`
                  : "Initializing..."}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="px-2 py-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
              title="Refresh balance"
            >
              SYNC
            </button>
            <button
              onClick={() => setShowDepositForm((v) => !v)}
              className="px-3 py-1.5 text-[10px] font-medium bg-accent-blue/15 text-accent-blue border border-accent-blue/30 rounded hover:bg-accent-blue/25 transition-all"
            >
              {showDepositForm ? "HIDE" : "SHIELD FUNDS"}
            </button>
          </div>
        </div>

        {showDepositForm && (
          <DepositForm
            depositAmount={depositAmount}
            setDepositAmount={setDepositAmount}
            handleDeposit={handleDeposit}
            depositPending={depositPending || busy || depositPhase !== null}
            depositTx={depositTx}
            depositError={depositError}
            depositPhase={depositPhase}
          />
        )}
      </div>
    );
  }

  // ── Wallet creation ──
  if (step === "create") {
    return (
      <div className="bg-bg-card border border-accent-amber/30 rounded-lg p-5">
        <h3 className="text-xs font-bold text-accent-amber tracking-wider mb-3">
          UNLINK PRIVACY WALLET — SETUP REQUIRED
        </h3>
        <p className="text-xs text-text-secondary mb-4">
          To use protected swaps, you need an Unlink shielded wallet. This creates
          a local zero-knowledge wallet that encrypts your transaction intent.
        </p>

        {!showImport ? (
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={busy}
              className="flex-1 py-2.5 text-xs font-medium bg-accent-green/15 text-accent-green border-accent-green/30 rounded hover:bg-accent-green/25 disabled:opacity-50 transition-all border"
            >
              {busy ? "CREATING..." : "CREATE NEW WALLET"}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="px-4 py-2.5 text-xs font-medium bg-bg-primary text-text-secondary border border-border-default rounded hover:border-border-active transition-all"
            >
              IMPORT EXISTING
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder="Enter your 12 or 24 word mnemonic..."
              className="w-full bg-bg-primary border border-border-default rounded px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none h-16 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={handleImport}
                disabled={busy || !importInput.trim()}
                className="flex-1 py-2 text-xs font-medium bg-accent-blue/15 text-accent-blue border border-accent-blue/30 rounded hover:bg-accent-blue/25 disabled:opacity-50 transition-all"
              >
                {busy ? "IMPORTING..." : "IMPORT WALLET"}
              </button>
              <button
                onClick={() => setShowImport(false)}
                className="px-4 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                BACK
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-accent-red">{error.message}</p>
        )}
      </div>
    );
  }

  // ── Backup mnemonic ──
  if (step === "backup") {
    return (
      <div className="bg-bg-card border border-accent-amber/30 rounded-lg p-5">
        <h3 className="text-xs font-bold text-accent-amber tracking-wider mb-3">
          BACKUP YOUR RECOVERY PHRASE
        </h3>
        <p className="text-xs text-text-secondary mb-3">
          Save this mnemonic phrase securely. You will need it to recover your
          shielded wallet.
        </p>
        <div className="bg-bg-primary border border-border-default rounded p-3 mb-4">
          <code className="text-xs text-accent-green font-mono break-all leading-relaxed">
            {mnemonic}
          </code>
        </div>
        <button
          onClick={() => setStep("deposit")}
          className="w-full py-2.5 text-xs font-medium bg-accent-green/15 text-accent-green border border-accent-green/30 rounded hover:bg-accent-green/25 transition-all"
        >
          I HAVE SAVED MY PHRASE — CONTINUE TO DEPOSIT
        </button>
      </div>
    );
  }

  // ── Deposit ──
  if (step === "deposit") {
    return (
      <div className="bg-bg-card border border-accent-blue/30 rounded-lg p-5">
        <h3 className="text-xs font-bold text-accent-blue tracking-wider mb-3">
          SHIELD YOUR FUNDS
        </h3>
        <p className="text-xs text-text-secondary mb-4">
          Deposit MON into your Unlink privacy pool. Your MON will be wrapped to
          WMON, then shielded. These funds are hidden from on-chain observers.
        </p>
        <DepositForm
          depositAmount={depositAmount}
          setDepositAmount={setDepositAmount}
          handleDeposit={handleDeposit}
          depositPending={depositPending || busy || depositPhase !== null}
          depositTx={depositTx}
          depositError={depositError}
          depositPhase={depositPhase}
        />
      </div>
    );
  }

  return null;
}

// ─── Deposit Form ─────────────────────────────────────────────────────

function DepositForm({
  depositAmount,
  setDepositAmount,
  handleDeposit,
  depositPending,
  depositTx,
  depositError,
  depositPhase,
}: {
  depositAmount: string;
  setDepositAmount: (v: string) => void;
  handleDeposit: () => void;
  depositPending: boolean;
  depositTx: string | null;
  depositError: string | null;
  depositPhase: string | null;
}) {
  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="text-[10px] text-text-muted tracking-wider mb-1 block">
          AMOUNT TO SHIELD (MON)
        </label>
        <input
          type="text"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          className="w-full bg-bg-primary border border-border-default rounded px-3 py-2 text-sm font-mono text-text-primary focus:border-accent-blue focus:outline-none"
        />
        <p className="text-[9px] text-text-muted mt-1">
          MON → WMON (wrap) → approve → deposit into pool — 3 wallet signatures
        </p>
      </div>
      <button
        onClick={handleDeposit}
        disabled={depositPending}
        className="w-full py-2.5 text-xs font-medium bg-accent-blue/15 text-accent-blue border border-accent-blue/30 rounded hover:bg-accent-blue/25 disabled:opacity-50 transition-all"
      >
        {depositPending
          ? depositPhase ?? "PROCESSING..."
          : "DEPOSIT TO PRIVACY POOL"}
      </button>
      {depositTx && (
        <p className="text-[10px] text-accent-green font-mono">
          DEPOSIT TX: {depositTx.slice(0, 16)}...{depositTx.slice(-8)}
        </p>
      )}
      {depositError && (
        <p className="text-xs text-accent-red break-all">{depositError}</p>
      )}
    </div>
  );
}

function formatWMON(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(4);
}
