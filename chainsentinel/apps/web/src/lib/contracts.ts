// ─── Monad Testnet Contract Addresses (Chain ID 10143) ────────────────

// Verified on-chain — this is the TESTNET WMON, not mainnet
export const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as const;

export const ETH_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

// Multicall3 (same across networks)
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

// ─── Token metadata ───────────────────────────────────────────────────

export const TOKENS = {
  MON: { symbol: "MON", name: "Monad", decimals: 18, address: null },
  WMON: { symbol: "WMON", name: "Wrapped MON", decimals: 18, address: WMON },
} as const;

export type TokenKey = keyof typeof TOKENS;

// ─── ABIs ─────────────────────────────────────────────────────────────

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// WMON (WETH9-style) deposit/withdraw
export const WMON_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;
