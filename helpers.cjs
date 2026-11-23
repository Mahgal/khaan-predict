// pm-AMM market helpers — CommonJS adaptation of the official
// https://predict-pm-amm.dev/helpers/pm-amm-helpers.ts (MIT, "copy this
// file into your project"). Exact swap quotes in all 6 directions,
// current market state rescaled to `now`, and batched market reads.
// Deps: @pm-amm/sdk (math only), @solana/web3.js
const { capitalPhi, i80f48ToNumber, phi } = require("@pm-amm/sdk/math");

const FEE_BPS = 200; // 2% on the USDC leg; YES<->NO is free
const Z_CLAMP = 5.9; // the program clamps the sell-side z to ±5.9

const nowSecs = () => Math.floor(Date.now() / 1000);

/** State of a market as the program would see it at `now` (after accrual). */
function marketState(m, now = nowSecs()) {
  const endTs = m.endTs.toNumber();
  const lZero = i80f48ToNumber(m.lZero);
  const secondsLeft = Math.max(endTs - now, 0);
  const lEff = lZero * Math.sqrt(Math.max(endTs - now, 1));
  const lLast = lZero * Math.sqrt(Math.max(endTs - m.lastAccrualTs.toNumber(), 1));
  const scale = lLast > 0 ? lEff / lLast : 0;
  const x = i80f48ToNumber(m.reserveYes) * scale;
  const y = i80f48ToNumber(m.reserveNo) * scale;
  const winner = m.winningSide === 1 ? "yes" : m.winningSide === 2 ? "no" : null;
  const price = winner ? (winner === "yes" ? 1 : 0) : lEff > 0 ? capitalPhi((y - x) / lEff) : 0.5;
  return {
    x,
    y,
    lEff,
    price,
    secondsLeft,
    expired: secondsLeft === 0,
    resolved: m.resolved,
    winner,
  };
}

// ---- the pm-AMM curve: x = L(uΦ(u)+φ(u)−u), y = L(uΦ(u)+φ(u)), u = (y−x)/L ----
const base = (u) => u * capitalPhi(u) + phi(u);

/** Solve base(u) = t (base is increasing) by bisection. */
function solveU(f, target, increasing) {
  let lo = -40;
  let hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if (increasing ? v < target : v > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const xFromY = (y, L) => y - L * solveU(base, y / L, true);
const yFromX = (x, L) => {
  const u = solveU((v) => base(v) - v, x / L, false);
  return x + u * L;
};

/** Gross curve output for `dIn` (raw units, after the input fee). */
function curveOut(s, dir, dIn) {
  const { x, y, lEff: L } = s;
  const clampZ = (z) => Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));
  switch (dir) {
    case "usdcToYes":
      return dIn + (x - xFromY(y + dIn, L));
    case "usdcToNo":
      return dIn + (y - yFromX(x + dIn, L));
    case "yesToUsdc":
      return y - L * base(clampZ((y - x - dIn) / L));
    case "noToUsdc": {
      const z = clampZ((y - x + dIn) / L);
      return x - L * (base(z) - z);
    }
    case "yesToNo":
      return y - yFromX(x + dIn, L);
    case "noToYes":
      return x - xFromY(y + dIn, L);
    default:
      throw new Error(`unknown direction ${dir}`);
  }
}

/**
 * Exact quote for `client.send.swap(market, direction, amountIn, minOutput)`.
 * `amountIn` in raw 6-dp units (5_000_000 = 5 mUSDC or 5 tokens).
 */
function quoteSwap(m, direction, amountIn, now = nowSecs()) {
  const s = marketState(m, now);
  if (s.resolved || s.expired) throw new Error("market is resolved or expired: no swaps");
  const usdcIn = direction === "usdcToYes" || direction === "usdcToNo";
  const usdcOut = direction === "yesToUsdc" || direction === "noToUsdc";
  const feeIn = usdcIn ? Math.floor((amountIn * FEE_BPS) / 10_000) : 0;
  const gross = Math.max(Math.floor(curveOut(s, direction, amountIn - feeIn)), 0);
  const feeOut = usdcOut ? Math.floor((gross * FEE_BPS) / 10_000) : 0;
  const out = gross - feeOut;
  return { out, fee: feeIn + feeOut, avgPrice: amountIn > 0 ? out / amountIn : 0 };
}

/** `minOutput` for a swap with `slippageBps` tolerance (default 1%). */
function minOutput(q, slippageBps = 100) {
  return Math.floor((q.out * (10_000 - slippageBps)) / 10_000);
}

/**
 * Read many markets in ONE RPC call (the public devnet RPC rate-limits hard).
 * Returns null for addresses that aren't markets.
 */
async function fetchMarkets(client, pdas) {
  const ns = client.program.account;
  return ns.market.fetchMultiple(pdas);
}

module.exports = { marketState, quoteSwap, minOutput, fetchMarkets, nowSecs };
