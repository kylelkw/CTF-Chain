"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { parseEther, formatEther, type Hash } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useBalance } from "wagmi";
import { DevToolsWindow } from "./DevToolsWindow";

// ─── Types ────────────────────────────────────────────────────────────

type Phase = "idle" | "wallet" | "confirming" | "analyzing" | "complete" | "error";
type TestResult = "PASS" | "FAIL" | "PARTIAL" | "N/A";
type AnomalySeverity = "INFO" | "WARNING" | "CRITICAL";
type LogLevel = "info" | "warn" | "error" | "success" | "debug" | "flag";

interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
}

interface CTFFlag {
  id: string;
  challenge: string;
  category: string;
  difficulty: "EASY" | "MEDIUM" | "HARD" | "INSANE";
  points: number;
  hint: string;
  captured: boolean;
  flagValue: string;
  probeId: string;
  evidence: string;
}

interface SecurityTest {
  id: string;
  category: "extraction" | "timing" | "identity" | "mev" | "encryption";
  name: string;
  description: string;
  attackVector: string;
  probeInput: string;
  expectedOutput: string;
  unprotectedResult: TestResult;
  unprotectedDetail: string;
  layer1Result: TestResult;
  layer1Detail: string;
  layer2Result: TestResult;
  layer2Detail: string;
  protectedResult: TestResult;
  protectedDetail: string;
  actualOutput: {
    unprotected: string;
    layer1: string;
    layer2: string;
    protected: string;
  };
  dataExtracted: string[];
  dataProtected: string[];
  monetaryRisk: string;
  hop: number;
}

interface EncryptionLayer {
  id: string;
  name: string;
  protocol: string;
  keyExchange: string;
  cipher: string;
  protects: string[];
  limitations: string[];
  appliesAtHops: number[];
  status: "active" | "partial" | "none";
  honestAssessment: string;
}

interface PacketHop {
  id: string;
  phase: string;
  direction: string;
  protocol: string;
  from: string;
  to: string;
  elapsed: number;
  exposed: string[];
  leaked: string[];
  description: string;
  rawPayload: string;
  rawHex: string;
  decodedFields: Record<string, string>;
  entropyScore: number;
  flags: string[];
}

interface BlockNeighbor {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  index: number;
  distance: number;
  isSuspicious: boolean;
  anomaly: string | null;
}

interface Anomaly {
  id: string;
  severity: AnomalySeverity;
  description: string;
  evidence: string;
}

interface AnalysisResponse {
  txHash: string;
  sender: string;
  recipient: string;
  value: string;
  gasPrice: string;
  effectiveGasPrice: string;
  blockNumber: number;
  blockTimestamp: number;
  positionInBlock: number;
  totalBlockTxs: number;
  rawTxFields: Record<string, string>;
  packets: PacketHop[];
  neighbors: BlockNeighbor[];
  suspiciousCount: number;
  securityTests: SecurityTest[];
  encryptionLayers: EncryptionLayer[];
  anomalies: Anomaly[];
  entropyReport: { averageUnprotected: number; averageProtected: number; verdict: string };
  testSummary: {
    total: number;
    unprotected: { fail: number; partial: number; pass: number };
    layer1: { fail: number; partial: number; pass: number };
    layer2: { fail: number; partial: number; pass: number };
    protected: { fail: number; partial: number; pass: number };
  };
  timing: { totalMs: number; signMs: number; broadcastMs: number; confirmMs: number; analysisMs: number };
}

interface AnalysisState {
  phase: Phase;
  data: AnalysisResponse | null;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const RESULT_STYLES: Record<TestResult, { bg: string; text: string; label: string }> = {
  PASS: { bg: "bg-green-500/15 border-green-500/40", text: "text-green-400", label: "✓ SECURE" },
  FAIL: { bg: "bg-red-500/15 border-red-500/40", text: "text-red-400", label: "✗ EXPOSED" },
  PARTIAL: { bg: "bg-yellow-500/15 border-yellow-500/40", text: "text-yellow-400", label: "◐ PARTIAL" },
  "N/A": { bg: "bg-gray-500/15 border-gray-500/40", text: "text-gray-400", label: "— N/A" },
};

const SEV_STYLES: Record<AnomalySeverity, { bg: string; text: string }> = {
  CRITICAL: { bg: "bg-red-500/15 border-red-500/40", text: "text-red-400" },
  WARNING: { bg: "bg-yellow-500/15 border-yellow-500/40", text: "text-yellow-400" },
  INFO: { bg: "bg-blue-500/15 border-blue-500/40", text: "text-blue-400" },
};

const CATEGORY_LABELS: Record<string, { icon: string; label: string }> = {
  extraction: { icon: "🔓", label: "DATA EXTRACTION" },
  timing: { icon: "⏱", label: "TIMING ANALYSIS" },
  identity: { icon: "🪪", label: "IDENTITY EXPOSURE" },
  mev: { icon: "💰", label: "MEV FEASIBILITY" },
  encryption: { icon: "🔐", label: "ENCRYPTION AUDIT" },
};

const shortH = (v: string) => `${v.slice(0, 10)}…${v.slice(-6)}`;
const shortA = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;
const entropyBar = (score: number) => {
  const pct = Math.round(score * 100);
  const color = score > 0.8 ? "bg-green-500" : score > 0.5 ? "bg-yellow-500" : "bg-red-500";
  return { pct, color };
};

const LOG_STYLES: Record<LogLevel, { prefix: string; color: string }> = {
  info: { prefix: "[INFO]", color: "text-blue-400" },
  warn: { prefix: "[WARN]", color: "text-yellow-400" },
  error: { prefix: "[ERR!]", color: "text-red-400" },
  success: { prefix: "[ OK ]", color: "text-green-400" },
  debug: { prefix: "[DBG ]", color: "text-gray-500" },
  flag: { prefix: "[FLAG]", color: "text-purple-400" },
};

const DIFF_LABELS: Record<string, { color: string; points: string }> = {
  EASY: { color: "text-green-400 border-green-500/40 bg-green-500/10", points: "100" },
  MEDIUM: { color: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10", points: "250" },
  HARD: { color: "text-orange-400 border-orange-500/40 bg-orange-500/10", points: "500" },
  INSANE: { color: "text-red-400 border-red-500/40 bg-red-500/10", points: "1000" },
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// ─── CTF Challenge Pool (rotates by day of week) ─────────────────────
// Difficulty = Encryption Layer:
//   EASY (100pts)   = Layer 0: No encryption — cleartext tx in mempool
//   MEDIUM (250pts) = Layer 1: TLS 1.3 transport — must break/analyze TLS metadata
//   HARD (500pts)   = Layer 2: TLS + Unlink relay — tx routed through privacy relay
//   INSANE (1000pts)= Layer 3: TLS + Unlink + AES-256-GCM envelope — full CTF-Chain protection
interface CTFChallenge {
  id: string;
  challenge: string;
  category: string;
  difficulty: "EASY" | "MEDIUM" | "HARD" | "INSANE";
  encryptionLayer: 0 | 1 | 2 | 3;
  points: number;
  hint: string;
}

const CTF_POOL: Record<number, CTFChallenge[]> = {
  0: [ // Sunday — Packet Dissection
    { id: "SUN-E", challenge: "In Packets tab Hop 1, the RLP-decoded fields show the sender address in cleartext. Extract the first 6 hex characters after 0x.", category: "extraction", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "Packets → Hop 1 → Decoded Fields shows the full sender/from address. Take the 6 chars right after '0x'. Flag format: CTF{rlp_SENDER6_to}" },
    { id: "SUN-M", challenge: "TLS wraps Hop 2 but doesn't hide block-level metadata. Find the block number this transaction was included in (decimal).", category: "encryption", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "Block number is in the Forensics tab header, capture summary stats, and Packets Hop 5. Flag format: CTF{entropy_low_BLOCKNUMBER_tls}" },
    { id: "SUN-H", challenge: "Analyze the Unlink relay path: extract gas price (gwei, integer) and nonce (decimal) from the Forensics raw tx fields.", category: "timing", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "gasPrice in raw fields is hex wei — parseInt(hex,16) ÷ 10^9, round to integer. nonce is hex — parseInt(hex,16). Flag format: CTF{unlink_timing_GASGWEI_NONCE}" },
    { id: "SUN-I", challenge: "Derive the AES-256-GCM initialization vector: compute keccak256(sender_address ++ block_number) as string concatenation, take first 6 hex chars after 0x.", category: "encryption", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "Concatenate full lowercase sender (with 0x) + block number as decimal string. keccak256 hash → take hex chars at positions 2-7. Flag format: CTF{aes_iv_HEX6CHARS}" },
  ],
  1: [ // Monday — MEV Attack Surface
    { id: "MON-E", challenge: "Convert the gasPrice from Forensics raw tx fields (hex wei) to gwei. Round to the nearest integer.", category: "mev", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "Raw TX Fields → gasPrice is in hex. parseInt('0x...', 16) gives wei. Divide by 10^9 for gwei, round to integer. Flag format: CTF{gasprice_GWEI_gwei}" },
    { id: "MON-M", challenge: "Assess front-run profitability: extract the transaction value (in MON as displayed) and gas price (gwei integer) from Forensics.", category: "mev", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "Value is shown in capture summary (e.g. '0.01'). Gas from gasPrice hex→gwei integer. Flag format: CTF{frontrun_VALUE_GAS_profit}" },
    { id: "MON-H", challenge: "Post-inclusion sandwich analysis: extract block number and nonce (both decimal) from Forensics to identify your transaction position.", category: "mev", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "Block from Forensics header. Nonce from raw fields hex→decimal. Flag format: CTF{sandwich_BLOCK_NONCE_pos}" },
    { id: "MON-I", challenge: "Break the CTF-Chain envelope cipher: XOR your transaction nonce (decimal) with Monad chain ID (10143). Report the result in decimal.", category: "mev", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "Nonce from raw fields hex→decimal. XOR: nonce ^ 10143. In Python: nonce ^ 10143. Flag format: CTF{envelope_XORRESULT_break}" },
  ],
  2: [ // Tuesday — Identity Forensics
    { id: "TUE-E", challenge: "Extract the transaction nonce from Forensics raw tx fields. Convert from hex to decimal.", category: "identity", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "Raw TX Fields → nonce is in hex (e.g. 0x77). parseInt(hex, 16) = decimal. This equals total prior txs from this wallet. Flag format: CTF{nonce_DECIMAL_history}" },
    { id: "TUE-M", challenge: "The RPC provider logged your full txHash. Extract the first 8 hex characters after the 0x prefix from the transaction hash.", category: "identity", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "txHash is visible in the console log, verdict bar at bottom, and Forensics. Take the 8 chars right after '0x'. Flag format: CTF{rpc_eth_HASH8_logged}" },
    { id: "TUE-H", challenge: "Read the ECDSA signature v value from Forensics raw tx fields (hex→decimal). Also extract sender address first 6 hex chars after 0x.", category: "identity", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "v field in Raw TX Fields is hex. parseInt(hex,16)→decimal. EIP-155: v = chainId×2+35+{0,1}. Sender from your connected wallet. Flag format: CTF{ecdsa_VDECIMAL_SENDER6_recover}" },
    { id: "TUE-I", challenge: "Compute a de-anonymization fingerprint: keccak256(sender_address ++ block_number) as string concatenation, first 6 hex chars after 0x.", category: "identity", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "Same derivation as AES IV. Concatenate sender (lowercase, with 0x) + block (decimal string). keccak256 → hex chars [2:8]. Flag format: CTF{deanon_HEX6_fingerprint}" },
  ],
  3: [ // Wednesday — Encryption Analysis
    { id: "WED-E", challenge: "On Layer 0 with no encryption, 3 intermediary classes see full cleartext: RPC provider, mempool peers, and block builder. Include your block number.", category: "encryption", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "The answer is always 3 intermediaries. Get your block number from Forensics header or capture summary. Flag format: CTF{cleartext_BLOCK_3intermediaries}" },
    { id: "WED-M", challenge: "TLS 1.3 wraps the RPC payload at Hop 2. Prove your analysis by extracting block number and gas price (gwei integer) from Forensics.", category: "encryption", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "Block from Forensics header. gasPrice from raw fields: hex→decimal÷10^9, round to integer. Flag format: CTF{tls13_BLOCK_GAS_cipher}" },
    { id: "WED-H", challenge: "Compare entropy scores between Layer 0 and Layer 2 in the Packets tab. Include your nonce (decimal) and block number as proof.", category: "encryption", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "Switch between L0 and L2 using Packets encryption selector to see entropy changes per hop. Nonce hex→decimal. Flag format: CTF{unlink_entropy_NONCE_BLOCK}" },
    { id: "WED-I", challenge: "Compute the GCM authentication tag checksum: (gas_price_gwei × nonce_decimal) mod 65536. Both values from Forensics raw fields.", category: "encryption", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "gas = gasPrice hex→decimal÷10^9 (integer). nonce = hex→decimal. Multiply them, mod 65536. Flag format: CTF{gcm_tag_RESULT}" },
  ],
  4: [ // Thursday — Timing & Side-Channel
    { id: "THU-E", challenge: "Read the block number and transaction nonce (both in decimal) from the Forensics tab.", category: "timing", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "Block number from Forensics header. Nonce from Raw TX Fields in hex — parseInt(hex,16). Flag format: CTF{blockpos_BLOCK_NONCE}" },
    { id: "THU-M", challenge: "TLS timing metadata: extract gas price (gwei integer) and block number from Forensics as transaction correlation proof.", category: "timing", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "gasPrice from raw fields hex→decimal÷10^9, integer. Block from header. Flag format: CTF{rtt_GAS_BLOCK_timing}" },
    { id: "THU-H", challenge: "Unlink relay adds latency jitter. Extract block number and nonce (decimal) from Forensics to prove relay path analysis.", category: "timing", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "Block from Forensics header. Nonce from raw fields hex→decimal. Flag format: CTF{jitter_BLOCK_NONCE_relay}" },
    { id: "THU-I", challenge: "AES-GCM side-channel: the rlpHex field in Forensics raw tx fields reveals payload length. Compute ceil(hex_char_count / 2 / 16) × 16 for AES block alignment.", category: "encryption", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "rlpHex in Raw TX Fields has hex chars. Count chars (excluding 0x prefix), divide by 2 for bytes, ceil(bytes/16)*16. Flag format: CTF{sidechan_ALIGNED_blocks}" },
  ],
  5: [ // Friday — Combined Attack Chain
    { id: "FRI-E", challenge: "Layer 0 exposes transaction data at multiple hops. Extract block number and gas price (gwei integer) from Forensics.", category: "extraction", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "Block from Forensics header. gasPrice from raw fields hex→gwei integer. Flag format: CTF{highrisk_BLOCK_GAS}" },
    { id: "FRI-M", challenge: "Construct an attack chain: extract sender first 6 hex chars (after 0x) from Packets Hop 1 decoded fields + gas price (gwei integer) from Forensics.", category: "mev", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "Packets → Hop 1 decoded fields show sender. gasPrice from Forensics raw fields hex→gwei. Flag format: CTF{chain_SENDER6_GAS_attack}" },
    { id: "FRI-H", challenge: "With Unlink active, 2 of 3 intermediaries are blinded. Include block number and sender first 6 hex chars (after 0x) as proof.", category: "encryption", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "Block from Forensics header. Sender first 6 after 0x from Packets Hop 1 or your wallet. Flag format: CTF{blind_BLOCK_SENDER6_relay}" },
    { id: "FRI-I", challenge: "Full envelope audit: compute (block_number XOR nonce_decimal) × gas_price_gwei mod 999983 (largest 6-digit prime). All values from Forensics.", category: "encryption", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "block and nonce (hex→decimal) from Forensics. gas from gasPrice hex→gwei. Compute: (block ^ nonce) * gas % 999983. Flag format: CTF{hmac_RESULT_verify}" },
  ],
  6: [ // Saturday — Block Neighbor Analysis
    { id: "SAT-E", challenge: "Examine the Forensics Block Neighbors section. Include your block number and nonce (decimal) as proof of analysis.", category: "extraction", difficulty: "EASY", encryptionLayer: 0, points: 100, hint: "Block from Forensics header. Nonce from raw fields hex→decimal. Flag format: CTF{anomaly_BLOCK_NONCE_count}" },
    { id: "SAT-M", challenge: "Compare block neighbor gas prices with yours. Extract your gas price (gwei integer) and block number from Forensics.", category: "mev", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, hint: "gasPrice from raw fields hex→gwei integer. Block from header. Flag format: CTF{gasratio_GAS_BLOCK_neighbor}" },
    { id: "SAT-H", challenge: "Check Forensics block neighbors for anomaly flags (⚠ SANDWICH_PATTERN, FRONTRUN_INDICATOR). Include block number and gas price as proof.", category: "mev", difficulty: "HARD", encryptionLayer: 2, points: 500, hint: "Neighbors marked with ⚠ have anomaly tags. Block and gas (hex→gwei integer) from Forensics. Flag format: CTF{sandwich_BLOCK_GAS_detect}" },
    { id: "SAT-I", challenge: "Security audit: analyze Packets tab entropy data across encryption layers. Include block number and nonce (decimal) as verification.", category: "encryption", difficulty: "INSANE", encryptionLayer: 3, points: 1000, hint: "Use Packets encryption layer selector (L0-L3) to compare entropy per hop. Block and nonce from Forensics. Flag format: CTF{score_BLOCK_NONCE_audit}" },
  ],
};

// ─── Main Component ──────────────────────────────────────────────────

const ENTRY_FEE = "0.01"; // Fixed entry fee per round
const POOL_FALLBACK_ADDRESS = ""; // must be fetched from API (derived from bot key)

export function AttackSimulator() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<AnalysisState>({ phase: "idle", data: null });
  const [running, setRunning] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("ctf");
  const [pendingHash, setPendingHash] = useState<Hash | undefined>();
  const [selectedPacket, setSelectedPacket] = useState<number>(0);
  const [hexFilter, setHexFilter] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ctfFlags, setCtfFlags] = useState<CTFFlag[]>([]);
  const [ctfInput, setCtfInput] = useState("");
  const [ctfMessage, setCtfMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [poolBalance, setPoolBalance] = useState<string>("…");
  const [poolAddress, setPoolAddress] = useState<string>(POOL_FALLBACK_ADDRESS);
  const [claiming, setClaiming] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(false);
  const [totalWinnings, setTotalWinnings] = useState(0);
  const [devOpen, setDevOpen] = useState(false);
  const [devDay, setDevDay] = useState(new Date().getDay());
  const [playedToday, setPlayedToday] = useState(false);
  const [dailyPlayersList, setDailyPlayersList] = useState<string[]>([]);
  const [viewLayer, setViewLayer] = useState<number>(0);
  const [devAnswers, setDevAnswers] = useState<{ id: string; difficulty: string; points: number; flag: string }[]>([]);
  const logIdRef = useRef(0);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: pendingHash });
  const { data: playerBalData, refetch: refetchPlayerBal } = useBalance({ address });

  useEffect(() => {
    setMounted(true);
    pushLog("info", "SYSTEM", "CTF-Chain v2.0 — Blockchain Security Challenge");
    pushLog("info", "SYSTEM", `Today's challenge set: ${DAYS[new Date().getDay()]} (${CTF_POOL[new Date().getDay()].length} challenges)`);
    pushLog("debug", "NET", "Target: Monad Testnet (chain 10143) · RPC: testnet-rpc.monad.xyz");
    // Fetch pool balance & address
    fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pool-balance" }) })
      .then((r) => r.json())
      .then((d) => {
        if (d.balance) {
          setPoolBalance(d.balance);
          setPoolAddress(d.address);
          pushLog("info", "POOL", `Pool loaded (balance: ${Number(d.balance).toFixed(4)} MON)`);
        }
        else { pushLog("warn", "POOL", "Using fallback pool address — bot key may not match!"); }
      })
      .catch(() => { pushLog("warn", "POOL", "Pool API unreachable — using fallback address"); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if player already played today
  useEffect(() => {
    if (!address) return;
    fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check-played", playerAddress: address }) })
      .then((r) => r.json())
      .then((d) => { if (d.played) { setPlayedToday(true); pushLog("warn", "CTF", "You already played today! Come back tomorrow for new challenges."); } else { setPlayedToday(false); } })
      .catch(() => {});
    // Also fetch daily players for dev tools
    fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "daily-players" }) })
      .then((r) => r.json())
      .then((d) => { if (d.players) setDailyPlayersList(d.players); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const pushLog = useCallback((level: LogLevel, source: string, message: string) => {
    setLogs((prev) => [...prev.slice(-200), { id: logIdRef.current++, timestamp: Date.now(), level, source, message }]);
  }, []);

  // Auto-scroll console log (only within its container, not the page)
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Generate CTF flags from the day-based challenge pool — flag values stay server-side
  const generateCTFFlags = useCallback((d: AnalysisResponse): CTFFlag[] => {
    const challenges = CTF_POOL[devDay];

    return challenges.map((ch) => ({
      id: ch.id,
      challenge: ch.challenge,
      category: ch.category,
      difficulty: ch.difficulty,
      points: ch.points,
      hint: `[🔒 Layer ${ch.encryptionLayer}: ${["Cleartext", "TLS 1.3", "TLS + Unlink", "TLS + Unlink + AES-256-GCM"][ch.encryptionLayer]}] ${ch.hint}`,
      captured: false,
      flagValue: "", // Server-side only — never sent to client
      probeId: ch.id,
      evidence: `Encryption Layer ${ch.encryptionLayer} — ${ch.category} analysis required. Examine the ${["raw hex dump", "TLS metadata", "Unlink relay headers", "AES-GCM envelope"][ch.encryptionLayer]} in the analysis tabs.`,
    }));
  }, [devDay]);

  useEffect(() => {
    if (!receipt || !pendingHash || state.phase !== "confirming") return;
    const analyze = async () => {
      setState({ phase: "analyzing", data: null });
      pushLog("info", "ANALYZER", `Starting deep packet inspection on tx ${pendingHash.slice(0, 16)}…`);
      pushLog("debug", "RPC", "Fetching transaction receipt from Monad testnet…");
      try {
        const res = await fetch("/api/attack-sim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: pendingHash, sender: address }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "API failed");
        pushLog("success", "RPC", `Receipt confirmed — block #${d.blockNumber}, index ${d.positionInBlock}/${d.totalBlockTxs}`);
        pushLog("info", "CAPTURE", `Captured ${d.packets?.length ?? 0} packet hops across network`);
        pushLog("info", "PROBES", `Running ${d.securityTests?.length ?? 0} security probes…`);
        d.securityTests?.forEach((t: SecurityTest) => {
          const icon = t.unprotectedResult === "FAIL" ? "✗" : t.unprotectedResult === "PASS" ? "✓" : "◐";
          pushLog(t.unprotectedResult === "FAIL" ? "warn" : "success", "PROBE", `${icon} ${t.id} ${t.name} — unprotected: ${t.unprotectedResult}`);
        });
        if (d.anomalies?.length > 0) {
          d.anomalies.forEach((a: Anomaly) => pushLog(a.severity === "CRITICAL" ? "error" : "warn", "ANOMALY", `[${a.severity}] ${a.description}`));
        } else {
          pushLog("success", "ANOMALY", "No anomalies detected in block neighbors");
        }
        const flags = generateCTFFlags(d);
        setCtfFlags(flags);
        setHasClaimed(false);
        pushLog("flag", "CTF", `${flags.length} challenges loaded for ${DAYS[devDay]} — find the flags!`);
        pushLog("success", "DONE", `Analysis complete — ${d.packets?.length} hops, ${d.securityTests?.length} probes, ${d.anomalies?.length} anomalies`);
        setState({ phase: "complete", data: d as AnalysisResponse });
        // Store session server-side for flag validation
        const nonceRaw = d.rawTxFields?.nonce ?? "0";
        const nonceInt = nonceRaw.startsWith("0x") ? parseInt(nonceRaw, 16) : parseInt(nonceRaw, 10);
        const gasPriceRaw = d.rawTxFields?.gasPrice ?? "0x0";
        const gasGwei = Math.round(parseInt(gasPriceRaw, 16) / 1e9).toString();
        fetch("/api/attack-sim", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "store-session", playerAddress: address, day: devDay,
            sender: d.sender, txHash: d.txHash, gas: gasGwei,
            block: d.blockNumber.toString(), nonce: nonceInt.toString(),
            value: d.value, effectiveGasPrice: d.effectiveGasPrice,
            rlpHexLen: Math.max(0, (d.rawTxFields?.rlpHex?.length ?? 2) - 2),
            vHex: d.rawTxFields?.v ?? "0x4f61",
          }),
        }).catch(() => {});
        // Mark player as played today
        if (address) {
          fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark-played", playerAddress: address }) })
            .then(() => { setPlayedToday(true); })
            .catch(() => {});
          fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "daily-players" }) })
            .then((r) => r.json()).then((dp) => { if (dp.players) setDailyPlayersList(dp.players); }).catch(() => {});
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Analysis failed";
        pushLog("error", "ANALYZER", `Failed: ${msg}`);
        setState({ phase: "error", data: null, error: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg });
      } finally {
        setRunning(false);
        setPendingHash(undefined);
      }
    };
    analyze();
  }, [receipt, pendingHash, state.phase, address]);

  const runAnalysis = useCallback(async () => {
    if (!isConnected || !address) {
      pushLog("error", "WALLET", "Connect your wallet to play");
      setState({ phase: "error", data: null, error: "Connect your wallet to enter the CTF." });
      return;
    }
    if (playedToday) {
      pushLog("error", "CTF", "You already played today! Come back tomorrow for new challenges.");
      setState({ phase: "error", data: null, error: "Already played today. New challenges unlock tomorrow!" });
      return;
    }
    if (!poolAddress) {
      pushLog("error", "POOL", "Prize pool address not loaded yet — retrying…");
      // Try to fetch it now
      try {
        const r = await fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pool-balance" }) });
        const d = await r.json();
        if (d.address) { setPoolAddress(d.address); setPoolBalance(d.balance); }
        else { setState({ phase: "error", data: null, error: "Cannot determine pool address. Check bot key config." }); return; }
      } catch { setState({ phase: "error", data: null, error: "Pool API unreachable." }); return; }
    }
    setRunning(true);
    setHasClaimed(false);
    pushLog("info", "CTF", `New round — ${DAYS[devDay]} challenges — entry fee ${ENTRY_FEE} MON → pool ${poolAddress.slice(0, 10)}…`);

    setState({ phase: "wallet", data: null });
    pushLog("info", "WALLET", `Sending ${ENTRY_FEE} MON from ${address.slice(0, 10)}… → pool ${poolAddress.slice(0, 10)}…`);
    try {
      const hash = await sendTransactionAsync({ to: poolAddress as `0x${string}`, value: parseEther(ENTRY_FEE) });
      pushLog("success", "WALLET", `Entry paid: ${hash.slice(0, 20)}…`);
      pushLog("info", "MEMPOOL", "Transaction broadcast — analyzing security…");
      setPendingHash(hash);
      setState({ phase: "confirming", data: null });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Wallet rejected";
      pushLog("error", "WALLET", `Rejected: ${msg.slice(0, 80)}`);
      setState({ phase: "error", data: null, error: msg.length > 220 ? `${msg.slice(0, 220)}…` : msg });
      setRunning(false);
    }
  }, [isConnected, address, poolAddress, sendTransactionAsync, pushLog, devDay, playedToday]);

  // Filtered anomalies by severity
  const criticalAnomalies = useMemo(() =>
    state.data?.anomalies?.filter((a) => a.severity === "CRITICAL") ?? [], [state.data]);

  // CTF scoring
  const ctfScore = useMemo(() => {
    const captured = ctfFlags.filter((f) => f.captured);
    return { total: captured.reduce((s, f) => s + f.points, 0), captured: captured.length, max: ctfFlags.reduce((s, f) => s + f.points, 0) };
  }, [ctfFlags]);

  const submitFlag = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || !address) return;

    // Check if already captured locally
    if (ctfFlags.some((f) => f.flagValue === trimmed && f.captured)) {
      setCtfMessage({ text: "Already captured this flag.", ok: false });
      setCtfInput("");
      setTimeout(() => setCtfMessage(null), 4000);
      return;
    }

    pushLog("debug", "CTF", `Validating flag submission: ${trimmed.slice(0, 20)}…`);

    try {
      const res = await fetch("/api/attack-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate-flag", playerAddress: address, submission: trimmed, day: devDay }),
      });
      const d = await res.json();
      if (d.valid) {
        setCtfFlags((prev) => prev.map((f) => f.id === d.challengeId ? { ...f, captured: true, flagValue: d.flagValue } : f));
        pushLog("flag", "CTF", `🚩 Captured ${d.challengeId}: ${d.flagValue} (+${d.points}pts)`);
        setCtfMessage({ text: `✓ Flag captured: ${d.challengeId} (+${d.points}pts)`, ok: true });
      } else {
        pushLog("warn", "CTF", `Invalid flag: ${d.reason || "incorrect"}`);
        setCtfMessage({ text: `✗ ${d.reason || "Invalid flag. Check your analysis."}`, ok: false });
      }
    } catch {
      pushLog("error", "CTF", "Flag validation failed — server unreachable");
      setCtfMessage({ text: "✗ Server error. Try again.", ok: false });
    }

    setCtfInput("");
    setTimeout(() => setCtfMessage(null), 4000);
  }, [ctfFlags, pushLog, address, devDay]);

  // Claim MON winnings from pool (once per round)
  const claimWinnings = useCallback(async () => {
    if (!isConnected || !address) return;
    if (hasClaimed) { setCtfMessage({ text: "Already claimed this round! Play again for more.", ok: false }); setTimeout(() => setCtfMessage(null), 3000); return; }
    if (ctfScore.total <= 0) { setCtfMessage({ text: "No points to claim! Capture some flags first.", ok: false }); setTimeout(() => setCtfMessage(null), 3000); return; }
    setClaiming(true);
    pushLog("info", "CLAIM", `Claiming ${ctfScore.total} points as MON from prize pool…`);
    try {
      const res = await fetch("/api/attack-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", playerAddress: address, points: ctfScore.total }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Claim failed");
      pushLog("success", "CLAIM", `🎉 Received ${d.reward} MON — from ${d.from?.slice(0,10)}… → ${d.to?.slice(0,10)}…`);
      pushLog("info", "CLAIM", `Tx: ${d.txHash}`);
      setTotalWinnings((prev) => prev + ctfScore.total);
      setHasClaimed(true);
      setCtfMessage({ text: `🎉 Claimed ${d.reward} MON! Pool(${d.from?.slice(0,8)}…) → You(${d.to?.slice(0,8)}…)`, ok: true });
      refetchPlayerBal();
      fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pool-balance" }) })
        .then((r) => r.json()).then((b) => { if (b.balance) setPoolBalance(b.balance); }).catch(() => {});
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Claim failed";
      pushLog("error", "CLAIM", msg);
      setCtfMessage({ text: `✗ ${msg}`, ok: false });
    } finally {
      setClaiming(false);
      setTimeout(() => setCtfMessage(null), 5000);
    }
  }, [isConnected, address, ctfScore.total, hasClaimed, pushLog, refetchPlayerBal]);

  if (!mounted) return null;
  const { phase, data } = state;

  return (
    <div className="space-y-4 font-mono">
      {/* ─── CTF GAME HEADER ─── */}
      <div className="bg-bg-card border border-purple-500/30 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${phase === "complete" ? (criticalAnomalies.length > 0 ? "bg-red-500 animate-pulse" : "bg-green-500") : "bg-purple-500 animate-pulse"}`} />
            <div>
              <h2 className="text-sm font-bold tracking-wider">🚩 CTF-CHAIN</h2>
              <p className="text-[10px] text-text-muted">
                {isConnected ? `Player ${address?.slice(0, 8)}…${address?.slice(-4)}` : "⚠ Connect wallet to play"} · Monad Testnet
              </p>
            </div>
          </div>

          {/* Balances */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-[8px] text-text-muted tracking-wider">YOUR BALANCE</div>
              <div className="text-sm font-bold text-green-400">
                {playerBalData ? Number(formatEther(playerBalData.value)).toFixed(3) : "—"} <span className="text-[9px] text-text-muted">MON</span>
              </div>
            </div>
            <div className="text-center border-l border-r border-border-default px-4">
              <div className="text-[8px] text-text-muted tracking-wider">PRIZE POOL</div>
              <div className="text-sm font-bold text-purple-400">
                {isNaN(Number(poolBalance)) ? "…" : Number(poolBalance).toFixed(3)} <span className="text-[9px] text-text-muted">MON</span>
              </div>
            </div>
            <div className="text-center">
              <div className="text-[8px] text-text-muted tracking-wider">CTF SCORE</div>
              <div className="text-sm font-bold text-accent-amber">
                {ctfScore.total} <span className="text-[9px] text-text-muted">pts</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={runAnalysis}
              disabled={running || !isConnected || playedToday}
              className="px-4 py-2 text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/40 rounded hover:bg-purple-500/25 disabled:opacity-50 transition-all tracking-wide"
            >
              {playedToday ? "🔒 PLAYED TODAY" : phase === "wallet" ? "SIGN IN WALLET…" : phase === "confirming" ? "TX PENDING…" : phase === "analyzing" ? "ANALYZING…" : `▶ PLAY ROUND (${ENTRY_FEE} MON)`}
            </button>
            {ctfScore.total > 0 && !hasClaimed && (
              <button
                onClick={claimWinnings}
                disabled={claiming || !isConnected}
                className="px-4 py-2 text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/40 rounded hover:bg-green-500/25 disabled:opacity-50 transition-all tracking-wide"
              >
                {claiming ? "CLAIMING…" : `💰 CLAIM ${(ctfScore.total * 0.00001).toFixed(5)} MON`}
              </button>
            )}
            {hasClaimed && (
              <span className="px-4 py-2 text-[10px] font-bold text-green-400 border border-green-500/40 rounded bg-green-500/10">✓ CLAIMED</span>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {phase === "error" && state.error && (
        <div className="bg-bg-card border border-red-500/40 rounded-lg p-3">
          <div className="text-[10px] font-bold text-red-400 mb-1">ERROR</div>
          <p className="text-[10px] text-text-secondary break-all">{state.error}</p>
        </div>
      )}

      {/* Loading */}
      {(phase === "wallet" || phase === "confirming" || phase === "analyzing") && (
        <div className="bg-bg-card border border-accent-amber/30 rounded-lg p-6">
          <div className="flex items-center justify-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
            <span className="text-xs text-accent-amber font-medium tracking-wide">
              {phase === "wallet" ? "Awaiting wallet signature…"
                : phase === "confirming" ? "Transaction pending on Monad…"
                : "Deep packet inspection in progress…"}
            </span>
          </div>
        </div>
      )}

      {/* ─── IDLE — CTF INTRO ─── */}
      {phase === "idle" && (
        <div className="bg-bg-card border border-border-default rounded-lg p-6">
          <div className="text-center max-w-2xl mx-auto">
            <div className="text-3xl mb-2">🚩</div>
            <div className="text-[10px] text-purple-400 tracking-widest mb-3 font-bold">BLOCKCHAIN SECURITY CTF</div>
            <p className="text-xs text-text-secondary mb-4 leading-relaxed font-sans">
              Pay <strong className="text-purple-400">{ENTRY_FEE} MON</strong> entry fee to start a round. Your transaction gets analyzed across 6 network hops.
              Each hop is inspected at <strong className="text-text-primary">4 encryption layers</strong>. Capture flags by analyzing the packet data and computing cryptographic values.
              Earn points and <strong className="text-green-400">claim real MON</strong> from the prize pool.
            </p>
            <div className="grid grid-cols-4 gap-2 text-center mb-4">
              {[
                { icon: "🔓", label: "LAYER 0", desc: "Cleartext — 100pts" },
                { icon: "🔒", label: "LAYER 1", desc: "TLS 1.3 — 250pts" },
                { icon: "🛡️", label: "LAYER 2", desc: "TLS + Unlink — 500pts" },
                { icon: "🏰", label: "LAYER 3", desc: "Full envelope — 1000pts" },
              ].map((f) => (
                <div key={f.label} className="bg-bg-primary/50 rounded-lg p-3 border border-border-default">
                  <div className="text-lg mb-1">{f.icon}</div>
                  <div className="text-[8px] font-bold text-text-primary tracking-wider">{f.label}</div>
                  <div className="text-[8px] text-text-muted font-sans">{f.desc}</div>
                </div>
              ))}
            </div>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-[10px] text-text-secondary font-sans mb-3">
              <span className="text-purple-400 font-bold">TODAY&apos;S CHALLENGE: {DAYS[devDay].toUpperCase()}</span> — {CTF_POOL[devDay].length} flags across 4 encryption layers.
              Difficulty scales with encryption: Layer 0 (cleartext mempool) → Layer 3 (TLS + Unlink relay + AES-256-GCM envelope).
              Harder flags require cryptographic computation: keccak256 hashes, XOR operations, entropy analysis.
              <strong className="text-text-primary"> 1 point = 0.00001 MON</strong> claimable from the prize pool.
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ RESULTS ═══════════════ */}
      {phase === "complete" && data && (
        <>
          {/* ─── ALERT BANNER ─── */}
          {criticalAnomalies.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 flex items-center gap-3">
              <span className="text-lg">🚨</span>
              <div>
                <div className="text-[10px] font-bold text-red-400 tracking-wider">
                  {criticalAnomalies.length} CRITICAL ANOMAL{criticalAnomalies.length === 1 ? "Y" : "IES"} DETECTED
                </div>
                <p className="text-[10px] text-text-secondary">{criticalAnomalies[0]?.description}</p>
              </div>
            </div>
          )}

          {/* ─── SUMMARY BAR ─── */}
          <div className="bg-bg-card border border-border-default rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] text-text-muted tracking-wider">TRANSACTION ANALYSIS</div>
              <a href={`https://monad-testnet.socialscan.io/tx/${data.txHash}`} target="_blank" rel="noopener noreferrer"
                className="text-[9px] text-accent-blue hover:underline">{shortH(data.txHash)} ↗</a>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="BLOCK" value={data.blockNumber.toString()} />
              <Stat label="VALUE" value={`${data.value} MON`} />
              <Stat label="GAS" value={`${(Number(data.effectiveGasPrice) / 1e9).toFixed(1)} gwei`} />
              <Stat label="NONCE" value={data.rawTxFields.nonce?.startsWith("0x") ? parseInt(data.rawTxFields.nonce, 16).toString() : data.rawTxFields.nonce ?? "—"} />
              <Stat label="LATENCY" value={`${data.timing.totalMs}ms`} />
            </div>
          </div>

          {/* ─── SECTION TABS ─── */}
          <div className="flex gap-1 border-b border-border-default pb-0">
            {[
              { id: "ctf", label: "🚩 CTF CHALLENGES", count: ctfFlags.length },
              { id: "packets", label: "📡 PACKETS", count: data.packets.length },
              { id: "forensics", label: "🔍 FORENSICS", count: data.neighbors.length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={`px-3 py-2 text-[9px] font-bold tracking-wider transition-all border-b-2 ${
                  activeSection === tab.id
                    ? tab.id === "ctf" ? "border-purple-500 text-purple-400" : "border-accent-amber text-accent-amber"
                    : "border-transparent text-text-muted hover:text-text-secondary"
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* ═══ PACKET TRACE (Wireshark-style) ═══ */}
          {activeSection === "packets" && (
            <div className="space-y-3">
              {/* Encryption layer selector */}
              <div className="bg-bg-card border border-border-default rounded-lg p-3">
                <div className="text-[9px] text-text-muted tracking-wider mb-2">VIEW AS ENCRYPTION LAYER — see what an attacker sees at each difficulty</div>
                <div className="flex gap-1">
                  {([
                    { layer: 0, label: "🔓 L0: CLEARTEXT", desc: "No encryption — everything visible", color: "text-red-400 border-red-500/40 bg-red-500/10" },
                    { layer: 1, label: "🔒 L1: TLS 1.3", desc: "Transport encrypted — RPC sees all", color: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10" },
                    { layer: 2, label: "🛡️ L2: TLS+UNLINK", desc: "IP hidden — relay sees payload", color: "text-blue-400 border-blue-500/40 bg-blue-500/10" },
                    { layer: 3, label: "🏰 L3: FULL AES", desc: "Envelope encrypted — only metadata", color: "text-purple-400 border-purple-500/40 bg-purple-500/10" },
                  ] as const).map((l) => (
                    <button
                      key={l.layer}
                      onClick={() => setViewLayer(l.layer)}
                      className={`px-2 py-1.5 text-[8px] font-bold rounded border transition-all flex-1 ${
                        viewLayer === l.layer ? l.color : "border-border-default text-text-muted hover:text-text-secondary"
                      }`}
                      title={l.desc}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Packet list */}
              <div className="lg:col-span-1 bg-bg-card border border-border-default rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border-default text-[9px] font-bold text-text-muted tracking-wider">
                  CAPTURED PACKETS ({data.packets.length})
                </div>
                <div className="divide-y divide-border-default/50">
                  {data.packets.map((pkt, i) => {
                    const hopEncrypted = viewLayer >= 1 && i >= 1; // TLS encrypts from hop 2+
                    const hopRelayed = viewLayer >= 2 && i >= 2; // Unlink hides from hop 3+
                    const hopEnveloped = viewLayer >= 3; // AES wraps everything
                    return (
                    <div
                      key={pkt.id}
                      onClick={() => setSelectedPacket(i)}
                      className={`px-3 py-2 cursor-pointer transition-all text-[10px] ${
                        selectedPacket === i ? "bg-accent-amber/10 border-l-2 border-accent-amber" :
                        pkt.flags.length > 0 && !hopEnveloped ? "bg-red-500/5 hover:bg-red-500/10" : "hover:bg-bg-primary/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-text-primary">#{i + 1} {pkt.phase}</span>
                        <div className="flex items-center gap-1">
                          {hopEnveloped && <span className="text-[7px] px-1 rounded bg-purple-500/15 text-purple-400 font-bold">AES</span>}
                          {hopRelayed && !hopEnveloped && <span className="text-[7px] px-1 rounded bg-blue-500/15 text-blue-400 font-bold">RELAY</span>}
                          {hopEncrypted && !hopRelayed && <span className="text-[7px] px-1 rounded bg-yellow-500/15 text-yellow-400 font-bold">TLS</span>}
                          {!hopEncrypted && !hopRelayed && !hopEnveloped && <span className="text-[7px] px-1 rounded bg-red-500/15 text-red-400 font-bold">CLEAR</span>}
                          <span className="text-text-muted">{pkt.elapsed}ms</span>
                        </div>
                      </div>
                      <div className="text-[9px] text-text-muted truncate">
                        {hopRelayed ? `${pkt.from.slice(0,8)}… → [RELAY] → ${pkt.to.slice(0,8)}…` : `${pkt.from} → ${pkt.to}`}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[8px] text-text-muted">{hopEncrypted ? `${pkt.protocol} (encrypted)` : pkt.protocol}</span>
                        {pkt.flags.length > 0 && !hopEnveloped && (
                          <span className="text-[7px] font-bold px-1 py-0 rounded bg-red-500/15 text-red-400">
                            {pkt.flags.length} FLAG{pkt.flags.length > 1 ? "S" : ""}
                          </span>
                        )}
                        {hopEnveloped && pkt.flags.length > 0 && (
                          <span className="text-[7px] font-bold px-1 py-0 rounded bg-green-500/15 text-green-400">HIDDEN</span>
                        )}
                        <EntropyMini score={hopEnveloped ? Math.min(pkt.entropyScore + 0.3, 0.99) : hopEncrypted ? Math.min(pkt.entropyScore + 0.15, 0.95) : pkt.entropyScore} />
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Packet detail + hex dump */}
              <div className="lg:col-span-2 space-y-3">
                {data.packets[selectedPacket] && (() => {
                  const pkt = data.packets[selectedPacket];
                  const hopIdx = selectedPacket;
                  const isEncrypted = viewLayer >= 1 && hopIdx >= 1;
                  const isRelayed = viewLayer >= 2 && hopIdx >= 2;
                  const isEnveloped = viewLayer >= 3;
                  const effectiveEntropy = isEnveloped ? Math.min(pkt.entropyScore + 0.3, 0.99) : isEncrypted ? Math.min(pkt.entropyScore + 0.15, 0.95) : pkt.entropyScore;
                  return (
                    <>
                      <div className="bg-bg-card border border-border-default rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-[10px] font-bold text-text-primary">
                            HOP {selectedPacket + 1}: {pkt.phase}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${
                              isEnveloped ? "text-purple-400 bg-purple-500/10 border-purple-500/30" :
                              isRelayed ? "text-blue-400 bg-blue-500/10 border-blue-500/30" :
                              isEncrypted ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" :
                              "text-red-400 bg-red-500/10 border-red-500/30"
                            }`}>
                              {isEnveloped ? "🏰 AES-256-GCM" : isRelayed ? "🛡️ TLS+Unlink" : isEncrypted ? "🔒 TLS 1.3" : "🔓 Cleartext"}
                            </span>
                            <EntropyBadge score={effectiveEntropy} />
                          </div>
                        </div>
                        <p className="text-[10px] text-text-secondary mb-3 font-sans leading-relaxed">{pkt.description}</p>

                        {/* Encryption status banner */}
                        {isEnveloped && (
                          <div className="mb-3 p-2 rounded border border-purple-500/30 bg-purple-500/5 text-[9px] text-purple-300 font-sans">
                            🏰 <strong>AES-256-GCM envelope active</strong> — payload fully encrypted. Only metadata (timing, size) visible to observers. Decoded fields below show what <em>would</em> be visible without encryption.
                          </div>
                        )}
                        {isRelayed && !isEnveloped && (
                          <div className="mb-3 p-2 rounded border border-blue-500/30 bg-blue-500/5 text-[9px] text-blue-300 font-sans">
                            🛡️ <strong>Unlink relay active</strong> — IP address hidden from RPC. Relay sees decrypted payload but public observers cannot link sender IP to wallet.
                          </div>
                        )}
                        {isEncrypted && !isRelayed && (
                          <div className="mb-3 p-2 rounded border border-yellow-500/30 bg-yellow-500/5 text-[9px] text-yellow-300 font-sans">
                            🔒 <strong>TLS 1.3 transport</strong> — encrypted in transit but RPC endpoint sees full cleartext. Mempool peers still see broadcast payload.
                          </div>
                        )}
                        {!isEncrypted && (
                          <div className="mb-3 p-2 rounded border border-red-500/30 bg-red-500/5 text-[9px] text-red-300 font-sans">
                            🔓 <strong>No encryption</strong> — all fields visible to every network participant. Full data extraction possible.
                          </div>
                        )}

                        {/* Decoded fields */}
                        <div className="mb-3">
                          <div className="text-[8px] font-bold text-text-muted tracking-wider mb-1">
                            {isEnveloped ? "DECODED FIELDS (would be hidden)" : "DECODED FIELDS"}
                          </div>
                          <div className={`grid grid-cols-2 gap-x-4 gap-y-0.5 ${isEnveloped ? "opacity-40" : ""}`}>
                            {Object.entries(pkt.decodedFields).map(([k, v]) => (
                              <div key={k} className="flex gap-2 text-[10px]">
                                <span className="text-accent-blue shrink-0">{k}:</span>
                                <span className="text-text-secondary truncate">
                                  {isEnveloped ? "████████" : isRelayed && (k === "from_ip" || k === "ip") ? "██HIDDEN██" : v}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Flags */}
                        {pkt.flags.length > 0 && (
                          <div className="mb-3">
                            <div className={`text-[8px] font-bold tracking-wider mb-1 ${isEnveloped ? "text-green-400" : "text-red-400"}`}>
                              {isEnveloped ? "✓ SECURITY FLAGS (mitigated by encryption)" : "⚠ SECURITY FLAGS"}
                            </div>
                            {pkt.flags.map((f, i) => (
                              <div key={i} className={`text-[10px] flex items-start gap-1.5 font-sans ${isEnveloped ? "text-green-400 line-through opacity-60" : "text-red-400"}`}>
                                <span className="shrink-0">{isEnveloped ? "✓" : "✗"}</span> {f}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Leaked data */}
                        {pkt.leaked.length > 0 && (
                          <div>
                            <div className="text-[8px] font-bold text-yellow-400 tracking-wider mb-1">
                              {isEnveloped ? "EXPOSED DATA (encrypted)" : isRelayed ? "EXPOSED DATA (partially hidden)" : "EXPOSED DATA"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {pkt.leaked.map((l, i) => {
                                const hidden = isEnveloped || (isRelayed && (l.toLowerCase().includes("ip") || l.toLowerCase().includes("address")));
                                return (
                                  <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded border ${
                                    hidden
                                      ? "bg-green-500/10 border-green-500/30 text-green-400 line-through"
                                      : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                                  }`}>
                                    {hidden ? `${l} ✓` : l}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Hex dump */}
                      <div className="bg-bg-card border border-border-default rounded-lg overflow-hidden">
                        <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                          <span className="text-[9px] font-bold text-text-muted tracking-wider">
                            HEX DUMP — HOP {selectedPacket + 1}
                            {isEnveloped && " (encrypted payload)"}
                          </span>
                          <input
                            value={hexFilter}
                            onChange={(e) => setHexFilter(e.target.value)}
                            className="w-32 bg-bg-primary border border-border-default rounded px-2 py-0.5 text-[9px] text-text-primary focus:border-accent-amber focus:outline-none"
                            placeholder="filter hex…"
                          />
                        </div>
                        <HexDump hex={pkt.rawHex} filter={hexFilter} entropy={effectiveEntropy} />
                      </div>
                    </>
                  );
                })()}
              </div>
              </div>
            </div>
          )}

          {/* ═══ CTF CHALLENGES ═══ */}
          {activeSection === "ctf" && (
            <div className="space-y-3">
              {/* Scoreboard */}
              <div className="bg-bg-card border border-purple-500/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🚩</span>
                    <span className="text-sm font-bold text-purple-400 tracking-wider">CTF SCOREBOARD</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-purple-400">{ctfScore.total}<span className="text-sm text-text-muted">/{ctfScore.max}</span></div>
                      <div className="text-[8px] text-text-muted tracking-wider">{ctfScore.captured}/{ctfFlags.length} FLAGS · ≈{(ctfScore.total * 0.00001).toFixed(5)} MON</div>
                    </div>
                    {ctfScore.total > 0 && !hasClaimed && (
                      <button
                        onClick={claimWinnings}
                        disabled={claiming || !isConnected}
                        className="px-4 py-2.5 text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/40 rounded hover:bg-green-500/25 disabled:opacity-50 transition-all tracking-wide"
                      >
                        {claiming ? "CLAIMING…" : `💰 CLAIM ${(ctfScore.total * 0.00001).toFixed(5)} MON`}
                      </button>
                    )}
                    {hasClaimed && (
                      <span className="px-4 py-2.5 text-[10px] font-bold text-green-400 border border-green-500/40 rounded bg-green-500/10">✓ CLAIMED</span>
                    )}
                  </div>
                </div>
                <div className="w-full h-3 bg-bg-primary rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-purple-500 transition-all" style={{ width: `${ctfScore.max > 0 ? (ctfScore.total / ctfScore.max) * 100 : 0}%` }} />
                </div>

                {/* Flag submission */}
                <div className="flex gap-2">
                  <input
                    value={ctfInput}
                    onChange={(e) => setCtfInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && ctfInput.trim()) submitFlag(ctfInput); }}
                    className="flex-1 bg-bg-primary border border-border-default rounded px-3 py-2 text-[11px] text-text-primary focus:border-purple-500 focus:outline-none font-mono"
                    placeholder="CTF{...} — submit a captured flag"
                  />
                  <button
                    onClick={() => ctfInput.trim() && submitFlag(ctfInput)}
                    className="px-4 py-2 text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/40 rounded hover:bg-purple-500/25 transition-all tracking-wide"
                  >
                    SUBMIT FLAG
                  </button>
                </div>
                {ctfMessage && (
                  <div className={`mt-2 text-[10px] font-bold ${ctfMessage.ok ? "text-green-400" : "text-red-400"}`}>{ctfMessage.text}</div>
                )}
              </div>

              {/* Challenge cards by difficulty */}
              {(["EASY", "MEDIUM", "HARD", "INSANE"] as const).map((diff) => {
                const flags = ctfFlags.filter((f) => f.difficulty === diff);
                if (flags.length === 0) return null;
                const ds = DIFF_LABELS[diff];
                return (
                  <div key={diff}>
                    <div className="flex items-center gap-2 mb-2 mt-3">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${ds.color}`}>{diff}</span>
                      <span className="text-[10px] text-text-muted">{flags.length} challenges · {ds.points}pts each</span>
                    </div>
                    <div className="space-y-1.5">
                      {flags.map((flag) => (
                        <CTFCard key={flag.id} flag={flag} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ BLOCK FORENSICS ═══ */}
          {activeSection === "forensics" && (
            <div className="space-y-3">
              <div className="bg-bg-card border border-border-default rounded-lg p-4">
                <div className="text-[10px] text-text-muted tracking-wider mb-3">
                  TRANSACTION LIFECYCLE — {data.timing.totalMs}ms TOTAL
                </div>
                <div className="flex h-6 rounded overflow-hidden">
                  {[
                    { label: "Sign", ms: data.timing.signMs, color: "bg-accent-green" },
                    { label: "Broadcast", ms: data.timing.broadcastMs, color: "bg-accent-amber" },
                    { label: "Confirm", ms: data.timing.confirmMs, color: "bg-accent-red" },
                    { label: "Analyze", ms: data.timing.analysisMs, color: "bg-accent-blue" },
                  ].map((seg) => {
                    const pct = Math.max(5, (seg.ms / data.timing.totalMs) * 100);
                    return (
                      <div key={seg.label} className={`${seg.color}/40 flex items-center justify-center text-[8px] font-bold text-text-primary border-r border-bg-primary`}
                        style={{ width: `${pct}%` }} title={`${seg.label}: ${seg.ms}ms`}>
                        {pct > 12 && `${seg.label} ${seg.ms}ms`}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Raw TX fields */}
              <div className="bg-bg-card border border-border-default rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border-default">
                  <span className="text-[9px] font-bold tracking-wider text-text-muted">RAW TRANSACTION FIELDS</span>
                </div>
                <div className="p-3 space-y-0.5">
                  {Object.entries(data.rawTxFields).map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-[10px]">
                      <span className="text-accent-blue w-24 shrink-0">{key}:</span>
                      <span className="text-text-secondary break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Block neighbors */}
              {data.neighbors.length > 0 && (
                <div className="bg-bg-card border border-border-default rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                    <span className="text-[9px] font-bold tracking-wider text-text-muted">
                      BLOCK {data.blockNumber} — {data.totalBlockTxs} TXS
                    </span>
                    <span className="text-[9px] text-text-muted">
                      {data.neighbors.filter((n) => n.anomaly).length} flagged
                    </span>
                  </div>
                  <div className="p-2 max-h-[300px] overflow-y-auto space-y-0.5">
                    {data.neighbors.slice(0, 20).map((n) => (
                      <div key={n.hash} className={`flex items-center gap-2 text-[10px] py-1 px-2 rounded ${
                        n.anomaly ? "bg-red-500/5 border-l-2 border-red-500/40" : n.isSuspicious ? "bg-yellow-500/5 border-l-2 border-yellow-500/40" : ""
                      }`}>
                        <span className="w-5 text-text-muted text-center">{n.index}</span>
                        <span className={`w-8 text-[8px] font-bold ${n.anomaly ? "text-red-400" : n.isSuspicious ? "text-yellow-400" : "text-text-muted"}`}>
                          {n.anomaly ? "⚠" : n.isSuspicious ? "◐" : "·"}
                        </span>
                        <span className="w-20 text-text-muted truncate">{shortA(n.from)}</span>
                        <span className="flex-1 text-text-secondary truncate">{shortH(n.hash)}</span>
                        <span className="w-14 text-right text-text-muted">{Number(n.value).toFixed(3)}</span>
                        <span className="w-6 text-right text-text-muted text-[9px]">±{n.distance}</span>
                        {n.anomaly && <span className="text-[8px] text-red-400 truncate max-w-[120px]">{n.anomaly}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── BOTTOM VERDICT ─── */}
          <div className="bg-bg-card border border-border-default rounded-lg p-4">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-muted">
                {data.packets.length} hops · {ctfScore.captured}/{ctfFlags.length} flags captured · {ctfScore.total}pts · Block #{data.blockNumber}
              </span>
              <a href={`https://monad-testnet.socialscan.io/tx/${data.txHash}`} target="_blank" rel="noopener noreferrer"
                className="text-accent-blue hover:underline">Verify on Socialscan ↗</a>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════ CONSOLE LOG ═══════════════ */}
      <div className="bg-bg-card border border-border-default rounded-lg overflow-hidden">
        <div
          className="px-3 py-2 border-b border-border-default flex items-center justify-between cursor-pointer hover:bg-bg-primary/30"
          onClick={() => setConsoleOpen(!consoleOpen)}
        >
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-green-400 tracking-wider">▸ CONSOLE LOG</span>
            <span className="text-[8px] text-text-muted">{logs.length} entries</span>
            {logs.length > 0 && logs[logs.length - 1].level === "error" && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {ctfFlags.length > 0 && (
              <span className="text-[8px] text-purple-400 font-bold">🚩 {ctfScore.captured}/{ctfFlags.length} · {ctfScore.total}pts{totalWinnings > 0 ? ` · Won: ${(totalWinnings * 0.00001).toFixed(5)} MON` : ""}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setLogs([]); }}
              className="text-[8px] text-text-muted hover:text-red-400 px-1"
            >
              CLEAR
            </button>
            <span className="text-[9px] text-text-muted">{consoleOpen ? "▾" : "▸"}</span>
          </div>
        </div>
        {consoleOpen && (
          <div ref={logContainerRef} className="bg-black/30 p-2 max-h-[240px] overflow-y-auto font-mono text-[10px] leading-[1.6]">
            {logs.length === 0 ? (
              <div className="text-text-muted text-center py-4 text-[9px]">
                Console output will appear here. Click ▶ CAPTURE & ANALYZE to start.
              </div>
            ) : (
              logs.map((log) => {
                const s = LOG_STYLES[log.level];
                const ts = new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div key={log.id} className="flex gap-2 hover:bg-white/[0.02] px-1 rounded">
                    <span className="text-text-muted shrink-0">{ts}</span>
                    <span className={`shrink-0 font-bold ${s.color}`}>{s.prefix}</span>
                    <span className="text-accent-amber shrink-0 w-16 truncate">{log.source}</span>
                    <span className={`${log.level === "debug" ? "text-gray-500" : "text-text-secondary"} break-all`}>{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ═══════════════ DEV POPUP ═══════════════ */}
      <button
        onClick={() => setDevOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 w-10 h-10 rounded-full bg-purple-600 text-white text-sm font-bold shadow-lg hover:bg-purple-500 transition-all"
        title="Dev Tools (opens separate window)"
      >🔧</button>

      <DevToolsWindow open={devOpen} onClose={() => setDevOpen(false)}>
        <div className="font-mono text-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-purple-400 tracking-wider">🔧 DEV TOOLS</span>
          </div>

          {/* Day selector */}
          <div className="mb-3">
            <div className="text-[9px] text-text-muted mb-1 tracking-wider">CHALLENGE DAY</div>
            <div className="flex gap-1 flex-wrap">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => {
                    setDevDay(i);
                    setDevAnswers([]);
                    if (state.data) {
                      const flags = generateCTFFlags(state.data);
                      setCtfFlags(flags);
                      setHasClaimed(false);
                      pushLog("info", "DEV", `Switched to ${DAYS[i]} challenges (${flags.length} flags regenerated)`);
                      // Update server session with new day
                      if (address) {
                        fetch("/api/attack-sim", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "store-session", playerAddress: address, day: i,
                            sender: state.data.sender, txHash: state.data.txHash,
                            gas: Math.round(parseInt(state.data.rawTxFields?.gasPrice ?? "0x0", 16) / 1e9).toString(),
                            block: state.data.blockNumber.toString(),
                            nonce: (state.data.rawTxFields?.nonce?.startsWith("0x") ? parseInt(state.data.rawTxFields.nonce, 16) : parseInt(state.data.rawTxFields?.nonce || "0", 10)).toString(),
                            value: state.data.value, effectiveGasPrice: state.data.effectiveGasPrice,
                            rlpHexLen: Math.max(0, (state.data.rawTxFields?.rlpHex?.length ?? 2) - 2),
                            vHex: state.data.rawTxFields?.v ?? "0x4f61",
                          }),
                        }).catch(() => {});
                      }
                    }
                  }}
                  className={`px-2 py-1 text-[9px] rounded border transition-all ${
                    devDay === i
                      ? "bg-purple-500/30 text-purple-300 border-purple-500/60 font-bold"
                      : "bg-bg-primary text-text-muted border-border-default hover:border-purple-500/40"
                  }`}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
            <div className="text-[8px] text-text-muted mt-1">Today is {DAYS[new Date().getDay()]}. Override above.{state.data ? " Switching day auto-regenerates flags." : " Play a round to load challenges."}</div>
            <button
              onClick={() => { setPlayedToday(false); pushLog("warn", "DEV", "Daily play limit reset (dev override)"); }}
              className={`mt-1 px-2 py-0.5 text-[8px] rounded border transition-all ${playedToday ? "bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30" : "bg-bg-primary text-text-muted border-border-default opacity-50"}`}
            >{playedToday ? "🔓 Reset Daily Limit" : "No limit active"}</button>
          </div>

          {/* Flag answers (fetched from server for demo) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-text-muted tracking-wider">FLAG ANSWERS ({DAYS[devDay]})</span>
              <button
                onClick={() => {
                  if (!address) return;
                  fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dev-answers", playerAddress: address, day: devDay }) })
                    .then((r) => r.json()).then((d) => { if (d.answers) setDevAnswers(d.answers); }).catch(() => {});
                }}
                className="text-[8px] text-purple-400 hover:text-purple-300 underline"
              >🔑 Fetch Answers</button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {ctfFlags.length === 0 ? (
                <div className="text-[9px] text-text-muted italic">Play a round to generate flags</div>
              ) : devAnswers.length === 0 ? (
                <div className="text-[9px] text-text-muted italic">Click &quot;Fetch Answers&quot; to load from server</div>
              ) : (
                devAnswers.map((a) => {
                  const flag = ctfFlags.find((f) => f.id === a.id);
                  return (
                    <div key={a.id} className={`p-1.5 rounded border text-[9px] ${flag?.captured ? "bg-green-500/10 border-green-500/30" : "bg-bg-primary border-border-default"}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-text-primary">{a.id}</span>
                        <span className={`text-[8px] px-1 rounded ${
                          a.difficulty === "EASY" ? "bg-green-500/20 text-green-400" :
                          a.difficulty === "MEDIUM" ? "bg-yellow-500/20 text-yellow-400" :
                          a.difficulty === "HARD" ? "bg-orange-500/20 text-orange-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>{a.difficulty} · {a.points}pts</span>
                      </div>
                      <div className="text-purple-400 font-mono mt-0.5 select-all break-all">{a.flag}</div>
                      <div className="text-text-muted mt-0.5">{flag?.captured ? "✓ Captured" : "✗ Not captured"}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Game state */}
          <div className="mt-3 pt-2 border-t border-border-default text-[8px] text-text-muted space-y-0.5">
            <div>hasClaimed: {hasClaimed ? "true" : "false"} · totalWinnings: {totalWinnings}pts</div>
            <div>ctfScore: {ctfScore.captured}/{ctfFlags.length} flags · {ctfScore.total}/{ctfScore.max}pts</div>
            <div>phase: {phase} · poolBalance: {poolBalance}</div>
            <div>poolAddress: {poolAddress ? `${poolAddress.slice(0, 6)}…${poolAddress.slice(-4)}` : "(not loaded)"}</div>
            <div>playedToday: {playedToday ? "true" : "false"}</div>
          </div>

          {/* Daily players */}
          <div className="mt-3 pt-2 border-t border-border-default">
            <div className="text-[9px] text-text-muted mb-1 tracking-wider">TODAY&apos;S PLAYERS ({dailyPlayersList.length})</div>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {dailyPlayersList.length === 0 ? (
                <div className="text-[8px] text-text-muted italic">No players yet today</div>
              ) : (
                dailyPlayersList.map((p) => (
                  <div key={p} className="text-[8px] text-text-secondary font-mono select-all">{p}</div>
                ))
              )}
            </div>
            <button
              onClick={() => {
                fetch("/api/attack-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "daily-players" }) })
                  .then((r) => r.json()).then((d) => { if (d.players) setDailyPlayersList(d.players); }).catch(() => {});
              }}
              className="mt-1 text-[8px] text-purple-400 hover:text-purple-300 underline"
            >↻ Refresh</button>
          </div>
        </div>
      </DevToolsWindow>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: "red" | "yellow" | "green" }) {
  const color = highlight === "red" ? "text-red-400" : highlight === "yellow" ? "text-yellow-400" : highlight === "green" ? "text-green-400" : "text-text-primary";
  return (
    <div>
      <div className="text-[8px] text-text-muted tracking-wider">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

function EntropyMini({ score }: { score: number }) {
  const { pct, color } = entropyBar(score);
  return (
    <div className="flex items-center gap-1 ml-auto">
      <div className="w-10 h-1.5 bg-bg-primary rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[7px] text-text-muted">{pct}%</span>
    </div>
  );
}

function EntropyBadge({ score }: { score: number }) {
  const { pct, color } = entropyBar(score);
  const label = score > 0.8 ? "HIGH" : score > 0.5 ? "MED" : "LOW";
  const textColor = score > 0.8 ? "text-green-400" : score > 0.5 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="flex items-center gap-1">
      <div className="w-12 h-2 bg-bg-primary rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[8px] font-bold ${textColor}`}>{label} ({pct}%)</span>
    </div>
  );
}

function HexDump({ hex, filter, entropy }: { hex: string; filter: string; entropy: number }) {
  const clean = hex.replace(/^0x/, "");
  const bytes = clean.match(/.{1,2}/g) ?? [];
  const filterLower = filter.toLowerCase().replace(/^0x/, "");
  const BYTES_PER_ROW = 16;
  const rows: string[][] = [];
  for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
    rows.push(bytes.slice(i, i + BYTES_PER_ROW));
  }

  return (
    <div className="p-2 bg-bg-primary/80 max-h-[300px] overflow-y-auto">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[8px] text-text-muted">OFFSET</span>
        <span className="text-[8px] text-text-muted flex-1">HEX</span>
        <span className="text-[8px] text-text-muted">ASCII</span>
        <EntropyBadge score={entropy} />
      </div>
      {rows.slice(0, 20).map((row, rowIdx) => {
        const offset = (rowIdx * BYTES_PER_ROW).toString(16).padStart(4, "0");
        const ascii = row.map((b) => {
          const code = parseInt(b, 16);
          return code >= 32 && code <= 126 ? String.fromCharCode(code) : ".";
        }).join("");

        return (
          <div key={rowIdx} className="flex items-center gap-2 px-1 text-[9px] leading-5 hover:bg-accent-amber/5">
            <span className="text-accent-blue w-8 shrink-0">{offset}</span>
            <span className="flex-1 flex flex-wrap gap-x-1">
              {row.map((b, i) => {
                const isHighlighted = filterLower && filterLower.length >= 2 && b.toLowerCase().includes(filterLower.slice(0, 2));
                return (
                  <span key={i} className={isHighlighted ? "text-accent-amber font-bold bg-accent-amber/10 rounded px-0.5" : "text-text-secondary"}>
                    {b}
                  </span>
                );
              })}
            </span>
            <span className="text-text-muted w-[132px] shrink-0 tracking-widest">{ascii}</span>
          </div>
        );
      })}
      {rows.length > 20 && (
        <div className="text-[9px] text-text-muted text-center py-1">… {rows.length - 20} more rows ({bytes.length} bytes total)</div>
      )}
    </div>
  );
}

function ProbeCard({ test }: { test: SecurityTest }) {
  const [expanded, setExpanded] = useState(false);
  const [viewLayer, setViewLayer] = useState<"unprotected" | "layer1" | "layer2" | "protected">("unprotected");

  const results = {
    unprotected: { result: test.unprotectedResult, detail: test.unprotectedDetail, output: test.actualOutput.unprotected },
    layer1: { result: test.layer1Result, detail: test.layer1Detail, output: test.actualOutput.layer1 },
    layer2: { result: test.layer2Result, detail: test.layer2Detail, output: test.actualOutput.layer2 },
    protected: { result: test.protectedResult, detail: test.protectedDetail, output: test.actualOutput.protected },
  };

  const current = results[viewLayer];
  const style = RESULT_STYLES[current.result];

  return (
    <div className="mb-1.5 bg-bg-card border border-border-default rounded-lg overflow-hidden">
      <div
        className="px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-bg-primary/30 transition-all"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[9px] text-text-muted w-24 shrink-0">{test.id}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-text-primary truncate">{test.name}</div>
          <div className="text-[9px] text-text-muted mt-0.5">Hop {test.hop} · {test.attackVector}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(["unprotected", "layer1", "layer2", "protected"] as const).map((layer) => {
            const r = results[layer];
            const s = RESULT_STYLES[r.result];
            return (
              <span key={layer} className={`px-1.5 py-0.5 text-[7px] font-bold rounded border ${s.bg} ${s.text}`}>
                {r.result === "FAIL" ? "✗" : r.result === "PASS" ? "✓" : "◐"}
              </span>
            );
          })}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-default px-3 py-3 bg-bg-primary/50 space-y-3">
          <p className="text-[10px] text-text-secondary font-sans leading-relaxed">{test.description}</p>

          {/* Probe I/O */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-card border border-border-default rounded p-2.5">
              <div className="text-[8px] font-bold text-accent-blue tracking-wider mb-1">PROBE INPUT</div>
              <div className="text-[9px] text-text-secondary break-all bg-bg-primary rounded p-2 font-mono">{test.probeInput}</div>
            </div>
            <div className="bg-bg-card border border-border-default rounded p-2.5">
              <div className="text-[8px] font-bold text-yellow-400 tracking-wider mb-1">EXPECTED OUTPUT (ATTACKER GOAL)</div>
              <div className="text-[9px] text-text-secondary break-all bg-bg-primary rounded p-2 font-mono">{test.expectedOutput}</div>
            </div>
          </div>

          {/* Layer selector */}
          <div className="flex gap-1">
            {(["unprotected", "layer1", "layer2", "protected"] as const).map((layer) => {
              const labels: Record<string, string> = { unprotected: "⚠ NONE", layer1: "🔒 L1:TLS", layer2: "🔗 L2:RELAY", protected: "🛡 FULL" };
              const r = results[layer];
              const s = RESULT_STYLES[r.result];
              return (
                <button
                  key={layer}
                  onClick={(e) => { e.stopPropagation(); setViewLayer(layer); }}
                  className={`px-2 py-1 text-[8px] font-bold rounded border transition-all ${
                    viewLayer === layer ? `${s.bg} ${s.text}` : "border-border-default text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {labels[layer]}
                </button>
              );
            })}
          </div>

          {/* Actual output for selected layer */}
          <div className={`border rounded-lg p-3 ${style.bg}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[9px] font-bold tracking-wider ${style.text}`}>{style.label}</span>
              <span className="text-[8px] text-text-muted">Risk: {test.monetaryRisk}</span>
            </div>
            <p className="text-[10px] text-text-secondary font-sans mb-2">{current.detail}</p>
            <div className="bg-bg-primary rounded p-2">
              <div className="text-[8px] font-bold text-text-muted tracking-wider mb-1">ACTUAL RESPONSE</div>
              <div className="text-[9px] text-text-secondary break-all font-mono">{current.output}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CTFCard({ flag }: { flag: CTFFlag }) {
  const [showHint, setShowHint] = useState(false);
  const [showFlag, setShowFlag] = useState(false);
  const ds = DIFF_LABELS[flag.difficulty];
  const layerIdx = flag.difficulty === "EASY" ? 0 : flag.difficulty === "MEDIUM" ? 1 : flag.difficulty === "HARD" ? 2 : 3;
  const layerNames = ["🔓 Cleartext", "🔒 TLS 1.3", "🛡️ TLS+Unlink", "🏰 TLS+Unlink+AES"];
  const layerColors = ["text-red-400 bg-red-500/10 border-red-500/30", "text-yellow-400 bg-yellow-500/10 border-yellow-500/30", "text-blue-400 bg-blue-500/10 border-blue-500/30", "text-purple-400 bg-purple-500/10 border-purple-500/30"];

  return (
    <div className={`bg-bg-card border rounded-lg overflow-hidden ${flag.captured ? "border-green-500/40" : "border-border-default"}`}>
      <div className="px-3 py-2.5 flex items-center gap-3">
        <span className={`text-sm ${flag.captured ? "opacity-100" : "opacity-40"}`}>{flag.captured ? "🚩" : "⬜"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-text-muted">{flag.id}</span>
            <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded border ${ds.color}`}>{flag.difficulty}</span>
            <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded border ${layerColors[layerIdx]}`}>{layerNames[layerIdx]}</span>
            <span className="text-[9px] text-purple-400 font-bold">{flag.points}pts</span>
          </div>
          <div className="text-[10px] font-bold text-text-primary mt-0.5">{flag.challenge}</div>
          <div className="text-[9px] text-text-muted mt-0.5">Category: {flag.category} · Layer {layerIdx} encryption</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowHint(!showHint)}
            className="text-[8px] px-2 py-1 rounded border border-border-default text-text-muted hover:text-yellow-400 hover:border-yellow-500/40 transition-all"
          >
            {showHint ? "HIDE HINT" : "💡 HINT"}
          </button>
          {flag.captured && (
            <button
              onClick={() => setShowFlag(!showFlag)}
              className="text-[8px] px-2 py-1 rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-all"
            >
              {showFlag ? "HIDE FLAG" : "VIEW FLAG"}
            </button>
          )}
        </div>
      </div>
      {(showHint || showFlag) && (
        <div className="border-t border-border-default px-3 py-2 bg-bg-primary/50 space-y-2">
          {showHint && (
            <div>
              <div className="text-[8px] font-bold text-yellow-400 tracking-wider mb-1">💡 HINT</div>
              <p className="text-[9px] text-text-secondary font-sans">{flag.hint}</p>
            </div>
          )}
          {showFlag && flag.captured && (
            <div>
              <div className="text-[8px] font-bold text-green-400 tracking-wider mb-1">🚩 FLAG</div>
              <div className="text-[10px] text-green-400 font-mono bg-black/30 rounded px-2 py-1 break-all select-all">{flag.flagValue}</div>
              <div className="text-[8px] font-bold text-text-muted tracking-wider mt-2 mb-1">EVIDENCE</div>
              <p className="text-[9px] text-text-secondary font-sans">{flag.evidence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
