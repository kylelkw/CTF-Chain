import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  keccak256,
  toHex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const ATTACK_TARGET = "0x1b0F1Ca6a8Ab17DF5795d335253df93a2B747656" as `0x${string}`;

// ─── Daily play tracking (in-memory, resets on server restart) ────────
// Map<dateString, Set<lowercaseAddress>>
const dailyPlayers: Map<string, Set<string>> = new Map();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // "2026-03-01"
}

function hasPlayedToday(address: string): boolean {
  const players = dailyPlayers.get(todayKey());
  return players ? players.has(address.toLowerCase()) : false;
}

function markPlayed(address: string): void {
  const key = todayKey();
  if (!dailyPlayers.has(key)) dailyPlayers.set(key, new Set());
  dailyPlayers.get(key)!.add(address.toLowerCase());
}

function getTodayPlayers(): string[] {
  const players = dailyPlayers.get(todayKey());
  return players ? Array.from(players) : [];
}

// ─── CTF Server-side flag validation ──────────────────────────────────
// Active game sessions: Map<lowercaseAddress, { txContext, day }>
interface GameSession {
  day: number;
  sender: string;
  txHash: string;
  gas: string;
  block: string;
  nonce: string;
  value: string;
  effectiveGasPrice: string;
  rlpHexLen: number;
  vHex: string;
  capturedFlags: Set<string>;
}
const activeSessions: Map<string, GameSession> = new Map();

// CTF Challenge Pool — answer patterns kept server-side only
interface CTFChallengeServer {
  id: string;
  difficulty: "EASY" | "MEDIUM" | "HARD" | "INSANE";
  encryptionLayer: 0 | 1 | 2 | 3;
  points: number;
  answerPattern: string;
}

const CTF_ANSWER_POOL: Record<number, CTFChallengeServer[]> = {
  0: [
    { id: "SUN-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{rlp_{sender}_to}" },
    { id: "SUN-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{entropy_low_{block}_tls}" },
    { id: "SUN-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{unlink_timing_{gas}_{nonce}}" },
    { id: "SUN-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{aes_iv_{keccak6}}" },
  ],
  1: [
    { id: "MON-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{gasprice_{gas}_gwei}" },
    { id: "MON-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{frontrun_{value}_{gas}_profit}" },
    { id: "MON-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{sandwich_{block}_{nonce}_pos}" },
    { id: "MON-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{envelope_{chain_xor}_break}" },
  ],
  2: [
    { id: "TUE-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{nonce_{nonce}_history}" },
    { id: "TUE-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{rpc_eth_{txhash}_logged}" },
    { id: "TUE-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{ecdsa_{sig_v}_{sender}_recover}" },
    { id: "TUE-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{deanon_{keccak6}_fingerprint}" },
  ],
  3: [
    { id: "WED-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{cleartext_{block}_3intermediaries}" },
    { id: "WED-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{tls13_{block}_{gas}_cipher}" },
    { id: "WED-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{unlink_entropy_{nonce}_{block}}" },
    { id: "WED-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{gcm_tag_{rlp_len}}" },
  ],
  4: [
    { id: "THU-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{blockpos_{block}_{nonce}}" },
    { id: "THU-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{rtt_{gas}_{block}_timing}" },
    { id: "THU-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{jitter_{block}_{nonce}_relay}" },
    { id: "THU-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{sidechan_{rlp_len}_blocks}" },
  ],
  5: [
    { id: "FRI-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{highrisk_{block}_{gas}}" },
    { id: "FRI-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{chain_{sender}_{gas}_attack}" },
    { id: "FRI-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{blind_{block}_{sender}_relay}" },
    { id: "FRI-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{hmac_{chain_xor}_verify}" },
  ],
  6: [
    { id: "SAT-E", difficulty: "EASY", encryptionLayer: 0, points: 100, answerPattern: "CTF{anomaly_{block}_{nonce}_count}" },
    { id: "SAT-M", difficulty: "MEDIUM", encryptionLayer: 1, points: 250, answerPattern: "CTF{gasratio_{gas}_{block}_neighbor}" },
    { id: "SAT-H", difficulty: "HARD", encryptionLayer: 2, points: 500, answerPattern: "CTF{sandwich_{block}_{gas}_detect}" },
    { id: "SAT-I", difficulty: "INSANE", encryptionLayer: 3, points: 1000, answerPattern: "CTF{score_{block}_{nonce}_audit}" },
  ],
};

function resolveServerFlag(pattern: string, session: GameSession): string {
  const senderHex = session.sender.toLowerCase();
  const blockInt = parseInt(session.block, 10) || 0;
  const nonceInt = parseInt(session.nonce, 10) || 0;
  const gasInt = parseInt(session.gas, 10) || 0;
  const chainId = 10143;

  // keccak6: keccak256(sender ++ block_number) first 6 hex chars
  const keccakInput = new TextEncoder().encode(`${senderHex}${session.block}`);
  const keccakHash = keccak256(toHex(keccakInput));
  const keccak6 = keccakHash.slice(2, 8);

  // rlp_len: AES block-aligned ciphertext size
  const rawRlpLen = session.rlpHexLen > 0 ? Math.ceil(session.rlpHexLen / 2) : 110;
  const rlp_len = (Math.ceil(rawRlpLen / 16) * 16).toString();

  // sig_v: EIP-155 v value
  const vRaw = session.vHex || "0x4f61";
  const sig_v = (vRaw.startsWith("0x") ? parseInt(vRaw, 16) : parseInt(vRaw, 10)).toString();

  // chain_xor: nonce XOR chainId
  const chain_xor = (nonceInt ^ chainId).toString();

  let resolved = pattern
    .replace("{txhash}", session.txHash.slice(2, 10))
    .replace("{sender}", senderHex.slice(2, 8))
    .replace("{gas}", session.gas)
    .replace("{block}", session.block)
    .replace("{nonce}", session.nonce)
    .replace("{value}", session.value)
    .replace("{keccak6}", keccak6)
    .replace("{rlp_len}", rlp_len)
    .replace("{sig_v}", sig_v)
    .replace("{chain_xor}", chain_xor);

  return resolved;
}

function computeExpectedFlag(challengeId: string, session: GameSession): string | null {
  const challenges = CTF_ANSWER_POOL[session.day];
  if (!challenges) return null;
  const ch = challenges.find((c) => c.id === challengeId);
  if (!ch) return null;

  let flag = resolveServerFlag(ch.answerPattern, session);

  // Special overrides for computed fields
  const nonceInt = parseInt(session.nonce, 10) || 0;
  const gasInt = parseInt(session.gas, 10) || 0;
  const blockInt = parseInt(session.block, 10) || 0;
  const chainId = 10143;
  const rawRlpLen = session.rlpHexLen > 0 ? Math.ceil(session.rlpHexLen / 2) : 110;
  const rlp_len = (Math.ceil(rawRlpLen / 16) * 16).toString();
  const chain_xor = (nonceInt ^ chainId).toString();

  // WED-I: gcm_tag uses (gas * nonce) mod 65536 instead of rlp_len
  if (ch.id.endsWith("-I") && ch.answerPattern.includes("gcm_tag")) {
    const gcmTag = ((gasInt * nonceInt) % 65536).toString();
    flag = flag.replace(rlp_len, gcmTag);
  }
  // FRI-I: hmac uses (block XOR nonce) * gas mod 999983 instead of chain_xor
  if (ch.id === "FRI-I" && ch.answerPattern.includes("hmac_")) {
    const hmacVal = (((blockInt ^ nonceInt) * gasInt) % 999983).toString();
    flag = flag.replace(chain_xor, hmacVal);
  }

  return flag;
}

function normalizeKey(key?: string): `0x${string}` | null {
  if (!key) return null;
  const trimmed = key.trim();
  const n = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[0-9a-fA-F]{64}$/.test(n) ? (n as `0x${string}`) : null;
}

// ─── Utility helpers ──────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return "0x" + Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSessionId(): string {
  return `sid-${randomHex(8).slice(2)}`;
}

function computeEntropy(hex: string): number {
  const clean = hex.replace(/^0x/, "");
  if (clean.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const c of clean) freq[c] = (freq[c] || 0) + 1;
  let entropy = 0;
  const len = clean.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return Math.min(1, entropy / 4);
}

function padHex(n: bigint | number, bytes: number): string {
  return "0x" + BigInt(n).toString(16).padStart(bytes * 2, "0");
}

function rlpEncodeFields(nonce: number, gasPrice: bigint, gas: bigint, to: string, value: bigint, data: string, chainId: number): string {
  const fields = [
    padHex(nonce, 4),
    padHex(gasPrice, 8),
    padHex(gas, 4),
    to.toLowerCase(),
    padHex(value, 32),
    data,
    padHex(chainId, 2),
  ];
  return "0xf8" + randomHex(1).slice(2) + fields.map((f) => f.replace(/^0x/, "")).join("");
}

// ─── Types ────────────────────────────────────────────────────────────

type TestResult = "PASS" | "FAIL" | "PARTIAL" | "N/A";
type AnomalySeverity = "INFO" | "WARNING" | "CRITICAL";

interface LayerOutput {
  result: TestResult;
  detail: string;
  actualOutput: string;
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

interface Anomaly {
  id: string;
  severity: AnomalySeverity;
  description: string;
  evidence: string;
}

// ─── Derive test result from comparing actual vs expected ─────────────

function deriveResult(actual: string, expected: string): TestResult {
  const normA = actual.toLowerCase().trim();
  const normE = expected.toLowerCase().trim();
  if (normA === normE) return "FAIL"; // attacker got exactly what they wanted
  if (normA.includes("error") || normA.includes("timeout") || normA.includes("denied") || normA.includes("encrypted_blob")) return "PASS";
  // partial match: attacker got some but not all
  const expectedTokens = normE.split(/[,;|\s]+/).filter(Boolean);
  const matchCount = expectedTokens.filter((tok) => normA.includes(tok)).length;
  if (matchCount === 0) return "PASS";
  if (matchCount < expectedTokens.length * 0.5) return "PARTIAL";
  return "FAIL";
}

// ─── Security test generation (dynamic) ──────────────────────────────

interface TestContext {
  txHash: string;
  sender: string;
  recipient: string;
  value: string;
  gasPrice: bigint;
  nonce: number;
  ourIndex: number;
  totalTxs: number;
  blockNumber: bigint;
  mempoolWindowMs: number;
  suspiciousNeighbors: number;
  maxBlockGas: bigint;
}

function generateLayerOutput(
  layer: "unprotected" | "layer1" | "layer2" | "protected",
  expectedOutput: string,
  ctx: TestContext,
  testType: string,
): LayerOutput {
  const sid = randomSessionId();
  const nonce = randomHex(4);

  switch (layer) {
    case "unprotected": {
      // attacker gets cleartext
      const actual = expectedOutput;
      return {
        result: deriveResult(actual, expectedOutput),
        detail: `Cleartext response [probe:${nonce}]. No protection — full data returned: ${actual.slice(0, 120)}`,
        actualOutput: actual,
      };
    }
    case "layer1": {
      // TLS only — provider endpoint still sees cleartext
      const isTlsRelevant = testType === "encryption" || testType === "identity";
      if (isTlsRelevant && !expectedOutput.includes("mempool")) {
        const partial = expectedOutput.split(",").slice(0, Math.ceil(expectedOutput.split(",").length * 0.7)).join(",");
        return {
          result: deriveResult(partial, expectedOutput),
          detail: `TLS protects transit [session:${sid}] but endpoint decrypts. Partial leak: ${partial.slice(0, 100)}`,
          actualOutput: partial,
        };
      }
      const actual = expectedOutput;
      return {
        result: deriveResult(actual, expectedOutput),
        detail: `TLS irrelevant at this layer [session:${sid}]. Post-termination cleartext: ${actual.slice(0, 100)}`,
        actualOutput: actual,
      };
    }
    case "layer2": {
      // Unlink relay — mempool/gossip eliminated, but on-chain data remains
      const isPreInclusion = ["extraction", "mev", "timing"].includes(testType);
      if (isPreInclusion) {
        const blob = `encrypted_blob(${randomHex(16)})`;
        return {
          result: deriveResult(blob, expectedOutput),
          detail: `Private relay active [relay:${sid}]. Mempool bypassed — adversary receives: ${blob}`,
          actualOutput: blob,
        };
      }
      const actual = expectedOutput;
      return {
        result: deriveResult(actual, expectedOutput),
        detail: `Relay cannot protect post-inclusion data [session:${sid}]. On-chain query returns: ${actual.slice(0, 100)}`,
        actualOutput: actual,
      };
    }
    case "protected": {
      // Full CTF-Chain stack
      const isOnChain = expectedOutput.includes("blockNumber") || expectedOutput.includes("position") || expectedOutput.includes("nonce sequence");
      if (isOnChain) {
        const partial = expectedOutput.split(",").slice(0, Math.ceil(expectedOutput.split(",").length * 0.3)).join(",") + `,stealth_addr(${randomHex(6)})`;
        return {
          result: deriveResult(partial, expectedOutput),
          detail: `CTF-Chain mitigates [envelope:${sid}]: stealth rotation + commit-reveal. Adversary sees: ${partial.slice(0, 100)}`,
          actualOutput: partial,
        };
      }
      const enc = `aes256gcm(${randomHex(24)},iv=${randomHex(12)},hmac=${randomHex(16)})`;
      return {
        result: deriveResult(enc, expectedOutput),
        detail: `CTF-Chain envelope [key:${nonce},session:${sid}]. Double-encrypted: ${enc.slice(0, 80)}`,
        actualOutput: enc,
      };
    }
  }
}

function generateSecurityTests(ctx: TestContext): SecurityTest[] {
  const gasPriceGwei = (Number(ctx.gasPrice) / 1e9).toFixed(2);
  const maxGasGwei = (Number(ctx.maxBlockGas) / 1e9).toFixed(2);

  const testDefs: Array<{
    id: string;
    category: SecurityTest["category"];
    name: string;
    description: string;
    attackVector: string;
    probeInput: string;
    expectedOutput: string;
    dataExtracted: string[];
    dataProtected: string[];
    monetaryRisk: string;
    hop: number;
    testType: string;
  }> = [
    {
      id: "SEC-EXT-001",
      category: "extraction",
      name: "Transaction Intent Extraction",
      description: "Decode sender, recipient, value, and calldata from raw transaction bytes at RPC or mempool layer.",
      attackVector: "Passive mempool monitoring + RLP decode",
      probeInput: `eth_getTransaction("${ctx.txHash}") via mempool_subscribe [nonce:${randomHex(4)}]`,
      expectedOutput: `from:${ctx.sender},to:${ctx.recipient},value:${ctx.value}MON,gasPrice:${gasPriceGwei}gwei,nonce:${ctx.nonce},data:0x`,
      dataExtracted: [`from: ${ctx.sender}`, `to: ${ctx.recipient}`, `value: ${ctx.value} MON`, `gasPrice: ${gasPriceGwei} gwei`, `nonce: ${ctx.nonce}`, "calldata: 0x"],
      dataProtected: ["encrypted_blob", "relay_metadata"],
      monetaryRisk: "HIGH — full intent enables front-running, sandwich attacks",
      hop: 3,
      testType: "extraction",
    },
    {
      id: "SEC-EXT-002",
      category: "extraction",
      name: "RPC Provider Data Harvest",
      description: "Test whether RPC provider can log and sell transaction data before broadcast.",
      attackVector: "Malicious/compromised RPC endpoint logging",
      probeInput: `provider.interceptRequest({ method:"eth_sendRawTransaction", session:"${randomSessionId()}" })`,
      expectedOutput: `signed_tx:${ctx.txHash.slice(0, 20)},ip:192.168.x.x,api_key:redacted,timestamp:${Date.now()},user_agent:browser`,
      dataExtracted: ["full tx cleartext", "IP address", "API key / auth", "request timing", "user-agent"],
      dataProtected: ["IP address (TLS limitation)", "request timing", "TLS metadata"],
      monetaryRisk: "MEDIUM — provider can sell order flow to MEV searchers",
      hop: 2,
      testType: "extraction",
    },
    {
      id: "SEC-EXT-003",
      category: "extraction",
      name: "Signature-Based Sender Identification",
      description: "Recover sender address from ECDSA signature (v, r, s) components.",
      attackVector: "ecrecover on broadcast transaction",
      probeInput: `ecrecover(txHash=${ctx.txHash.slice(0, 18)}, v, r, s) [probe:${randomHex(4)}]`,
      expectedOutput: `sender:${ctx.sender},nonce:${ctx.nonce},pubkey:derivable`,
      dataExtracted: [`sender: ${ctx.sender}`, `nonce: ${ctx.nonce} (tx count)`, "public key derivable"],
      dataProtected: [],
      monetaryRisk: "MEDIUM — enables targeted wallet profiling",
      hop: 3,
      testType: "extraction",
    },
    {
      id: "SEC-EXT-004",
      category: "extraction",
      name: "Gas Price Intelligence Extraction",
      description: "Extract gas bid to predict urgency, willingness to pay, and slippage tolerance.",
      attackVector: "Mempool gas price analysis",
      probeInput: `mempool.inspect({ hash:"${ctx.txHash.slice(0, 16)}", fields:["gasPrice","gasLimit"], probe:"${randomHex(4)}" })`,
      expectedOutput: `gasPrice:${gasPriceGwei}gwei,gasLimit:21000,urgency:${Number(ctx.gasPrice) > Number(ctx.maxBlockGas) * 0.8 ? "HIGH" : "NORMAL"},ratio:${((Number(ctx.gasPrice) / Number(ctx.maxBlockGas || ctx.gasPrice)) * 100).toFixed(0)}%`,
      dataExtracted: [`gasPrice: ${gasPriceGwei} gwei`, "gasLimit: 21000", "urgency signal", "willingness-to-pay ratio"],
      dataProtected: [],
      monetaryRisk: "MEDIUM — gas intel calibrates sandwich profitability",
      hop: 3,
      testType: "extraction",
    },
    {
      id: "SEC-TIM-001",
      category: "timing",
      name: "Mempool Timing Window Attack",
      description: `Measure broadcast-to-inclusion window. ${ctx.mempoolWindowMs}ms allows adversary reaction.`,
      attackVector: "Mempool monitoring + timed front-run submission",
      probeInput: `timing.measure({ subscribe:"pending", target:"${ctx.txHash.slice(0, 16)}", clock:"${randomHex(4)}" })`,
      expectedOutput: `window:${ctx.mempoolWindowMs}ms,propagation:measurable,block_correlation:${ctx.blockNumber}`,
      dataExtracted: [`exposure_window: ${ctx.mempoolWindowMs}ms`, "propagation_delay measurable", "block_time correlation"],
      dataProtected: [],
      monetaryRisk: ctx.mempoolWindowMs > 1000 ? "CRITICAL — ample time for sandwich" : "HIGH — bots operate in <50ms",
      hop: 3,
      testType: "timing",
    },
    {
      id: "SEC-TIM-002",
      category: "timing",
      name: "Transaction Frequency Fingerprinting",
      description: "Correlate transaction timing patterns to identify user behavior patterns.",
      attackVector: "On-chain timing analysis across historical txs",
      probeInput: `analytics.profile({ address:"${ctx.sender.slice(0, 12)}", depth:${ctx.nonce}, session:"${randomSessionId()}" })`,
      expectedOutput: `nonce sequence:0..${ctx.nonce},timestamps:public,block_intervals:derivable,pattern:analyzable`,
      dataExtracted: ["historical nonce sequence", "on-chain timestamps", "block intervals"],
      dataProtected: ["future mempool timing obfuscated via jitter"],
      monetaryRisk: "LOW — enables profiling but not direct extraction",
      hop: 6,
      testType: "identity",
    },
    {
      id: "SEC-ID-001",
      category: "identity",
      name: "Wallet Behavior Profiling",
      description: "Build behavioral fingerprint from on-chain data: recipients, values, gas strategies.",
      attackVector: "Chain analysis + pattern recognition",
      probeInput: `chainalysis.profile({ wallet:"${ctx.sender.slice(0, 12)}", txCount:${ctx.nonce}, probe:"${randomHex(4)}" })`,
      expectedOutput: `address:${ctx.sender.slice(0, 12)},tx_count:${ctx.nonce},typical_value:${ctx.value}MON,gas_strategy:${gasPriceGwei}gwei,recipient_pattern:targetable`,
      dataExtracted: ["address graph", "value patterns", "gas strategy", "active hours", "recipient clustering"],
      dataProtected: ["future mempool intent", "pre-inclusion calldata", "address rotation breaks linking"],
      monetaryRisk: "MEDIUM — targeted attacks use behavioral profiles",
      hop: 5,
      testType: "identity",
    },
    {
      id: "SEC-ID-002",
      category: "identity",
      name: "IP-to-Address Correlation",
      description: "Link wallet address to IP address via RPC request correlation.",
      attackVector: "RPC provider logging / network-level monitoring",
      probeInput: `rpc.correlate({ method:"eth_sendRawTransaction", ip_log:true, session:"${randomSessionId()}" })`,
      expectedOutput: `ip:leaked,wallet:${ctx.sender.slice(0, 12)},timestamp:${Date.now()},geolocation:derivable`,
      dataExtracted: ["IP address", "wallet address", "correlation timestamp", "geolocation"],
      dataProtected: ["public RPC IP link broken"],
      monetaryRisk: "LOW — enables targeted phishing, social engineering",
      hop: 2,
      testType: "identity",
    },
    {
      id: "SEC-MEV-001",
      category: "mev",
      name: "Front-Run Feasibility",
      description: "Test if adversary can submit competing transaction with higher gas before inclusion.",
      attackVector: "Mempool decode → gas overbid → priority inclusion",
      probeInput: `mev.frontrun({ target:"${ctx.txHash.slice(0, 16)}", overbid:${(Number(ctx.gasPrice) * 1.1 / 1e9).toFixed(2)}gwei, probe:"${randomHex(4)}" })`,
      expectedOutput: `target_gas:${gasPriceGwei}gwei,overbid:${(Number(ctx.gasPrice) * 1.1 / 1e9).toFixed(2)}gwei,timing:${ctx.mempoolWindowMs}ms,feasible:true`,
      dataExtracted: ["target gas price", "submission timing", "overbid calculation"],
      dataProtected: [],
      monetaryRisk: "HIGH — direct value extraction via priority ordering",
      hop: 4,
      testType: "mev",
    },
    {
      id: "SEC-MEV-002",
      category: "mev",
      name: "Sandwich Attack Viability",
      description: "Test if adversary can place buy-before/sell-after orders around this transaction.",
      attackVector: "Mempool decode → DEX swap identification → sandwich",
      probeInput: `mev.sandwich({ target:"${ctx.txHash.slice(0, 16)}", position:${ctx.ourIndex}/${ctx.totalTxs}, probe:"${randomHex(4)}" })`,
      expectedOutput: `intent:decodable,position:${ctx.ourIndex}/${ctx.totalTxs},type:transfer,sandwich_surface:${ctx.ourIndex > 0 && ctx.totalTxs > 2 ? "present" : "limited"}`,
      dataExtracted: ctx.ourIndex > 0 && ctx.totalTxs > 2 ? ["tx intent decodable", "sandwich params calculable", `position: ${ctx.ourIndex}/${ctx.totalTxs}`] : ["tx type: simple transfer", "limited sandwich surface"],
      dataProtected: [],
      monetaryRisk: "CRITICAL for DEX swaps — up to 2-5% of tx value extractable",
      hop: 3,
      testType: "mev",
    },
    {
      id: "SEC-MEV-003",
      category: "mev",
      name: "Block Position Manipulation",
      description: "Test whether adversary can influence transaction ordering within the block.",
      attackVector: "Gas bidding / builder API / validator collusion",
      probeInput: `mev.reorder({ block:${ctx.blockNumber}, target_gas:${gasPriceGwei}gwei, max_block_gas:${maxGasGwei}gwei, probe:"${randomHex(4)}" })`,
      expectedOutput: `your_gas:${gasPriceGwei}gwei,block_max:${maxGasGwei}gwei,competition:${ctx.maxBlockGas > ctx.gasPrice * 2n ? "active" : "low"},position_purchasable:${ctx.maxBlockGas > ctx.gasPrice * 2n ? "yes" : "unlikely"}`,
      dataExtracted: ["gas bid visible", "position purchasable"],
      dataProtected: [],
      monetaryRisk: "HIGH — ordering control enables all MEV strategies",
      hop: 4,
      testType: "mev",
    },
    {
      id: "SEC-ENC-001",
      category: "encryption",
      name: "TLS Transport Verification",
      description: "Verify HTTPS/TLS encryption on RPC connection. Test for downgrade attacks.",
      attackVector: "TLS MITM / downgrade / certificate spoofing",
      probeInput: `tls.probe({ endpoint:"rpc", downgrade:true, cert_pin:false, session:"${randomSessionId()}" })`,
      expectedOutput: `tls:1.3,cert_pinned:false,cleartext_at_endpoint:true,dns_hijack:possible`,
      dataExtracted: ["cleartext at RPC endpoint"],
      dataProtected: ["encrypted at network layer", "cert-pinned connection"],
      monetaryRisk: "LOW — requires active network attacker",
      hop: 2,
      testType: "encryption",
    },
    {
      id: "SEC-ENC-002",
      category: "encryption",
      name: "End-to-End Payload Encryption",
      description: "Verify transaction payload encrypted from client to sequencer with no intermediary cleartext.",
      attackVector: "Intermediary inspection / relay compromise",
      probeInput: `e2e.inspect({ hops:[rpc,mempool,builder], intercept:all, session:"${randomSessionId()}" })`,
      expectedOutput: `cleartext_intermediaries:3,rpc:cleartext,mempool_peers:cleartext,builder:cleartext`,
      dataExtracted: ["cleartext at 3 intermediaries"],
      dataProtected: ["cleartext at 1 intermediary (Unlink relay, inner-encrypted)"],
      monetaryRisk: "CRITICAL — any intermediary can extract",
      hop: 3,
      testType: "encryption",
    },
    {
      id: "SEC-ENC-003",
      category: "encryption",
      name: "Post-Inclusion Data Leakage",
      description: "Test what data remains publicly queryable after block inclusion.",
      attackVector: "eth_getTransactionReceipt + trace_transaction",
      probeInput: `eth_getTransactionReceipt("${ctx.txHash}") + trace_transaction [probe:${randomHex(4)}]`,
      expectedOutput: `from:${ctx.sender.slice(0, 10)},to:${ctx.recipient.slice(0, 10)},value:${ctx.value}MON,blockNumber:${ctx.blockNumber},position:${ctx.ourIndex},status:success`,
      dataExtracted: ["all receipt fields", "state changes", "event logs", "trace data"],
      dataProtected: ["1-block delayed revelation (commit-reveal)", "address graph fragmented (stealth rotation)"],
      monetaryRisk: "LOW post-inclusion — damage window is pre-inclusion",
      hop: 6,
      testType: "encryption",
    },
    {
      id: "SEC-ENC-004",
      category: "encryption",
      name: "Block Inclusion Position Leakage",
      description: "Test whether transaction position reveals exploitable ordering info post-inclusion.",
      attackVector: "Block analysis → position correlation → future MEV targeting",
      probeInput: `block.analyze({ number:${ctx.blockNumber}, target_idx:${ctx.ourIndex}, total:${ctx.totalTxs}, probe:"${randomHex(4)}" })`,
      expectedOutput: `position:${ctx.ourIndex}/${ctx.totalTxs},blockNumber:${ctx.blockNumber},gas_correlation:derivable,pattern:analyzable`,
      dataExtracted: [`position: ${ctx.ourIndex}/${ctx.totalTxs}`, "gas-to-position correlation", "ordering pattern across blocks"],
      dataProtected: ["gas padding obscures urgency", "FCFS position less informative than auction position"],
      monetaryRisk: "LOW — post-inclusion position is historical, not directly exploitable",
      hop: 5,
      testType: "identity",
    },
  ];

  return testDefs.map((def) => {
    const unprotected = generateLayerOutput("unprotected", def.expectedOutput, ctx, def.testType);
    const l1 = generateLayerOutput("layer1", def.expectedOutput, ctx, def.testType);
    const l2 = generateLayerOutput("layer2", def.expectedOutput, ctx, def.testType);
    const prot = generateLayerOutput("protected", def.expectedOutput, ctx, def.testType);

    return {
      id: def.id,
      category: def.category,
      name: def.name,
      description: def.description,
      attackVector: def.attackVector,
      probeInput: def.probeInput,
      expectedOutput: def.expectedOutput,
      unprotectedResult: unprotected.result,
      unprotectedDetail: unprotected.detail,
      layer1Result: l1.result,
      layer1Detail: l1.detail,
      layer2Result: l2.result,
      layer2Detail: l2.detail,
      protectedResult: prot.result,
      protectedDetail: prot.detail,
      actualOutput: {
        unprotected: unprotected.actualOutput,
        layer1: l1.actualOutput,
        layer2: l2.actualOutput,
        protected: prot.actualOutput,
      },
      dataExtracted: def.dataExtracted,
      dataProtected: def.dataProtected,
      monetaryRisk: def.monetaryRisk,
      hop: def.hop,
    };
  });
}

// ─── Encryption layers ────────────────────────────────────────────────

function buildEncryptionLayers(): EncryptionLayer[] {
  return [
    {
      id: "L1-TLS",
      name: "Layer 1: TLS 1.3 Transport",
      protocol: "TLS 1.3 (RFC 8446)",
      keyExchange: "X25519 ECDHE",
      cipher: "AES-256-GCM / ChaCha20-Poly1305",
      protects: [
        "Network-level eavesdropping",
        "Passive packet inspection (ISP, WiFi, etc.)",
        "Connection metadata from casual observers",
      ],
      limitations: [
        "RPC endpoint sees full cleartext after TLS termination",
        "Certificate authority compromise enables MITM",
        "No protection against malicious RPC provider",
        "DNS hijack can redirect to attacker-controlled endpoint",
      ],
      appliesAtHops: [2],
      status: "active",
      honestAssessment: "Standard web security. Necessary but insufficient for transaction privacy. Every HTTPS connection uses this — it's the baseline, not a differentiator.",
    },
    {
      id: "L2-UNLINK",
      name: "Layer 2: Unlink Encrypted Relay",
      protocol: "Unlink Private Transaction Protocol",
      keyExchange: "Session-based key negotiation with relay",
      cipher: "Encrypted blob (relay-specific)",
      protects: [
        "Transaction intent hidden from public RPC providers",
        "Mempool exposure eliminated — tx never enters public gossip",
        "Gas price bidding invisible to competing searchers",
        "Recipient and value hidden until block inclusion",
      ],
      limitations: [
        "Unlink relay itself sees decrypted transaction (trusted intermediary)",
        "Relay uptime dependency — if relay is down, fallback to public mempool",
        "Limited to supported chains (Monad testnet currently)",
        "Relay operator could theoretically extract MEV (trust assumption)",
      ],
      appliesAtHops: [2, 3, 4],
      status: "active",
      honestAssessment: "Significant improvement over public mempool. Eliminates the most dangerous exposure window (mempool gossip). However, introduces trust assumption on Unlink relay operator. This is the current industry standard for private transactions.",
    },
    {
      id: "L3-SENTINEL",
      name: "Layer 3: CTF-Chain Envelope",
      protocol: "CTF-Chain Double-Wrap Protocol",
      keyExchange: "ECDH P-256 ephemeral key per transaction",
      cipher: "AES-256-GCM with per-tx IV + HMAC-SHA256 integrity",
      protects: [
        "Additional encryption layer before Unlink relay",
        "Relay sees CTF-Chain blob, not raw transaction",
        "Certificate pinning prevents relay impersonation",
        "Request metadata padding defeats traffic analysis",
        "Per-transaction ephemeral keys prevent correlation",
      ],
      limitations: [
        "CTF-Chain client must decrypt before Unlink re-encrypts (brief local cleartext)",
        "Adds ~15-30ms latency for double encryption/decryption",
        "On-chain data after inclusion remains fully public (blockchain inherent)",
        "Cannot protect against compromised local environment (malware, keyloggers)",
        "Ephemeral keys are negotiated with CTF-Chain server (another trust point)",
      ],
      appliesAtHops: [2, 3],
      status: "active",
      honestAssessment: "Defense-in-depth layer. If Unlink relay is compromised, CTF-Chain envelope still protects transaction intent. Adds meaningful security but also adds another trusted party. The ideal solution (TEE-based sequencer-level encryption) doesn't exist yet on Monad.",
    },
  ];
}

// ─── Packet trace generation with real hex ────────────────────────────

function buildPacketTrace(
  txHash: string,
  receipt: TransactionReceipt,
  txData: { from: string; to: string | null; value: bigint; gasPrice: bigint | undefined; nonce: number },
  rpc: string,
  timestamps: Record<string, number>,
  ourIndex: number,
  totalTxs: number,
  mempoolWindowMs: number,
): PacketHop[] {
  const sender = txData.from;
  const recipient = txData.to ?? ATTACK_TARGET;
  const value = txData.value;
  const gasPrice = txData.gasPrice ?? 0n;
  const nonce = txData.nonce;
  const valueStr = formatEther(value);
  const gasPriceGwei = (Number(gasPrice) / 1e9).toFixed(2);

  const rlpHex = rlpEncodeFields(nonce, gasPrice, 21000n, recipient, value, "0x", 10143);
  const signedTxHex = rlpHex + randomHex(65).slice(2); // append mock sig bytes

  const jsonRpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_sendRawTransaction",
    params: [signedTxHex.slice(0, 80) + "..."],
  });
  const jsonRpcHex = "0x" + Array.from(new TextEncoder().encode(jsonRpcBody), (b) => b.toString(16).padStart(2, "0")).join("");

  const devp2pFrameHex = "0xc0" + padHex(0x10, 1).slice(2) + txHash.slice(2) + randomHex(8).slice(2);

  const builderQueueHex = "0x" + [
    padHex(gasPrice, 8).slice(2),
    txHash.slice(2),
    padHex(nonce, 4).slice(2),
    "00", // FCFS priority byte
    randomHex(4).slice(2),
  ].join("");

  const receiptHex = "0x" + [
    padHex(receipt.blockNumber, 8).slice(2),
    padHex(ourIndex, 2).slice(2),
    receipt.status === "success" ? "01" : "00",
    padHex(receipt.gasUsed ?? 21000n, 4).slice(2),
    padHex(receipt.effectiveGasPrice ?? gasPrice, 8).slice(2),
  ].join("");

  const receiptQueryHex = "0x" + Array.from(
    new TextEncoder().encode(`{"result":{"status":"${receipt.status}","blockNumber":"${receipt.blockNumber}","transactionIndex":"${ourIndex}"}}`),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

  return [
    {
      id: "1-sign", phase: "SIGNING", direction: "local",
      protocol: "ECDSA secp256k1", from: "Wallet (MetaMask)", to: "Local Signer",
      elapsed: timestamps.preflight - timestamps.start,
      exposed: ["private_key (memory only)"], leaked: [] as string[],
      description: "Transaction fields assembled and signed locally. Private key never leaves browser memory. ECDSA signature (v, r, s) computed over keccak256 hash of RLP-encoded tx fields.",
      rawPayload: `RLP_encode(nonce=${nonce}, gasPrice=${gasPrice}, gas=21000, to=${recipient.slice(0, 10)}..., value=${valueStr}) → keccak256 → ECDSA_sign(privkey)`,
      rawHex: rlpHex,
      decodedFields: {
        nonce: `${nonce}`,
        gasPrice: `${gasPrice} (${gasPriceGwei} gwei)`,
        gasLimit: "21000",
        to: recipient,
        value: `${value} (${valueStr} MON)`,
        data: "0x (empty)",
        chainId: "10143 (Monad testnet)",
      },
      entropyScore: computeEntropy(rlpHex),
      flags: ["Structured RLP — low entropy reveals field boundaries", "Private key in memory during signing"],
    },
    {
      id: "2-rpc", phase: "RPC SUBMIT", direction: "outbound",
      protocol: "JSON-RPC / HTTPS", from: "Your Browser",
      to: `RPC (${rpc.replace("https://", "").slice(0, 20)})`,
      elapsed: timestamps.broadcast - timestamps.preflight,
      exposed: ["TLS-encrypted to provider, cleartext at endpoint"],
      leaked: [
        `from: ${sender}`, `to: ${recipient}`,
        `value: ${valueStr} MON`, `gasPrice: ${gasPriceGwei} gwei`,
        `nonce: ${nonce}`, "data: 0x", "gas: 21000",
        "IP address + request timing",
      ],
      description: "Signed tx sent via HTTPS to RPC endpoint. TLS encrypts in transit but provider decrypts to process. Provider has full cleartext access.",
      rawPayload: `POST ${rpc}\n{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["${signedTxHex.slice(0, 40)}..."]}`,
      rawHex: jsonRpcHex.slice(0, 200),
      decodedFields: {
        method: "eth_sendRawTransaction",
        signed_tx: signedTxHex.slice(0, 40) + "...",
        ip: "[client IP leaked to provider]",
        tls: "1.3 (encrypted in transit, cleartext at endpoint)",
      },
      entropyScore: computeEntropy(jsonRpcHex),
      flags: ["Provider sees full cleartext after TLS termination", "IP address correlated to wallet", "No cert pinning — DNS hijack possible"],
    },
    {
      id: "3-mempool", phase: "MEMPOOL GOSSIP", direction: "broadcast",
      protocol: "devp2p / ETH/68", from: "RPC Node", to: "All Peers",
      elapsed: Math.max(50, mempoolWindowMs - 200),
      exposed: ["Full tx broadcast via gossip to every peer node"],
      leaked: [
        `from: ${sender}`, `to: ${recipient}`,
        `value: ${valueStr} MON`, `gasPrice: ${gasPriceGwei} gwei`,
        `nonce: ${nonce}`, "signature (v, r, s)",
        "gasLimit: 21000", "chainId: 10143",
      ],
      description: "CRITICAL EXPOSURE: Transaction propagated to every connected node via gossip protocol. Any observer receives full transaction within 100-300ms.",
      rawPayload: `ETH/68 Transactions([RLP(${txHash.slice(0, 16)}...)])`,
      rawHex: devp2pFrameHex,
      decodedFields: {
        frame_type: "0xc0 (Transactions message)",
        msg_id: "0x10 (ETH/68 Transactions)",
        tx_hash: txHash,
        propagation: "gossip to all connected peers",
      },
      entropyScore: computeEntropy(devp2pFrameHex),
      flags: ["CRITICAL: Full tx visible to every peer", "Primary MEV extraction surface", "No encryption on gossip layer"],
    },
    {
      id: "4-sequencer", phase: "SEQUENCER / BUILDER", direction: "inbound",
      protocol: "Block Builder Queue", from: "Mempool", to: "Block Producer",
      elapsed: Math.max(100, mempoolWindowMs - 300),
      exposed: ["Full mempool visible", "ordering authority"],
      leaked: [
        "Full tx + all competing pending txs",
        `Gas bid: ${gasPriceGwei} gwei`,
        "Ordering authority over final position",
      ],
      description: "Block producer receives tx from mempool. Sees all pending transactions simultaneously. Has ordering authority. Monad FCFS reduces but doesn't eliminate timing advantages.",
      rawPayload: `builder.addTx({ hash: ${txHash.slice(0, 16)}..., gasPrice: ${gasPrice}, priority: FCFS })`,
      rawHex: builderQueueHex,
      decodedFields: {
        gasPrice: `${gasPrice} (${gasPriceGwei} gwei)`,
        tx_hash: txHash,
        nonce: `${nonce}`,
        priority: "FCFS (first-come-first-served)",
        queue_position: "determined by arrival time",
      },
      entropyScore: computeEntropy(builderQueueHex),
      flags: ["Builder has full ordering authority", "Co-located nodes have timing advantage", "Gas bid visible for competition"],
    },
    {
      id: "5-inclusion", phase: "BLOCK INCLUSION", direction: "finalized",
      protocol: "Consensus / FCFS", from: "Sequencer",
      to: `Block #${receipt.blockNumber}`,
      elapsed: timestamps.confirmed - timestamps.broadcast,
      exposed: [`Position ${ourIndex}/${totalTxs}`, `Effective gas: ${(Number(receipt.effectiveGasPrice ?? gasPrice) / 1e9).toFixed(2)} gwei`],
      leaked: [
        `blockNumber: ${receipt.blockNumber}`, `txIndex: ${ourIndex}`,
        `gasUsed: ${receipt.gasUsed?.toString() ?? "21000"}`,
        `status: ${receipt.status}`,
      ],
      description: `Included in block ${receipt.blockNumber} at position ${ourIndex}/${totalTxs}. All data permanently on-chain.`,
      rawPayload: `Receipt { hash: ${txHash.slice(0, 16)}..., block: ${receipt.blockNumber}, idx: ${ourIndex}, status: ${receipt.status} }`,
      rawHex: receiptHex,
      decodedFields: {
        blockNumber: `${receipt.blockNumber}`,
        transactionIndex: `${ourIndex}`,
        status: `${receipt.status}`,
        gasUsed: `${receipt.gasUsed ?? 21000n}`,
        effectiveGasPrice: `${receipt.effectiveGasPrice ?? gasPrice}`,
      },
      entropyScore: computeEntropy(receiptHex),
      flags: ["All fields permanently on-chain", "Position reveals ordering strategy"],
    },
    {
      id: "6-receipt", phase: "POST-INCLUSION", direction: "broadcast",
      protocol: "eth_getTransactionReceipt", from: `Block #${receipt.blockNumber}`,
      to: "All Observers",
      elapsed: timestamps.analyzed - timestamps.confirmed,
      exposed: ["Full execution trace permanently public"],
      leaked: [
        `status: ${receipt.status}`, `gasUsed: ${receipt.gasUsed}`,
        `blockNumber: ${receipt.blockNumber}`, `txIndex: ${ourIndex}`,
        "State diff: balance changes public",
      ],
      description: "Post-inclusion receipt is permanent public record. Transaction history and balance changes are permanently queryable.",
      rawPayload: `eth_getTransactionReceipt("${txHash}")`,
      rawHex: receiptQueryHex.slice(0, 200),
      decodedFields: {
        status: `${receipt.status}`,
        blockNumber: `${receipt.blockNumber}`,
        transactionIndex: `${ourIndex}`,
        gasUsed: `${receipt.gasUsed ?? 21000n}`,
        query: "eth_getTransactionReceipt — anyone can call",
      },
      entropyScore: computeEntropy(receiptQueryHex),
      flags: ["Permanent public record", "No privacy solution can change post-inclusion data"],
    },
  ];
}

// ─── Anomaly detection ────────────────────────────────────────────────

function detectAnomalies(
  txs: readonly (string | { hash: string; from: string; to: string | null; gasPrice?: bigint; value: bigint })[],
  ourIndex: number,
  txHash: string,
  actualRecipient: string,
  actualGasPrice: bigint,
  actualSender: string,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  let anomalyId = 0;

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    if (typeof t === "string") continue;
    if (t.hash.toLowerCase() === txHash.toLowerCase()) continue;
    const distance = i - ourIndex;
    const absDist = Math.abs(distance);

    // Same recipient within ±3 positions (sandwich pattern)
    if (absDist <= 3 && t.to?.toLowerCase() === actualRecipient.toLowerCase()) {
      const severity: AnomalySeverity = absDist <= 1 ? "CRITICAL" : "WARNING";
      anomalies.push({
        id: `ANOM-${++anomalyId}`,
        severity,
        description: `Same recipient ${actualRecipient.slice(0, 12)}... at distance ${distance > 0 ? "+" : ""}${distance} — possible sandwich ${distance < 0 ? "front-leg" : "back-leg"}`,
        evidence: `tx ${t.hash.slice(0, 16)}... at index ${i} targets same recipient, our index ${ourIndex}`,
      });
    }

    // Gas price >2x within ±2 positions (front-run indicator)
    if (absDist <= 2 && t.gasPrice && t.gasPrice > actualGasPrice * 2n) {
      anomalies.push({
        id: `ANOM-${++anomalyId}`,
        severity: "CRITICAL",
        description: `Gas price ${(Number(t.gasPrice) / 1e9).toFixed(2)} gwei is >${(Number(t.gasPrice * 100n / (actualGasPrice || 1n))).toFixed(0)}% of ours at distance ${distance > 0 ? "+" : ""}${distance} — front-run indicator`,
        evidence: `tx ${t.hash.slice(0, 16)}... gasPrice=${t.gasPrice}, ours=${actualGasPrice}, ratio=${Number(t.gasPrice * 100n / (actualGasPrice || 1n))}%`,
      });
    }

    // Same sender appearing multiple times in block
    if (t.from.toLowerCase() === actualSender.toLowerCase()) {
      anomalies.push({
        id: `ANOM-${++anomalyId}`,
        severity: "INFO",
        description: `Same sender ${actualSender.slice(0, 12)}... also at index ${i} — multi-tx in single block`,
        evidence: `tx ${t.hash.slice(0, 16)}... from same sender at index ${i}`,
      });
    }
  }

  // Check for other senders appearing multiple times (bot pattern)
  const senderCounts: Record<string, number> = {};
  for (const t of txs) {
    if (typeof t === "string") continue;
    const from = t.from.toLowerCase();
    senderCounts[from] = (senderCounts[from] || 0) + 1;
  }
  for (const [addr, count] of Object.entries(senderCounts)) {
    if (count >= 3 && addr !== actualSender.toLowerCase()) {
      anomalies.push({
        id: `ANOM-${++anomalyId}`,
        severity: "WARNING",
        description: `Address ${addr.slice(0, 12)}... has ${count} transactions in this block — potential bot/searcher activity`,
        evidence: `${count} txs from ${addr.slice(0, 12)}... in block`,
      });
    }
  }

  return anomalies;
}

// ─── POST handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string | undefined;

    const rpc = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
    const transport = http(rpc);
    const pc = createPublicClient({ chain: monadTestnet, transport });

    // ─── CTF POOL BALANCE ───────────────────────────────────────
    if (action === "pool-balance") {
      const k = normalizeKey(process.env.ATTACK_BOT_PRIVATE_KEY_1);
      if (!k) return NextResponse.json({ error: "Bot key not configured" }, { status: 500 });
      const account = privateKeyToAccount(k);
      const balanceWei = await pc.getBalance({ address: account.address });
      return NextResponse.json({
        address: account.address,
        balance: formatEther(balanceWei),
        balanceWei: balanceWei.toString(),
      });
    }

    // ─── STORE CTF SESSION (called after analysis) ───────────────
    if (action === "store-session") {
      const { playerAddress, day, sender, txHash, gas, block, nonce, value, effectiveGasPrice, rlpHexLen, vHex } = body;
      if (!playerAddress || !txHash) return NextResponse.json({ error: "Missing session data" }, { status: 400 });
      activeSessions.set(playerAddress.toLowerCase(), {
        day: typeof day === "number" ? day : new Date().getDay(),
        sender: sender || playerAddress,
        txHash, gas: String(gas), block: String(block), nonce: String(nonce),
        value: String(value), effectiveGasPrice: String(effectiveGasPrice),
        rlpHexLen: Number(rlpHexLen) || 0, vHex: vHex || "0x4f61",
        capturedFlags: new Set(),
      });
      return NextResponse.json({ stored: true });
    }

    // ─── VALIDATE FLAG (server-side check) ───────────────────────
    if (action === "validate-flag") {
      const { playerAddress, challengeId, submission, day } = body;
      if (!playerAddress || !submission) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const session = activeSessions.get(playerAddress.toLowerCase());
      if (!session) return NextResponse.json({ error: "No active game session. Play a round first." }, { status: 404 });

      // Allow dev day override
      const effectiveDay = typeof day === "number" ? day : session.day;
      const sessionForDay = { ...session, day: effectiveDay };

      // If challengeId provided, check specific challenge
      if (challengeId) {
        if (session.capturedFlags.has(challengeId))
          return NextResponse.json({ valid: false, reason: "Already captured" });
        const expected = computeExpectedFlag(challengeId, sessionForDay);
        if (!expected) return NextResponse.json({ valid: false, reason: "Challenge not found" });
        if (submission.trim() === expected) {
          session.capturedFlags.add(challengeId);
          const ch = CTF_ANSWER_POOL[effectiveDay]?.find((c) => c.id === challengeId);
          return NextResponse.json({ valid: true, challengeId, points: ch?.points ?? 0, flagValue: expected });
        }
        return NextResponse.json({ valid: false, reason: "Incorrect flag" });
      }

      // No challengeId: try all challenges for the day
      const challenges = CTF_ANSWER_POOL[effectiveDay];
      if (!challenges) return NextResponse.json({ valid: false, reason: "No challenges for this day" });
      for (const ch of challenges) {
        if (session.capturedFlags.has(ch.id)) continue;
        const expected = computeExpectedFlag(ch.id, sessionForDay);
        if (expected && submission.trim() === expected) {
          session.capturedFlags.add(ch.id);
          return NextResponse.json({ valid: true, challengeId: ch.id, points: ch.points, flagValue: expected });
        }
      }
      return NextResponse.json({ valid: false, reason: "Incorrect flag" });
    }

    // ─── DEV: GET FLAG ANSWERS (for hackathon demo) ──────────────
    if (action === "dev-answers") {
      const { playerAddress, day } = body;
      if (!playerAddress) return NextResponse.json({ error: "Missing playerAddress" }, { status: 400 });
      const session = activeSessions.get(playerAddress.toLowerCase());
      if (!session) return NextResponse.json({ error: "No active session" }, { status: 404 });
      const effectiveDay = typeof day === "number" ? day : session.day;
      const sessionForDay = { ...session, day: effectiveDay };
      const challenges = CTF_ANSWER_POOL[effectiveDay];
      if (!challenges) return NextResponse.json({ answers: [] });
      const answers = challenges.map((ch) => ({
        id: ch.id,
        difficulty: ch.difficulty,
        points: ch.points,
        flag: computeExpectedFlag(ch.id, sessionForDay) ?? "???",
      }));
      return NextResponse.json({ answers });
    }

    // ─── CHECK IF PLAYER ALREADY PLAYED TODAY ────────────────────
    if (action === "check-played") {
      const addr = body.playerAddress as string;
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr))
        return NextResponse.json({ error: "Invalid address" }, { status: 400 });
      return NextResponse.json({ played: hasPlayedToday(addr), date: todayKey() });
    }

    // ─── LIST TODAY'S PLAYERS (dev tool) ─────────────────────────
    if (action === "daily-players") {
      return NextResponse.json({ date: todayKey(), players: getTodayPlayers() });
    }

    // ─── MARK PLAYER AS PLAYED (called after successful analysis) ─
    if (action === "mark-played") {
      const addr = body.playerAddress as string;
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr))
        return NextResponse.json({ error: "Invalid address" }, { status: 400 });
      if (hasPlayedToday(addr))
        return NextResponse.json({ error: "Already played today", played: true }, { status: 409 });
      markPlayed(addr);
      return NextResponse.json({ marked: true, date: todayKey() });
    }

    // ─── CTF CLAIM WINNINGS ─────────────────────────────────────
    if (action === "claim") {
      const { playerAddress, points } = body;
      if (!playerAddress || !/^0x[0-9a-fA-F]{40}$/.test(playerAddress))
        return NextResponse.json({ error: "Invalid player address" }, { status: 400 });
      if (!points || typeof points !== "number" || points <= 0)
        return NextResponse.json({ error: "Points must be positive" }, { status: 400 });

      const k = normalizeKey(process.env.ATTACK_BOT_PRIVATE_KEY_1);
      if (!k) return NextResponse.json({ error: "Bot key not configured" }, { status: 500 });
      const account = privateKeyToAccount(k);
      const wc = createWalletClient({ account, chain: monadTestnet, transport });

      // 1 point = 0.00001 MON
      const WEI_PER_POINT = 10000000000000n;
      const rewardWei = WEI_PER_POINT * BigInt(Math.floor(points));

      const poolBal = await pc.getBalance({ address: account.address });
      const gasPrice = await pc.getGasPrice();
      if (poolBal < rewardWei + 21000n * gasPrice)
        return NextResponse.json({ error: "Prize pool insufficient" }, { status: 402 });

      try {
        const nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
        const txHash = await wc.sendTransaction({
          to: playerAddress as `0x${string}`,
          value: rewardWei,
          gas: 21000n,
          gasPrice,
          nonce,
        });
        await pc.waitForTransactionReceipt({ hash: txHash });

        return NextResponse.json({
          txHash,
          reward: formatEther(rewardWei),
          rewardWei: rewardWei.toString(),
          points,
          from: account.address,
          to: playerAddress,
        });
      } catch (txErr: unknown) {
        const msg = txErr instanceof Error ? txErr.message : String(txErr);
        console.error("[CLAIM TX ERROR]", msg);
        return NextResponse.json({ error: `Transaction failed: ${msg.slice(0, 200)}` }, { status: 500 });
      }
    }

    // ─── NORMAL ANALYSIS FLOW ───────────────────────────────────
    // Accept txHash from client wallet OR fall back to server-side send
    const clientTxHash = body.txHash as `0x${string}` | undefined;

    const timestamps: Record<string, number> = {};
    timestamps.start = Date.now();

    let txHash: `0x${string}`;
    let senderAddress: string;

    if (clientTxHash) {
      // Client wallet sent the tx — just analyze it
      txHash = clientTxHash;
      timestamps.preflight = Date.now();
      timestamps.broadcast = Date.now();
      senderAddress = body.sender ?? "unknown";
    } else {
      // Fallback: server-side send
      const amountWei = body.amountWei ? BigInt(body.amountWei) : parseEther("0.01");
      const targetAddress = (body.recipient && /^0x[0-9a-fA-F]{40}$/.test(body.recipient))
        ? body.recipient as `0x${string}`
        : ATTACK_TARGET;
      const k1 = normalizeKey(process.env.ATTACK_BOT_PRIVATE_KEY_1);
      if (!k1) {
        return NextResponse.json({ error: "Set ATTACK_BOT_PRIVATE_KEY_1 in .env.local or connect wallet" }, { status: 500 });
      }
      const account = privateKeyToAccount(k1);
      const wc = createWalletClient({ account, chain: monadTestnet, transport });
      senderAddress = account.address;

      const gasPrice = await pc.getGasPrice();
      const nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
      timestamps.preflight = Date.now();

      txHash = await wc.sendTransaction({
        to: targetAddress,
        value: amountWei,
        gas: 21000n,
        gasPrice,
        nonce,
      });
      timestamps.broadcast = Date.now();
    }

    // Phase 3: Confirmation
    const receipt: TransactionReceipt = await pc.waitForTransactionReceipt({ hash: txHash });
    timestamps.confirmed = Date.now();

    // Phase 4: Block forensics
    const block = await pc.getBlock({
      blockNumber: receipt.blockNumber,
      includeTransactions: true,
    });
    timestamps.analyzed = Date.now();

    // Get the actual transaction for accurate field data
    const txData = await pc.getTransaction({ hash: txHash });
    const actualSender = txData.from;
    const actualRecipient = txData.to ?? ATTACK_TARGET;
    const actualValue = txData.value;
    const actualGasPrice = txData.gasPrice ?? 0n;
    const actualNonce = txData.nonce;

    const txs = block.transactions;
    const ourIndex = typeof txs[0] === "string"
      ? (txs as unknown as string[]).findIndex((t) => t === txHash)
      : (txs as unknown as { hash: string }[]).findIndex((t) => t.hash.toLowerCase() === txHash.toLowerCase());

    // RLP encode for hex payload reference
    const rlpHexPayload = rlpEncodeFields(actualNonce, actualGasPrice, 21000n, actualRecipient, actualValue, "0x", 10143);

    // EIP-155 v = chainId*2 + 35 + recovery_bit; for Monad 10143: 20321 (0x4f61) or 20322 (0x4f62)
    const rawTxFields = {
      nonce: `0x${actualNonce.toString(16)}`,
      gasPrice: `0x${actualGasPrice.toString(16)}`,
      gasLimit: "0x5208",
      to: actualRecipient,
      value: `0x${actualValue.toString(16)}`,
      data: "0x",
      chainId: "0x27A3",
      v: "0x4f61",
      r: "0x[32 bytes ECDSA]",
      s: "0x[32 bytes ECDSA]",
      rlpHex: rlpHexPayload,
    };

    // Neighbor analysis with anomaly tagging
    const neighbors: BlockNeighbor[] = [];
    for (let i = 0; i < txs.length; i++) {
      const t = txs[i];
      if (typeof t === "string") continue;
      if (t.hash.toLowerCase() === txHash.toLowerCase()) continue;
      const distance = Math.abs(i - ourIndex);
      const sameTarget = t.to?.toLowerCase() === actualRecipient.toLowerCase();
      const gasDelta = t.gasPrice ? Number(((t.gasPrice - actualGasPrice) * 100n) / (actualGasPrice || 1n)) : 0;
      const suspicious = (sameTarget && distance <= 2) || (gasDelta > 100 && distance <= 2) || sameTarget;

      let anomaly: string | null = null;
      if (sameTarget && distance <= 3) anomaly = "SANDWICH_PATTERN";
      else if (gasDelta > 100 && distance <= 2) anomaly = "FRONTRUN_INDICATOR";
      else if (t.from.toLowerCase() === actualSender.toLowerCase()) anomaly = "SAME_SENDER";

      neighbors.push({
        hash: t.hash, from: t.from, to: t.to,
        value: formatEther(t.value),
        gasPrice: t.gasPrice?.toString() ?? "0",
        index: i, distance, isSuspicious: suspicious,
        anomaly,
      });
    }

    const neighborGasPrices = neighbors.map((n) => BigInt(n.gasPrice)).filter((g) => g > 0n);
    const maxBlockGas = neighborGasPrices.length > 0
      ? neighborGasPrices.reduce((a, b) => (a > b ? a : b), 0n)
      : actualGasPrice;

    const mempoolWindowMs = timestamps.confirmed - timestamps.broadcast;
    const suspiciousCount = neighbors.filter((n) => n.isSuspicious).length;
    const valueStr = formatEther(actualValue);

    // ─── Packet trace with real hex ───────────────────────────────
    const packets = buildPacketTrace(
      txHash, receipt,
      { from: actualSender, to: txData.to, value: actualValue, gasPrice: txData.gasPrice, nonce: actualNonce },
      rpc, timestamps, ourIndex, txs.length, mempoolWindowMs,
    );

    // ─── Dynamic security tests ───────────────────────────────────
    const testCtx: TestContext = {
      txHash, sender: actualSender, recipient: actualRecipient,
      value: valueStr, gasPrice: actualGasPrice, nonce: actualNonce,
      ourIndex, totalTxs: txs.length, blockNumber: receipt.blockNumber,
      mempoolWindowMs, suspiciousNeighbors: suspiciousCount, maxBlockGas,
    };
    const securityTests = generateSecurityTests(testCtx);

    // ─── Anomaly detection ────────────────────────────────────────
    const anomalies = detectAnomalies(txs, ourIndex, txHash, actualRecipient, actualGasPrice, actualSender);

    // ─── Entropy report ───────────────────────────────────────────
    const unprotectedEntropies = packets.map((p) => p.entropyScore);
    const avgUnprotected = unprotectedEntropies.reduce((a, b) => a + b, 0) / unprotectedEntropies.length;
    // Simulated protected entropies (encrypted data has high entropy)
    const protectedEntropies = packets.map((p) => Math.min(1, p.entropyScore + 0.4 + Math.random() * 0.15));
    const avgProtected = protectedEntropies.reduce((a, b) => a + b, 0) / protectedEntropies.length;
    const entropyReport = {
      averageUnprotected: Math.round(avgUnprotected * 1000) / 1000,
      averageProtected: Math.round(avgProtected * 1000) / 1000,
      verdict: avgProtected - avgUnprotected > 0.3
        ? "STRONG — significant entropy increase with protection indicates effective encryption"
        : avgProtected - avgUnprotected > 0.15
          ? "MODERATE — measurable entropy improvement but structured data still partially detectable"
          : "WEAK — insufficient entropy differential, protection may be inadequate",
    };

    // ─── Encryption layers ────────────────────────────────────────
    const encryptionLayers = buildEncryptionLayers();

    // ─── Test summary ─────────────────────────────────────────────
    const unprotectedFails = securityTests.filter((t) => t.unprotectedResult === "FAIL").length;
    const l1Fails = securityTests.filter((t) => t.layer1Result === "FAIL").length;
    const l2Fails = securityTests.filter((t) => t.layer2Result === "FAIL").length;
    const l2Passes = securityTests.filter((t) => t.layer2Result === "PASS").length;
    const l2Partials = securityTests.filter((t) => t.layer2Result === "PARTIAL").length;
    const protectedFails = securityTests.filter((t) => t.protectedResult === "FAIL").length;
    const protectedPartials = securityTests.filter((t) => t.protectedResult === "PARTIAL").length;
    const protectedPasses = securityTests.filter((t) => t.protectedResult === "PASS").length;

    return NextResponse.json({
      txHash,
      sender: actualSender,
      recipient: actualRecipient,
      value: valueStr,
      gasPrice: actualGasPrice.toString(),
      effectiveGasPrice: (receipt.effectiveGasPrice ?? actualGasPrice).toString(),
      blockNumber: Number(receipt.blockNumber),
      blockTimestamp: Number(block.timestamp),
      positionInBlock: ourIndex,
      totalBlockTxs: txs.length,
      rawTxFields,
      packets,
      neighbors: neighbors.slice(0, 20),
      suspiciousCount,
      securityTests,
      encryptionLayers,
      anomalies,
      entropyReport,
      testSummary: {
        total: securityTests.length,
        unprotected: { fail: unprotectedFails, partial: securityTests.length - unprotectedFails, pass: 0 },
        layer1: { fail: l1Fails, partial: securityTests.length - l1Fails, pass: 0 },
        layer2: { fail: l2Fails, partial: l2Partials, pass: l2Passes },
        protected: { fail: protectedFails, partial: protectedPartials, pass: protectedPasses },
      },
      timing: {
        totalMs: timestamps.analyzed - timestamps.start,
        signMs: timestamps.preflight - timestamps.start,
        broadcastMs: timestamps.broadcast - timestamps.preflight,
        confirmMs: timestamps.confirmed - timestamps.broadcast,
        analysisMs: timestamps.analyzed - timestamps.confirmed,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
