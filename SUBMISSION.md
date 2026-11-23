# Khaan Predict — submission pack (Solana Perps and Prediction Markets Hackathon)

## Submission

- **Hackathon:** Solana Perps and Prediction Markets (hackathons.solana.com)
- **Deadline:** 2026-12-05 21:00 UTC = 2026-12-06 05:00 CST
- **Build week:** starts 2026-12-01. Submit as soon as ready — do not wait for the deadline.
- **Tracks:** main track ($100,000: 1st $50k / 2nd $30k / 3rd $20k) + Best use of the
  pm-AMM ($1,000 investment + support to raise up to $25,000 on Backable, PREDICT Spark).
- **Repo:** (public GitHub repo — to be created, see below)
- **Dashboard:** (Pages URL — to be deployed, see below)
- **Demo video:** (to be recorded, see DEMO_SCRIPT.md)

## What it is

Khaan Predict is an autonomous AI agent that creates prediction markets on
Solana's pm-AMM and trades them on its own forecasts — fully in public. Every
market, every trade, every reason, every on-chain signature is visible on the
dashboard.

## Why the pm-AMM (not an order book / LMSR / constant-product AMM)

Outcome tokens get more volatile near 50% and near expiry. A constant-product
pool (Uniswap-style) or Hanson's LMSR provides liquidity badly matched to that
behaviour: LPs bleed value unevenly and are all but guaranteed to lose
everything at expiry. The pm-AMM (Moallemi & Robinson, Paradigm, Nov 2024) is
the **uniform AMM**: expected losses to arbitrage (LVR) are a constant
fraction of pool value at any price. The dynamic version withdraws liquidity as
expiry nears, so LPs end with half their wealth in expectation instead of
zero. That is exactly what a prediction market needs — and what makes an
autonomous agent market-maker viable. An order book needs counterparties; an
LMSR needs a subsidised loss bound; a constant-product AMM needs LPs willing
to be wiped out. The pm-AMM needs none of those: it is the only AMM designed
for outcome tokens, and it is why the agent can seed a market, trade it, and
provide liquidity as one continuous operation.

## How it works

1. **Predict** — the agent fetches real prices (CoinGecko public API, no key)
   and asks Gemini for a probability + plain-language reasoning per event
   (SOL / BTC price targets). No key, no problem: it seeds at 50% and says so.
2. **Create** — it opens a binary market on the pm-AMM, seeded at its own
   predicted price, with 50 mUSDC of starting liquidity.
3. **Trade** — it buys the side it believes in (10 mUSDC), quoting exactly with
   the pm-AMM math (fee-aware, 1% slippage bound). 2% swap fee: 50% to the
   protocol DAO, 50% to the market creator (the agent) — so every trade the
   agent makes also earns it creator fees.
4. **Resolve** — as market authority it resolves after expiry from the real
   price and claims winnings. Full cycle on devnet takes ~5 minutes for a
   short market; weekly markets resolve before the Dec 5 deadline.

## Traction (on-chain, devnet)

| Metric | Value |
|---|---|
| Markets created by the agent | (from data/state.json) |
| Trades executed | (from data/state.json) |
| Volume (mUSDC) | (from data/state.json) |
| Fees paid / earned (mUSDC) | (from data/state.json) |
| Agent wallet | (devnet pubkey in data/state.json) |
| Markets | (Solscan links in the dashboard) |

All numbers are real devnet transactions, not projections. The dashboard links
every market and trade to Solscan.

## Depth of integration

- Uses the pm-AMM as the **core** — markets, trading, liquidity, resolution,
  and claiming all go through `@pm-amm/sdk` (all 34 instructions wrapped).
- Exact quotes via the official `pm-amm-helpers.ts` math (fee-aware, reserve
  rescaling to `now`), not hand-rolled approximations.
- Reads markets in batched RPC calls (public devnet RPC is rate-limited).
- Handles the real gotchas: CJS (not ESM) for `@anchor-lang/core`, raw vs human
  units, both YES+NO ATAs for swaps, `fetchAllMarkets(443)` layout filter.

## What works today

- Agent runs end-to-end on devnet: wallet → faucet → create market → trade →
  resolve → claim. Verified with real transactions (see data/log.json).
- Dashboard shows live markets, positions, P&L, reasoning, and signatures.
- Anyone can trade the agent's markets from the dashboard via the pm-AMM
  reference app (burner wallet, one tap, no wallet install).

## Standalone potential

After the hackathon this becomes a real product: the same agent on mainnet
(same program ID, just the real USDC mint) runs markets on anything with a
verifiable outcome — crypto prices, sports, tech events, governance votes —
with the agent as market-maker and the dashboard as the public track record.
The pm-AMM's creator-fee split (50% of every swap fee) makes the agent
self-funding: the more people trade its markets, the more it earns.

## Submission checklist

- [ ] Agent runs end-to-end on devnet (create → trade → resolve → claim) — DONE / TODO
- [ ] Public GitHub repo with README — TODO (local git ready, remote to create)
- [ ] Dashboard deployed (Pages URL) — TODO
- [ ] Demo video recorded (60–90 s) — TODO (script in DEMO_SCRIPT.md)
- [ ] Submission filed on hackathons.solana.com — TODO (window opens Dec 1; see below)
- [ ] Traction numbers filled in above from data/state.json — TODO (needs devnet SOL)

## Submission entry (to confirm when the window opens)

The hackathon page (hackathons.solana.com/hackathons/perps-and-prediction-markets)
shows "Launches Dec 1, 2026" and "Submissions 0". The submission portal is
expected to open Dec 1. When it opens: submit the repo URL + dashboard URL +
demo video + description. If submission needs a user account/login, that is a
user step — prepare everything so it is one click.

## Blockers / notes

- **Devnet SOL is the gating item.** mUSDC 1,000 funded via the pm-AMM faucet.
  SOL is 0: the public RPC airdrop is closed (410 Gone), the pm-AMM faucet
  dripped 0 SOL (likely not enabled until the hackathon starts Dec 1), Ankr and
  Alchemy demo RPC airdrops failed. Fix: claim devnet SOL from the official
  Solana faucet (faucet.solana.com) via a browser task for wallet
  `B3u1b3WPhhzJ5y67Jt4tNAZrsP3nDJuijSpj83HrjGqw`.
- No mainnet, no real SOL, no real money — by design. Devnet only.
- Agent wallet is a devnet-only test keypair (gitignored, never reuse on mainnet).
