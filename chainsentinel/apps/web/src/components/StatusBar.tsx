"use client";

import { useBlockNumber } from "wagmi";
import { useEffect, useState } from "react";

export function StatusBar() {
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => setTime(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="fixed bottom-0 left-0 right-0 h-7 bg-bg-secondary/90 border-t border-border-default flex items-center px-4 text-[10px] text-text-muted font-mono z-50 gap-6">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
        MONAD TESTNET
      </span>
      <span>CHAIN: 10143</span>
      {blockNumber && <span>BLOCK: {blockNumber.toString()}</span>}
      <span className="ml-auto">{time}</span>
      <span>CTF-CHAIN v2.0</span>
    </footer>
  );
}
