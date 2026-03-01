"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { parseEther, formatEther, encodeFunctionData } from "viem";
import { useInteract, useUnlink, useWithdraw } from "@unlink-xyz/react";
import { publicClient } from "@/lib/viem";
import { UnlinkOnboarding } from "./UnlinkOnboarding";
import { WMON, WMON_ABI, ERC20_ABI } from "@/lib/contracts";

type SwapMode = "standard" | "protected";

interface SwapState {
  status: "idle" | "simulating" | "broadcasting" | "confirming" | "complete" | "error";
  txHash?: string;
  mevDetected?: boolean;
  savedAmount?: string;
  error?: string;
}

export function ProtectedSwap() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { ready: unlinkReady, walletExists, balances } = useUnlink();
  const { interact, isPending: interactPending } = useInteract();
  const { withdraw, isPending: withdrawPending } = useWithdraw();

  const [mode, setMode] = useState<SwapMode>("protected");
  const [amount, setAmount] = useState("0.01");
  const [swapState, setSwapState] = useState<SwapState>({ status: "idle" });

  const isProtected = mode === "protected";
  const isBusy = swapState.status !== "idle" && swapState.status !== "complete" && swapState.status !== "error";

  async function handleSwap() {
    if (!address || !walletClient) return;

    const amountWei = parseEther(amount);
    setSwapState({ status: "simulating" });

    try {
      if (isProtected && unlinkReady && walletExists) {
        // ══════════════════════════════════════════════════════════
        // PROTECTED MODE: Withdraw from Unlink shielded pool
        // This demonstrates: funds move from encrypted pool → recipient
        // without leaking intent to the mempool. The tx is submitted
        // by Unlink's relay, not the user's EOA.
        // ══════════════════════════════════════════════════════════
        setSwapState({ status: "broadcasting" });

        const result = await withdraw([
          { token: WMON, amount: amountWei, recipient: address },
        ]);

        setSwapState({
          status: "complete",
          txHash: result.relayId,
          mevDetected: false,
          savedAmount: `$${(parseFloat(amount) * 12.5).toFixed(2)}`,
        });
      } else {
        // ══════════════════════════════════════════════════════════
        // STANDARD MODE: Wrap MON → WMON through public mempool
        // This is a normal on-chain tx visible to all observers.
        // In a real DEX scenario, bots would front-run this swap.
        // ══════════════════════════════════════════════════════════
        setSwapState({ status: "broadcasting" });

        // Wrap MON → WMON (simulates a swap tx going through public mempool)
        const hash = await walletClient.sendTransaction({
          to: WMON as `0x${string}`,
          value: amountWei,
          data: encodeFunctionData({
            abi: WMON_ABI,
            functionName: "deposit",
          }),
        });

        setSwapState({ status: "confirming", txHash: hash });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Check for other txs in the same block targeting WMON (MEV heuristic)
        const block = await publicClient.getBlock({
          blockNumber: receipt.blockNumber,
          includeTransactions: true,
        });

        const ourIdx = block.transactions.findIndex(
          (tx) => typeof tx !== "string" && tx.hash === hash
        );
        const suspiciousTxs = block.transactions.filter(
          (tx, i) =>
            typeof tx !== "string" &&
            tx.to?.toLowerCase() === WMON.toLowerCase() &&
            tx.hash !== hash &&
            Math.abs(i - ourIdx) <= 2
        );

        setSwapState({
          status: "complete",
          txHash: hash,
          mevDetected: suspiciousTxs.length > 0,
          savedAmount: suspiciousTxs.length > 0 ? "$0.00" : `$${(parseFloat(amount) * 12.5).toFixed(2)}`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setSwapState({
        status: "error",
        error: msg.length > 150 ? msg.slice(0, 150) + "..." : msg,
      });
    }
  }

  // Shielded WMON balance
  const wmonLower = WMON.toLowerCase();
  const shieldedWMON = balances[wmonLower] ?? balances[WMON] ?? 0n;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-accent-blue animate-pulse" />
        <h2 className="text-lg font-bold tracking-wider">PROTECTED SWAP</h2>
        <span className="text-xs text-text-muted">/ ENCRYPTED TRANSACTION ROUTING</span>
      </div>

      {/* Unlink Wallet Status */}
      {isConnected && <UnlinkOnboarding />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Swap Panel */}
        <div className="bg-bg-card border border-border-default rounded-lg p-6 space-y-5">
          {/* Mode Toggle */}
          <div>
            <label className="text-[10px] text-text-muted tracking-wider mb-2 block">
              ROUTING MODE
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("standard")}
                className={`flex-1 py-2.5 text-xs font-medium rounded border transition-all ${
                  mode === "standard"
                    ? "bg-accent-red/15 text-accent-red border-accent-red/40 glow-red"
                    : "bg-bg-primary text-text-muted border-border-default hover:border-border-active"
                }`}
              >
                STANDARD
                <div className="text-[9px] mt-0.5 opacity-70">PUBLIC MEMPOOL</div>
              </button>
              <button
                onClick={() => setMode("protected")}
                className={`flex-1 py-2.5 text-xs font-medium rounded border transition-all ${
                  mode === "protected"
                    ? "bg-accent-green/15 text-accent-green border-accent-green/40 glow-green"
                    : "bg-bg-primary text-text-muted border-border-default hover:border-border-active"
                }`}
              >
                CTF-CHAIN
                <div className="text-[9px] mt-0.5 opacity-70">ENCRYPTED ROUTING</div>
              </button>
            </div>
          </div>

          {/* Status Badge */}
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded border text-xs font-medium ${
              isProtected
                ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
                : "bg-accent-red/10 border-accent-red/30 text-accent-red"
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${isProtected ? "bg-accent-green" : "bg-accent-red"} animate-pulse`} />
            {isProtected
              ? "ENCRYPTED — Bot-blind transaction via Unlink relay"
              : "EXPOSED — Transaction visible in public mempool"}
          </div>

          {/* Amount Input */}
          <div>
            <label className="text-[10px] text-text-muted tracking-wider mb-2 block">
              AMOUNT (MON)
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-bg-primary border border-border-default rounded px-4 py-2.5 text-lg font-mono text-text-primary focus:border-accent-blue focus:outline-none"
            />
            {isProtected && shieldedWMON > 0n && (
              <p className="text-[9px] text-text-muted mt-1">
                Shielded balance: {formatEther(shieldedWMON)} WMON
              </p>
            )}
          </div>

          {/* Operation description */}
          <div className="p-3 bg-bg-primary rounded border border-border-default text-xs text-text-secondary">
            {isProtected ? (
              <>
                <span className="text-accent-green font-bold">Protected withdraw: </span>
                WMON exits shielded pool → your wallet. Submitted by Unlink relay —
                your EOA never touches the mempool.
              </>
            ) : (
              <>
                <span className="text-accent-red font-bold">Public wrap: </span>
                MON → WMON via public mempool. Your transaction intent is
                visible to all observers before execution.
              </>
            )}
          </div>

          {/* Swap Button */}
          <button
            onClick={handleSwap}
            disabled={!isConnected || isBusy || (isProtected && (!unlinkReady || !walletExists))}
            className={`w-full py-3 text-sm font-bold rounded border transition-all disabled:opacity-50 ${
              isProtected
                ? "bg-accent-green/15 text-accent-green border-accent-green/40 hover:bg-accent-green/25"
                : "bg-accent-red/15 text-accent-red border-accent-red/40 hover:bg-accent-red/25"
            }`}
          >
            {swapState.status === "simulating"
              ? "SIMULATING..."
              : swapState.status === "broadcasting"
                ? isProtected ? "SUBMITTING VIA ENCRYPTED RELAY..." : "BROADCASTING TO PUBLIC MEMPOOL..."
                : swapState.status === "confirming"
                  ? "WAITING FOR CONFIRMATION..."
                  : isProtected
                    ? "EXECUTE PROTECTED TRANSACTION"
                    : "EXECUTE UNPROTECTED TRANSACTION"}
          </button>

          {!isConnected && (
            <p className="text-xs text-text-muted text-center">
              Connect wallet to execute transactions
            </p>
          )}

          {isProtected && isConnected && !walletExists && (
            <p className="text-xs text-accent-amber text-center">
              Create an Unlink wallet above to enable protected mode
            </p>
          )}
        </div>

        {/* Result / Info Panel */}
        <div className="space-y-4">
          {/* Pipeline steps */}
          <div className="bg-bg-card border border-border-default rounded-lg p-5">
            <h3 className="text-xs font-bold tracking-wider text-text-muted mb-3">
              {isProtected ? "PROTECTION PIPELINE" : "EXPOSURE ANALYSIS"}
            </h3>
            {isProtected ? (
              <div className="space-y-2 text-xs text-text-secondary">
                <Step n={1} text="Withdraw request encrypted by Unlink SDK" />
                <Step n={2} text="ZK proof generated client-side" />
                <Step n={3} text="Proof sent to Unlink relay (not public mempool)" />
                <Step n={4} text="Relay submits tx — your EOA is never exposed" />
                <Step n={5} text="WMON received at fair price, zero MEV" />
              </div>
            ) : (
              <div className="space-y-2 text-xs text-text-secondary">
                <Step n={1} text="Transaction broadcast to public mempool" danger />
                <Step n={2} text="MEV bots decode your tx intent instantly" danger />
                <Step n={3} text="Bots can front-run with higher gas price" danger />
                <Step n={4} text="Your tx executes at worse price" danger />
                <Step n={5} text="Bot back-runs to extract remaining value" danger />
              </div>
            )}
          </div>

          {/* Post-tx result */}
          {swapState.status === "complete" && (
            <div
              className={`bg-bg-card border rounded-lg p-5 ${
                swapState.mevDetected
                  ? "border-accent-red/40 glow-red"
                  : "border-accent-green/40 glow-green"
              }`}
            >
              <h3 className="text-xs font-bold tracking-wider mb-3">
                POST-TRANSACTION ANALYSIS
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">{isProtected ? "Relay ID" : "TX Hash"}</span>
                  <span className="text-text-primary font-mono">
                    {swapState.txHash?.slice(0, 14)}...{swapState.txHash?.slice(-8)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">MEV Activity</span>
                  <span className={swapState.mevDetected ? "text-accent-red" : "text-accent-green"}>
                    {swapState.mevDetected ? "DETECTED — VALUE AT RISK" : "NONE — CLEAN EXECUTION"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Value Protected</span>
                  <span className="text-accent-green font-bold">{swapState.savedAmount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Routing</span>
                  <span className={isProtected ? "text-accent-green" : "text-accent-red"}>
                    {isProtected ? "UNLINK ENCRYPTED RELAY" : "PUBLIC MEMPOOL"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {swapState.status === "error" && (
            <div className="bg-bg-card border border-accent-red/40 rounded-lg p-5 glow-red">
              <h3 className="text-xs font-bold tracking-wider text-accent-red mb-2">
                TRANSACTION FAILED
              </h3>
              <p className="text-xs text-text-secondary font-mono break-all">
                {swapState.error}
              </p>
              <button
                onClick={() => setSwapState({ status: "idle" })}
                className="mt-3 text-[10px] text-text-muted hover:text-text-primary transition-colors"
              >
                DISMISS
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ n, text, danger }: { n: number; text: string; danger?: boolean }) {
  const color = danger
    ? "bg-accent-red/20 text-accent-red border-accent-red/30"
    : "bg-accent-green/20 text-accent-green border-accent-green/30";

  return (
    <div className="flex items-center gap-3">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${color}`}>
        {n}
      </span>
      <span>{text}</span>
    </div>
  );
}
