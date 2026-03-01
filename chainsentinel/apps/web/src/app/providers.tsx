"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { UnlinkProvider } from "@unlink-xyz/react";
import { config } from "@/lib/wagmi";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <UnlinkProvider chain="monad-testnet">
          {children}
        </UnlinkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
