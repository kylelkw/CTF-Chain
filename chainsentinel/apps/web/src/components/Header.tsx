"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

export function Header() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="border-b border-border-default bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
              <span className="text-purple-400 font-bold text-sm">🚩</span>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wider text-text-primary">
                CTF-CHAIN
              </h1>
              <p className="text-[10px] text-text-muted tracking-widest">
                BLOCKCHAIN SECURITY CTF
              </p>
            </div>
          </div>

          {/* Center badge */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest text-purple-400 px-3 py-1 border border-purple-500/30 rounded bg-purple-500/5">
              🚩 CAPTURE THE FLAG
            </span>
          </div>

          {/* Wallet */}
          <div>
            {isConnected ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-card rounded border border-border-default">
                  <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
                  <span className="text-xs text-text-secondary font-mono">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                </div>
                <button
                  onClick={() => disconnect()}
                  className="text-xs text-text-muted hover:text-accent-red transition-colors"
                >
                  DISCONNECT
                </button>
              </div>
            ) : (
              <button
                onClick={() => connect({ connector: injected() })}
                className="px-4 py-2 text-xs font-medium bg-accent-blue/15 text-accent-blue border border-accent-blue/30 rounded hover:bg-accent-blue/25 transition-all"
              >
                CONNECT WALLET
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
