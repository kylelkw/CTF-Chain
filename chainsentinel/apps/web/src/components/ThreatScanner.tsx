"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { isAddress, type Address } from "viem";
import { publicClient } from "@/lib/viem";
import {
  scanAddress,
  type ScanResult,
  type Severity,
  type Vulnerability,
} from "@/lib/scanner";

const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: "text-severity-critical border-severity-critical/40 bg-severity-critical/10",
  HIGH: "text-severity-high border-severity-high/40 bg-severity-high/10",
  MEDIUM: "text-severity-medium border-severity-medium/40 bg-severity-medium/10",
  LOW: "text-severity-low border-severity-low/40 bg-severity-low/10",
  INFO: "text-severity-info border-severity-info/40 bg-severity-info/10",
};

const SEVERITY_GLOW: Record<Severity, string> = {
  CRITICAL: "glow-red",
  HIGH: "glow-amber",
  MEDIUM: "",
  LOW: "",
  INFO: "",
};

export function ThreatScanner() {
  const { address: connectedAddress } = useAccount();
  const [inputAddress, setInputAddress] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetAddress = inputAddress || connectedAddress;

  async function handleScan() {
    if (!targetAddress || !isAddress(targetAddress)) {
      setError("Invalid address. Paste a valid Monad address or connect your wallet.");
      return;
    }
    setError(null);
    setScanning(true);
    setScanProgress(0);
    setResult(null);

    // Simulate progress ticks
    const interval = setInterval(() => {
      setScanProgress((p) => Math.min(p + Math.random() * 15, 90));
    }, 300);

    try {
      const res = await scanAddress(publicClient, targetAddress as Address);
      setScanProgress(100);
      setResult(res);
    } catch (e: unknown) {
      setError(`Scan failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      clearInterval(interval);
      setScanning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Scanner Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-3 h-3 rounded-full bg-accent-red animate-pulse" />
        <h2 className="text-lg font-bold tracking-wider">THREAT SCANNER</h2>
        <span className="text-xs text-text-muted">/ VULNERABILITY ASSESSMENT</span>
      </div>

      {/* Input */}
      <div className="bg-bg-card border border-border-default rounded-lg p-4">
        <label className="text-xs text-text-muted mb-2 block tracking-wide">
          TARGET ADDRESS
        </label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
              &gt;
            </span>
            <input
              type="text"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder={connectedAddress || "0x... paste address or connect wallet"}
              className="w-full bg-bg-primary border border-border-default rounded px-8 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none transition-colors"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 cursor-blink text-accent-blue">
              _
            </span>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-6 py-2.5 bg-accent-red/15 text-accent-red border border-accent-red/30 rounded text-sm font-medium tracking-wide hover:bg-accent-red/25 disabled:opacity-50 transition-all whitespace-nowrap"
          >
            {scanning ? "SCANNING..." : "RUN SCAN"}
          </button>
        </div>

        {/* Progress bar */}
        {scanning && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-text-muted mb-1">
              <span>SCANNING BLOCKCHAIN STATE...</span>
              <span>{Math.round(scanProgress)}%</span>
            </div>
            <div className="h-1 bg-bg-primary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-red transition-all duration-300 rounded-full"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-accent-red">{error}</p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary Banner */}
          <div className="bg-bg-card border border-border-default rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted mb-1">SCAN COMPLETE</div>
              <div className="font-mono text-sm text-text-secondary">
                {result.address.slice(0, 10)}...{result.address.slice(-8)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-text-muted mb-1">VULNERABILITIES</div>
              <div className="text-2xl font-bold text-accent-red">
                {result.vulnerabilities.length}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-text-muted mb-1">RISK SCORE</div>
              <div
                className={`text-2xl font-bold ${
                  result.overallRiskScore >= 8
                    ? "text-severity-critical"
                    : result.overallRiskScore >= 6
                      ? "text-severity-high"
                      : result.overallRiskScore >= 4
                        ? "text-severity-medium"
                        : "text-severity-low"
                }`}
              >
                {result.overallRiskScore}/10
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-text-muted mb-1">TX ANALYZED</div>
              <div className="text-2xl font-bold text-text-primary">
                {result.txCount}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-text-muted mb-1">SCAN TIME</div>
              <div className="text-sm font-mono text-text-secondary">
                {result.scanDuration}ms
              </div>
            </div>
          </div>

          {/* Vulnerability Cards */}
          <div className="space-y-3">
            {result.vulnerabilities.map((vuln) => (
              <VulnerabilityCard key={vuln.id} vuln={vuln} />
            ))}
          </div>

          {result.vulnerabilities.length === 0 && (
            <div className="bg-bg-card border border-severity-low/30 rounded-lg p-6 text-center">
              <div className="text-severity-low text-lg font-bold mb-1">ALL CLEAR</div>
              <p className="text-sm text-text-secondary">
                No vulnerabilities detected in recent on-chain activity.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VulnerabilityCard({ vuln }: { vuln: Vulnerability }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`bg-bg-card border rounded-lg overflow-hidden transition-all cursor-pointer ${
        SEVERITY_COLORS[vuln.severity]
      } ${SEVERITY_GLOW[vuln.severity]}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-0.5 text-[10px] font-bold tracking-wider rounded border ${
                SEVERITY_COLORS[vuln.severity]
              }`}
            >
              {vuln.severity}
            </span>
            <h3 className="text-sm font-semibold text-text-primary">
              {vuln.title}
            </h3>
          </div>
          <div className="text-right ml-4">
            <div className="text-xs text-text-muted">CVSS</div>
            <div
              className={`text-lg font-bold ${
                vuln.cvssScore >= 9
                  ? "text-severity-critical"
                  : vuln.cvssScore >= 7
                    ? "text-severity-high"
                    : vuln.cvssScore >= 4
                      ? "text-severity-medium"
                      : "text-severity-low"
              }`}
            >
              {vuln.cvssScore}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-4 text-[10px] text-text-muted tracking-wide">
          <span>CAT: {vuln.category}</span>
          <span>ID: {vuln.id}</span>
        </div>

        <p className="mt-2 text-xs text-text-secondary leading-relaxed">
          {vuln.description}
        </p>
      </div>

      {expanded && (
        <div className="border-t border-border-default p-4 bg-bg-primary/50">
          <div className="mb-3">
            <div className="text-[10px] text-accent-green tracking-wider mb-1">
              RECOMMENDATION
            </div>
            <p className="text-xs text-text-primary">{vuln.recommendation}</p>
          </div>
          <div>
            <div className="text-[10px] text-text-muted tracking-wider mb-1">
              DETAILS
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(vuln.details).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="text-text-muted">{key}: </span>
                  <span className="text-text-primary font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
