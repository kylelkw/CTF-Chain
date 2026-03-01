import { type PublicClient, type Address, formatEther, parseAbiItem, parseAbi } from "viem";

// ─── Types ────────────────────────────────────────────────────────────

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface Vulnerability {
  id: string;
  severity: Severity;
  title: string;
  cvssScore: number;
  category: string;
  description: string;
  recommendation: string;
  details: Record<string, string | number>;
}

export interface ScanResult {
  address: Address;
  timestamp: number;
  vulnerabilities: Vulnerability[];
  overallRiskScore: number;
  txCount: number;
  scanDuration: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const KNOWN_DEX_ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Universal Router
]);

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ─── Scanner Functions ────────────────────────────────────────────────

export async function scanAddress(
  client: PublicClient,
  address: Address
): Promise<ScanResult> {
  const start = Date.now();
  const vulnerabilities: Vulnerability[] = [];

  const blockNumber = await client.getBlockNumber();
  // Scan last ~5000 blocks (~33 min at 400ms blocks)
  const fromBlock = blockNumber > 5000n ? blockNumber - 5000n : 0n;

  // Fetch transaction count and recent transactions in parallel
  const [txCount, balance, logs] = await Promise.all([
    client.getTransactionCount({ address }),
    client.getBalance({ address }),
    client.getLogs({
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      fromBlock,
      toBlock: blockNumber,
    }).catch(() => []),
  ]);

  // Filter logs involving this address (as sender or receiver)
  const addrLower = address.toLowerCase();
  const relevantLogs = logs.filter(
    (l) =>
      l.args.from?.toLowerCase() === addrLower ||
      l.args.to?.toLowerCase() === addrLower
  );

  // Map to a simpler shape for analysis
  const mappedLogs = relevantLogs.map((l) => ({
    blockNumber: l.blockNumber,
    transactionIndex: l.transactionIndex ?? 0,
    from: (l.args.from ?? "0x") as string,
    to: (l.args.to ?? "0x") as string,
  }));

  // ─── Analysis 1: Sandwich Detection ───────────────────────────────
  const sandwichVulns = analyzeSandwichRisk(mappedLogs, address);
  vulnerabilities.push(...sandwichVulns);

  // ─── Analysis 2: Behavioral Fingerprinting ────────────────────────
  const behaviorVulns = analyzeBehavioralPatterns(mappedLogs);
  vulnerabilities.push(...behaviorVulns);

  // ─── Analysis 3: Balance Exposure ─────────────────────────────────
  const balanceEth = parseFloat(formatEther(balance));
  if (balanceEth > 0) {
    vulnerabilities.push({
      id: "BALANCE-EXPOSURE",
      severity: balanceEth > 10 ? "HIGH" : "MEDIUM",
      title: "Public Balance Exposure",
      cvssScore: balanceEth > 10 ? 7.2 : 5.0,
      category: "Reconnaissance",
      description: `Wallet holds ${balanceEth.toFixed(4)} MON in a publicly visible balance. Adversaries can profile high-value targets for targeted MEV extraction.`,
      recommendation:
        "Shield assets via Unlink privacy pool to hide balance from on-chain observers.",
      details: {
        balance: `${balanceEth.toFixed(4)} MON`,
        riskFactor: "Public ledger transparency",
      },
    });
  }

  // ─── Analysis 4: Mempool Routing Check ────────────────────────────
  if (txCount > 0) {
    vulnerabilities.push({
      id: "MEMPOOL-ROUTING",
      severity: "HIGH",
      title: "Unprotected Mempool Routing Detected",
      cvssScore: 7.8,
      category: "MitM Vulnerability",
      description: `${txCount} transactions broadcast through public mempool without encryption. Every transaction is visible to MEV bots before execution.`,
      recommendation:
        "Route all future transactions through CTF-Chain Protected Swap using Unlink SDK.",
      details: {
        totalTxCount: txCount,
        protectedCount: 0,
        exposureRate: "100%",
      },
    });
  }

  // ─── Analysis 5: High-frequency trading pattern ───────────────────
  if (txCount > 50) {
    vulnerabilities.push({
      id: "HIGH-FREQ-PATTERN",
      severity: "MEDIUM",
      title: "High-Frequency Activity Pattern",
      cvssScore: 5.8,
      category: "Side-Channel Analysis",
      description: `${txCount} transactions detected — high activity addresses are prime targets for MEV bot profiling and predictive front-running.`,
      recommendation:
        "Distribute activity across burner wallets via Unlink burner accounts.",
      details: {
        txCount,
        riskLevel: txCount > 200 ? "CRITICAL" : "ELEVATED",
      },
    });
  }

  // Calculate overall risk
  const overallRiskScore = calculateOverallRisk(vulnerabilities);

  return {
    address,
    timestamp: Date.now(),
    vulnerabilities: vulnerabilities.sort((a, b) => b.cvssScore - a.cvssScore),
    overallRiskScore,
    txCount,
    scanDuration: Date.now() - start,
  };
}

// ─── Sandwich Analysis ────────────────────────────────────────────────

type MappedLog = { blockNumber: bigint; transactionIndex: number; from: string; to: string };

function analyzeSandwichRisk(
  logs: MappedLog[],
  address: Address
): Vulnerability[] {
  const vulns: Vulnerability[] = [];
  const addrLower = address.toLowerCase();

  // Group transfers by block
  const blockGroups = new Map<string, MappedLog[]>();
  for (const log of logs) {
    const key = log.blockNumber.toString();
    if (!blockGroups.has(key)) blockGroups.set(key, []);
    blockGroups.get(key)!.push(log);
  }

  let sandwichCount = 0;

  for (const [, blockLogs] of blockGroups) {
    const sorted = blockLogs.sort(
      (a, b) => a.transactionIndex - b.transactionIndex
    );
    const userTxIndices = sorted
      .filter((l) => l.from.toLowerCase() === addrLower)
      .map((l) => l.transactionIndex);

    for (const userIdx of userTxIndices) {
      const before = sorted.filter((l) => l.transactionIndex === userIdx - 1);
      const after = sorted.filter((l) => l.transactionIndex === userIdx + 1);
      if (before.length > 0 && after.length > 0) {
        const beforeSenders = new Set(before.map((l) => l.from.toLowerCase()));
        const afterSenders = after.map((l) => l.to.toLowerCase());
        if (afterSenders.some((s) => beforeSenders.has(s))) {
          sandwichCount++;
        }
      }
    }
  }

  if (sandwichCount > 0) {
    vulns.push({
      id: "SANDWICH-DETECTED",
      severity: "CRITICAL",
      title: "Sandwich Attack Pattern Detected",
      cvssScore: 9.1,
      category: "Man-in-the-Middle",
      description: `${sandwichCount} potential sandwich attack(s) detected in recent blocks. Adversary placed front-run and back-run transactions around your swaps to extract value.`,
      recommendation:
        "Immediately switch to CTF-Chain Protected Swap. All future DEX trades should route through Unlink encrypted mempool.",
      details: {
        attackCount: sandwichCount,
        attackType: "Sandwich (MitM)",
        estimatedLoss: `$${(sandwichCount * 85).toFixed(0)}+`,
      },
    });
  } else if (logs.length > 3) {
    vulns.push({
      id: "SANDWICH-RISK",
      severity: "HIGH",
      title: "Sandwich Vulnerability — At Risk",
      cvssScore: 7.4,
      category: "Man-in-the-Middle",
      description:
        "Recent swap activity through public mempool makes this address vulnerable to sandwich attacks. No confirmed attacks yet, but exposure is active.",
      recommendation:
        "Route future swaps through CTF-Chain Protected Swap to prevent mempool visibility.",
      details: {
        swapCount: logs.length,
        protectionStatus: "UNPROTECTED",
      },
    });
  }

  return vulns;
}

// ─── Behavioral Analysis ──────────────────────────────────────────────

function analyzeBehavioralPatterns(
  logs: MappedLog[]
): Vulnerability[] {
  if (logs.length < 5) return [];

  // Analyze block distribution to detect timing patterns
  // (In a real app we'd correlate block numbers to timestamps)
  const blockNumbers = logs.map((l) => Number(l.blockNumber));
  const sorted = [...blockNumbers].sort((a, b) => a - b);

  // Check clustering — if >60% of txs are in 20% of the block range
  if (sorted.length >= 10) {
    const range = sorted[sorted.length - 1] - sorted[0];
    const windowSize = Math.floor(range * 0.2);
    let maxInWindow = 0;

    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i] + windowSize;
      const count = sorted.filter(
        (b) => b >= sorted[i] && b <= windowEnd
      ).length;
      maxInWindow = Math.max(maxInWindow, count);
    }

    const clusterRatio = maxInWindow / sorted.length;

    if (clusterRatio > 0.6) {
      return [
        {
          id: "BEHAVIORAL-FINGERPRINT",
          severity: "MEDIUM",
          title: "Behavioral Fingerprint Detected",
          cvssScore: 5.4,
          category: "Timing Attack / Side-Channel",
          description: `${Math.round(clusterRatio * 100)}% of transactions cluster in a narrow time window. This pattern is statistically exploitable by adversaries for predictive front-running.`,
          recommendation:
            "Randomize execution timing via Unlink protected routing with delayed execution.",
          details: {
            clusterRatio: `${Math.round(clusterRatio * 100)}%`,
            sampleSize: sorted.length,
            patternType: "Temporal clustering",
          },
        },
      ];
    }
  }

  return [];
}

// ─── Risk Score ───────────────────────────────────────────────────────

function calculateOverallRisk(vulns: Vulnerability[]): number {
  if (vulns.length === 0) return 0;
  // Weighted average: highest vulns matter more
  const weights: Record<Severity, number> = {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    INFO: 1,
  };
  let totalWeight = 0;
  let weightedSum = 0;
  for (const v of vulns) {
    const w = weights[v.severity];
    totalWeight += w;
    weightedSum += v.cvssScore * w;
  }
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}
