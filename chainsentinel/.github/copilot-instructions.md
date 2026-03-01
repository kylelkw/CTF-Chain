# Copilot Instructions for ChainSentinel

## Build, lint, and test commands

Run from the repository root (`chainsentinel/`):

- `pnpm dev` - Starts the web app dev server (`pnpm --filter @chainsentinel/web dev`)
- `pnpm build` - Builds the web app (`pnpm --filter @chainsentinel/web build`)
- `pnpm lint` - Runs Next.js linting for the web app (`pnpm --filter @chainsentinel/web lint`)

Run from `apps/web/` directly:

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`

Testing status:

- There is currently no `test` script in root `package.json` or `apps/web/package.json`.
- No single-test command is available yet because no test runner is configured in this codebase.

## High-level architecture

- This is a `pnpm` workspace (`pnpm-workspace.yaml`) with `apps/*` and `packages/*`; the active code is in `apps/web` and `packages/contracts` is currently scaffolded/empty.
- `apps/web/src/app/layout.tsx` defines global metadata/styles and wraps the app with shared providers.
- `apps/web/src/app/providers.tsx` composes runtime context in this order: `WagmiProvider` -> `QueryClientProvider` -> `UnlinkProvider(chain="monad-testnet")`.
- `apps/web/src/app/page.tsx` is the top-level tab shell and switches between:
  - `ThreatScanner` (`src/components/ThreatScanner.tsx`) for risk scanning
  - `ProtectedSwap` (`src/components/ProtectedSwap.tsx`) for protected vs public transaction routing
  - `AttackSimulator` (`src/components/AttackSimulator.tsx`) for side-by-side simulated outcomes
- `src/lib/scanner.ts` performs on-chain analysis using viem reads/logs and returns structured vulnerabilities plus weighted risk scores.
- `src/lib/viem.ts` and `src/lib/wagmi.ts` centralize Monad testnet clients/config.
- `src/lib/contracts.ts` is the source of truth for contract addresses and ABIs used by UI flows.

## Key codebase conventions

- Chain target is Monad testnet end-to-end (`chainId: 10143` in UI/status and `monadTestnet` in clients/config); keep chain assumptions consistent.
- Use the `@/*` alias for internal imports (`apps/web/tsconfig.json`), rather than deep relative paths.
- Components using wagmi, Unlink SDK, or browser hooks must be client components (`"use client"`).
- Unlink balance lookups should handle both lowercase and checksum token keys (`balances[WMON.toLowerCase()] ?? balances[WMON]`).
- Put shared addresses and ABIs in `src/lib/contracts.ts` and import from there in components/libs.
- Preserve the provider composition order in `src/app/providers.tsx`; hooks in scanner/swap/onboarding flows assume these contexts exist.
