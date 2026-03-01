# Setup script for CTF API routes
# Run this in PowerShell or PowerShell Core to create the necessary directories and files

$apiPath = "C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api"
$claimPath = Join-Path $apiPath "ctf-claim"
$poolPath = Join-Path $apiPath "ctf-pool"

# Create directories
New-Item -ItemType Directory -Path $claimPath -Force | Out-Null
New-Item -ItemType Directory -Path $poolPath -Force | Out-Null

$claimContent = @'
import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

function normalizeKey(key?: string): `0x${string}` | null {
  if (!key) return null;
  const n = key.startsWith("0x") ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(n) ? (n as `0x${string}`) : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerAddress, points } = body;

    // Validate playerAddress
    if (!playerAddress || !isAddress(playerAddress)) {
      return NextResponse.json(
        { error: "Invalid playerAddress. Must be a valid 0x address." },
        { status: 400 }
      );
    }

    // Validate points
    if (typeof points !== "number" || points <= 0) {
      return NextResponse.json(
        { error: "Invalid points. Must be a positive number." },
        { status: 400 }
      );
    }

    // Get private key from environment
    const privateKey = normalizeKey(process.env.ATTACK_BOT_PRIVATE_KEY_1);
    if (!privateKey) {
      console.error("Invalid or missing ATTACK_BOT_PRIVATE_KEY_1");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Create account from private key
    const account = privateKeyToAccount(privateKey);

    // Create wallet and public clients
    const walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http("https://testnet-rpc.monad.xyz"),
    });

    const publicClient = createPublicClient({
      chain: monadTestnet,
      transport: http("https://testnet-rpc.monad.xyz"),
    });

    // Convert points to MON: 1 point = 0.00001 MON
    const rewardMON = points * 0.00001;
    const rewardWei = parseEther(rewardMON.toString());

    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: playerAddress as `0x${string}`,
      value: rewardWei,
    });

    // Wait for transaction confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return NextResponse.json({
      success: true,
      txHash,
      reward: rewardMON.toFixed(5),
      rewardWei: rewardWei.toString(),
      playerAddress,
      points,
    });
  } catch (error) {
    console.error("CTF claim error:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      // Check for common transaction errors
      if (error.message.includes("insufficient funds")) {
        return NextResponse.json(
          { error: "Insufficient balance in bot account" },
          { status: 402 }
        );
      }
      if (error.message.includes("invalid address")) {
        return NextResponse.json(
          { error: "Invalid recipient address" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to process claim" },
      { status: 500 }
    );
  }
}
'@

$poolContent = @'
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
'@

# Write files
Set-Content -Path (Join-Path $claimPath "route.ts") -Value $claimContent
Set-Content -Path (Join-Path $poolPath "route.ts") -Value $poolContent

Write-Host "✓ Created: $claimPath\route.ts"
Write-Host "✓ Created: $poolPath\route.ts"
Write-Host ""
Write-Host "Setup complete! Your API routes are ready."
