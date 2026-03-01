import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

function normalizeKey(key?: string): `0x${string}` | null {
  if (!key) return null;
  const n = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(n) ? (n as `0x${string}`) : null;
}

export async function GET(request: NextRequest) {
  try {
    // Get private key from environment
    const privateKey = normalizeKey(process.env.ATTACK_BOT_PRIVATE_KEY_1);
    if (!privateKey) {
      console.error("Invalid or missing ATTACK_BOT_PRIVATE_KEY_1");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Derive account address from private key
    const account = privateKeyToAccount(privateKey);
    const botAddress = account.address;

    // Create public client to fetch balance
    const publicClient = createPublicClient({
      chain: monadTestnet,
      transport: http("https://testnet-rpc.monad.xyz"),
    });

    // Fetch the balance in wei
    const balanceWei = await publicClient.getBalance({
      address: botAddress,
    });

    // Convert to MON (formatted)
    const balanceMON = formatEther(balanceWei);

    return NextResponse.json({
      success: true,
      address: botAddress,
      balance: balanceMON,
      balanceWei: balanceWei.toString(),
    });
  } catch (error) {
    console.error("CTF pool error:", error);

    if (error instanceof Error) {
      if (error.message.includes("network")) {
        return NextResponse.json(
          { error: "Failed to connect to RPC" },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to fetch pool balance" },
      { status: 500 }
    );
  }
}
