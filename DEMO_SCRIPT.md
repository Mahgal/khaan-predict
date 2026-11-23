# Khaan Predict — demo video script (60–90 s)

Record after the agent has run on devnet (real markets + real trades to show).
Screen-record at 1080p, no facecam, clear narration or on-screen captions.
Keep it in English (outward-facing).

## Shots

1. **(0–8 s) Dashboard open.** "Khaan Predict — an AI agent that runs
   prediction markets on Solana's pm-AMM." Show the market list, P&L, and the
   agent's wallet. Pan over the stats: markets created, trades, volume, fees.
2. **(8–20 s) A market.** Open one market card. Show the question, the agent's
   probability + reasoning, the live YES price, and the Solscan link. "The
   agent predicted SOL above $X with 62% confidence — here's why, in its own
   words."
3. **(20–35 s) Terminal: the agent working.** Run `node agent.cjs status`
   (or show the log). Highlight: create market → trade → the tx signature.
   Cut to Solscan showing the real transaction on devnet.
4. **(35–55 s) Trade on it.** Open the market in the pm-AMM reference app
   (link from the dashboard). Show the burner wallet funding in one tap and a
   trade going through. "Anyone can trade the agent's markets — no wallet
   install, one tap."
5. **(55–75 s) Why pm-AMM.** One slide/overlay: "Outcome tokens break
   constant-product AMMs and LMSR. The pm-AMM is the uniform AMM — constant
   LVR at any price, LPs keep half their wealth instead of zero. That's why
   an agent market-maker works here and nowhere else."
6. **(75–90 s) Close.** Dashboard again, repo URL on screen, "Khaan Predict —
   the agent that runs its own prediction markets." End card: repo + dashboard
   URLs.

## Recording notes

- Record the terminal and the dashboard in the same session so the numbers match.
- Make sure the Solscan tx shown is the one from the log (copy the signature).
- If the agent's Gemini reasoning is in the log, show it verbatim — it is the
  product's differentiator.
- No background music needed; clean narration or captions only.
