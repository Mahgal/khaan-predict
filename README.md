# Khaan Predict — an AI agent that runs prediction markets on the pm-AMM

An autonomous AI agent that creates prediction markets on Solana's **pm-AMM**
(Paradigm's uniform AMM for outcome tokens, implemented by PREDICT) and trades
them on its own forecasts. Everything is public: every market, every trade,
every reason, every on-chain signature.

Built for the **Solana Perps and Prediction Markets Hackathon** (Dec 1–5, 2026,
$101,000 prize pool) — main track + Best use of the pm-AMM ($1,000, PREDICT Spark).

## How it works

1. **Predict** — the agent fetches real prices (CoinGecko, no key) and asks
   Gemini for a probability + reasoning for each event (SOL / BTC price targets).
2. **Create** — it opens a binary market on the pm-AMM, seeded at its own
   predicted price, with 50 mUSDC of starting liquidity.
3. **Trade** — it buys the side it believes in (10 mUSDC), quoting exactly with
   the pm-AMM math (fee-aware, slippage-bounded).
4. **Resolve** — as market authority it resolves after expiry from the real
   price and claims winnings. Every step is logged with tx signatures.

## Why the pm-AMM (not an order book / LMSR / constant-product AMM)

Outcome tokens get more volatile near 50% and near expiry. A constant-product
pool or LMSR bleeds LPs unevenly and is all but guaranteed to lose everything
at expiry. The pm-AMM (Moallemi & Robinson, Paradigm 2024) is the uniform
AMM: expected losses to arbitrage are a constant fraction of pool value at any
price, and the dynamic version withdraws liquidity as expiry nears so LPs end
with half their wealth in expectation instead of zero. That is exactly what a
prediction market needs — and what makes an agent market-maker viable.

## Run it (devnet only, free test money)

```bash
npm install
node agent.cjs setup    # create the devnet wallet + fund it via the faucet
node agent.cjs smoke    # create one test market + buy YES (end-to-end check)
node agent.cjs run      # full cycle: predict -> create -> trade -> log
node agent.cjs resolve  # resolve expired markets + claim winnings
node agent.cjs status   # markets, live prices, P&L
```

Devnet constants: program `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y`,
mock USDC `3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ`, RPC
`https://api.devnet.solana.com`. The same program ID runs on mainnet with real
USDC — this agent only ever passes the devnet mint and a devnet RPC.

`GEMINI_API_KEY` is optional (read from the environment at runtime, never
stored in the repo). Without it the agent seeds markets at 50% and says so.

## Dashboard

`dashboard/` is a static page (deployed to Pages) showing the live market list,
agent positions, P&L, the reasoning behind every trade, and the on-chain
signatures. Each market links to the pm-AMM reference app where anyone can
trade it with a burner wallet in one tap.

## Files

- `agent.cjs` — the agent (Node, CommonJS: `@anchor-lang/core` is CJS)
- `helpers.cjs` — exact pm-AMM quotes/state (adapted from the official
  `pm-amm-helpers.ts`, MIT)
- `data/state.json` — markets, trades, P&L (written by the agent)
- `data/log.json` — append-only event log with tx signatures
- `dashboard/` — the public dashboard

## Security notes

- `agent-wallet.json` is a devnet-only test keypair. It is gitignored and must
  never be reused on mainnet or hold real funds.
- The agent only talks to the official devnet RPC, the official pm-AMM faucet,
  CoinGecko's public price API, and (optionally) Google's Gemini API.
- No mainnet, no real SOL, no real money — by design.
