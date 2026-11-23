// Khaan Predict — autonomous AI agent that creates prediction markets on the
// pm-AMM (Solana devnet) and trades them on its own forecasts.
//
// CommonJS (see predict-pm-amm.dev/hackathon.md: @anchor-lang/core is CJS).
//
// Commands:
//   node agent.cjs setup    — create the devnet wallet + fund it via the faucet
//   node agent.cjs smoke    — create one test market + buy YES (end-to-end check)
//   node agent.cjs run      — full cycle: prices -> predict -> create -> trade -> log
//   node agent.cjs resolve  — resolve expired markets + claim winnings
//   node agent.cjs status   — show markets, live prices, positions, P&L
//
// Devnet only. agent-wallet.json is a TEST keypair with no real value;
// never reuse it on mainnet. The agent never touches mainnet.
// Prediction uses Gemini (GEMINI_API_KEY env) with a rules-based fallback;
// the key is read from the environment at runtime and never stored in the repo.
const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { PmAmmClient } = require("@pm-amm/sdk");
const { marketState, quoteSwap, minOutput } = require("./helpers.cjs");

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const APP = "https://pm-amm-devnet.vercel.app";
const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"); // devnet mock USDC
const WALLET_FILE = process.env.WALLET || path.join(__dirname, "agent-wallet.json");
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const LOG_FILE = path.join(DATA_DIR, "log.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSecs = () => Math.floor(Date.now() / 1000);

// ---------- wallet & funds ----------

function loadWallet() {
  if (fs.existsSync(WALLET_FILE)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(WALLET_FILE, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`created ${WALLET_FILE} (devnet only — never reuse on mainnet)`);
  return kp;
}

async function usdcBalance(conn, owner) {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
  try {
    return Number((await conn.getTokenAccountBalance(ata)).value.uiAmount);
  } catch {
    return 0;
  }
}

async function ensureUsdc(conn, owner) {
  if ((await usdcBalance(conn, owner)) >= 50) return;
  console.log("claiming 1,000 mUSDC from the faucet…");
  const res = await fetch(`${APP}/api/faucet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: owner.toBase58() }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`faucet ${res.status}: ${body.error || JSON.stringify(body)}`);
    process.exit(1);
  }
  await conn.confirmTransaction(body.signature, "confirmed");
  if (body.sol) console.log(`faucet also sent ${body.sol} devnet SOL`);
}

async function ensureSol(conn, pubkey) {
  const bal = await conn.getBalance(pubkey);
  if (bal >= 0.05 * LAMPORTS_PER_SOL) return bal;
  console.log("requesting a devnet SOL airdrop…");
  try {
    const sig = await conn.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    console.error(`airdrop refused (${e.message.split("\n")[0]}). Get SOL another way, then re-run.`);
    process.exit(1);
  }
  return conn.getBalance(pubkey);
}

function getClient(conn, kp) {
  const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" });
  return PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);
}

// ---------- state & log ----------

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { markets: [], trades: [], createdAt: new Date().toISOString() };
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  // dashboard copy (public): markets + trades + wallet + timestamp, no keys
  let wallet = "";
  try {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"))));
    wallet = kp.publicKey.toBase58();
  } catch {}
  const dashDir = path.join(__dirname, "dashboard");
  fs.mkdirSync(dashDir, { recursive: true });
  fs.writeFileSync(
    path.join(dashDir, "data.json"),
    JSON.stringify({ wallet, updatedAt: new Date().toISOString(), markets: s.markets, trades: s.trades }, null, 2),
  );
}

function logEvent(ev) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n");
}

// ---------- data & prediction ----------

async function fetchPrices() {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin&vs_currencies=usd");
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const j = await res.json();
  return { sol: j.solana.usd, btc: j.bitcoin.usd };
}

async function geminiPredict(question, context) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const prompt =
    `You are a prediction-market analyst. Answer with ONLY a JSON object, no other text: ` +
    `{"probability": <integer 1-99, chance the event happens>, "reasoning": "<1-2 sentences, plain, no jargon>"}. ` +
    `Question: ${question}. Context: ${context}.`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) {
      console.error(`gemini ${res.status}`);
      return null;
    }
    const j = await res.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const out = JSON.parse(m[0]);
    if (typeof out.probability !== "number" || !out.reasoning) return null;
    const probability = Math.max(1, Math.min(99, Math.round(out.probability)));
    return { probability, side: probability >= 50 ? "yes" : "no", reasoning: String(out.reasoning).slice(0, 280) };
  } catch (e) {
    console.error("gemini error:", e.message);
    return null;
  }
}

function roundTarget(price, pct) {
  // round number ~pct% away from the current price, 2 significant figures
  const t = price * (1 + pct);
  const mag = Math.pow(10, Math.floor(Math.log10(t)) - 1);
  return Math.round(t / mag) * mag;
}

// ---------- market ops ----------

async function createMarket(client, state, spec) {
  const { marketId, marketPda, signature } = await client.send.createMarket({
    name: spec.name,
    durationSecs: spec.durationSecs,
    initialPriceBps: spec.initialPriceBps,
    depositUsdc: spec.depositUsdc,
  });
  const rec = {
    marketId,
    marketPda,
    name: spec.name,
    question: spec.question,
    asset: spec.asset,
    target: spec.target,
    side: spec.side,
    probability: spec.probability,
    reasoning: spec.reasoning,
    endTs: nowSecs() + spec.durationSecs,
    createdSig: signature,
    createdAt: new Date().toISOString(),
    resolved: false,
    claimed: false,
  };
  state.markets.push(rec);
  logEvent({ type: "createMarket", ...rec });
  return rec;
}

async function trade(client, state, marketPda, direction, amountUsdc) {
  const market = new PublicKey(marketPda);
  const m = await client.fetchMarket(market);
  const amountIn = Math.round(amountUsdc * 1_000_000);
  const q = quoteSwap(m, direction, amountIn);
  const sig = await client.send.swap(market, direction, amountIn, minOutput(q, 100));
  const rec = {
    marketPda,
    direction,
    amountUsdc,
    out: q.out / 1_000_000,
    fee: q.fee / 1_000_000,
    signature: sig,
    at: new Date().toISOString(),
  };
  state.trades.push(rec);
  logEvent({ type: "trade", ...rec });
  return rec;
}

async function resolveMarket(client, state, rec, outcome) {
  const market = new PublicKey(rec.marketPda);
  const sig = await client.send.resolveMarket(market, outcome);
  rec.resolved = true;
  rec.outcome = outcome;
  rec.resolveSig = sig;
  rec.resolvedAt = new Date().toISOString();
  logEvent({ type: "resolve", marketPda: rec.marketPda, outcome, signature: sig });
  try {
    const claimSig = await client.send.claimWinnings(market);
    rec.claimed = true;
    rec.claimSig = claimSig;
    logEvent({ type: "claim", marketPda: rec.marketPda, signature: claimSig });
  } catch (e) {
    console.log(`claim skipped for ${rec.marketPda}: ${e.message.split("\n")[0]}`);
  }
  return rec;
}

// ---------- commands ----------

async function cmdSetup() {
  const conn = new Connection(RPC, "confirmed");
  const kp = loadWallet();
  console.log(`wallet ${kp.publicKey.toBase58()}`);
  await ensureUsdc(conn, kp.publicKey);
  const sol = await ensureSol(conn, kp.publicKey);
  console.log(`balance ${(sol / LAMPORTS_PER_SOL).toFixed(3)} SOL · ${await usdcBalance(conn, kp.publicKey)} mUSDC`);
}

async function cmdSmoke() {
  const conn = new Connection(RPC, "confirmed");
  const kp = loadWallet();
  console.log(`wallet ${kp.publicKey.toBase58()}`);
  await ensureUsdc(conn, kp.publicKey);
  await ensureSol(conn, kp.publicKey);
  const client = getClient(conn, kp);
  const state = loadState();
  const name = `Smoke ${new Date().toISOString().slice(0, 16)}`;
  const rec = await createMarket(client, state, {
    name,
    question: "Smoke test: will SOL be above $1 at expiry?",
    asset: "SOL",
    target: 1,
    side: "yes",
    probability: 99,
    reasoning: "Smoke test market — trivial target to verify the full create/trade/resolve/claim cycle.",
    durationSecs: 3600,
    initialPriceBps: 5000,
    depositUsdc: 50,
  });
  console.log(`market ${rec.marketPda} (id ${rec.marketId})`);
  let m = await client.fetchMarket(new PublicKey(rec.marketPda));
  console.log(`YES ${(marketState(m).price * 100).toFixed(2)}%`);
  const t = await trade(client, state, rec.marketPda, "usdcToYes", 5);
  console.log(`bought ${t.out.toFixed(2)} YES for 5 mUSDC (sig ${t.signature})`);
  await sleep(1000);
  m = await client.fetchMarket(new PublicKey(rec.marketPda));
  console.log(`YES now ${(marketState(m).price * 100).toFixed(2)}%`);
  console.log(`open it: ${APP}/market/${rec.marketId}`);
  saveState(state);
}

async function cmdRun() {
  const conn = new Connection(RPC, "confirmed");
  const kp = loadWallet();
  console.log(`wallet ${kp.publicKey.toBase58()}`);
  await ensureUsdc(conn, kp.publicKey);
  await ensureSol(conn, kp.publicKey);
  const client = getClient(conn, kp);
  const state = loadState();
  const prices = await fetchPrices();
  console.log(`prices: SOL $${prices.sol} · BTC $${prices.btc}`);

  // Two weekly markets, expiring before the Dec 5 deadline.
  const specs = [
    { asset: "SOL", price: prices.sol, target: roundTarget(prices.sol, 0.03), days: 7 },
    { asset: "BTC", price: prices.btc, target: roundTarget(prices.btc, 0.03), days: 7 },
  ];
  for (const s of specs) {
    const endDate = new Date(Date.now() + s.days * 86400 * 1000).toISOString().slice(0, 10);
    const question = `Will ${s.asset} be above $${s.target} on ${endDate}?`;
    const pred =
      (await geminiPredict(question, `${s.asset} is now $${s.price}. Target $${s.target} in ${s.days} days.`)) ||
      { probability: 50, side: "yes", reasoning: "No LLM available; seeded at 50% (market-neutral start)." };
    const rec = await createMarket(client, state, {
      name: question.slice(0, 64),
      question,
      asset: s.asset,
      target: s.target,
      side: pred.side,
      probability: pred.probability,
      reasoning: pred.reasoning,
      durationSecs: s.days * 86400,
      initialPriceBps: pred.probability * 100,
      depositUsdc: 50,
    });
    console.log(`created #${rec.marketId} ${rec.marketPda} — ${question} (p=${pred.probability}%)`);
    const dir = pred.side === "yes" ? "usdcToYes" : "usdcToNo";
    const t = await trade(client, state, rec.marketPda, dir, 10);
    console.log(`  traded 10 mUSDC -> ${dir} got ${t.out.toFixed(2)} tokens (sig ${t.signature})`);
    console.log(`  reasoning: ${pred.reasoning}`);
    console.log(`  open it: ${APP}/market/${rec.marketId}`);
    saveState(state);
  }
  console.log("done. state saved to data/state.json");
}

async function cmdResolve() {
  const conn = new Connection(RPC, "confirmed");
  const kp = loadWallet();
  const client = getClient(conn, kp);
  const state = loadState();
  const prices = await fetchPrices();
  let n = 0;
  for (const rec of state.markets) {
    if (rec.resolved || rec.endTs > nowSecs()) continue;
    const price = rec.asset === "BTC" ? prices.btc : prices.sol;
    const outcome = price > rec.target ? "yes" : "no";
    console.log(`resolving #${rec.marketId} ${rec.name} — ${rec.asset} $${price} vs target $${rec.target} -> ${outcome}`);
    await resolveMarket(client, state, rec, outcome);
    n++;
  }
  saveState(state);
  console.log(n ? `resolved ${n} market(s)` : "nothing to resolve");
}

async function cmdStatus() {
  const conn = new Connection(RPC, "confirmed");
  const state = loadState();
  console.log(`markets: ${state.markets.length} · trades: ${state.trades.length}`);
  for (const rec of state.markets) {
    try {
      const m = await client_fetchMarket(conn, rec.marketPda);
      const s = marketState(m);
      console.log(
        `#${rec.marketId} ${rec.name} — YES ${(s.price * 100).toFixed(1)}% · ${s.secondsLeft}s left · resolved=${s.resolved} winner=${s.winner || "-"}`,
      );
    } catch (e) {
      console.log(`#${rec.marketId} ${rec.name} — read failed: ${e.message.split("\n")[0]}`);
    }
  }
  const spent = state.trades.reduce((a, t) => a + t.amountUsdc, 0);
  const fees = state.trades.reduce((a, t) => a + (t.fee || 0), 0);
  console.log(`total traded: ${spent.toFixed(2)} mUSDC · fees paid: ${fees.toFixed(4)} mUSDC`);
}

async function client_fetchMarket(conn, pda) {
  const client = PmAmmClient.readOnly(conn, PROGRAM_ID, USDC_MINT);
  return client.fetchMarket(new PublicKey(pda));
}

async function main() {
  const cmd = process.argv[2] || "status";
  if (cmd === "setup") return cmdSetup();
  if (cmd === "smoke") return cmdSmoke();
  if (cmd === "run") return cmdRun();
  if (cmd === "resolve") return cmdResolve();
  if (cmd === "status") return cmdStatus();
  console.error("usage: node agent.cjs <setup|smoke|run|resolve|status>");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
