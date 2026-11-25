# makefun-pump-fun-sharpe-sprint

[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/georgeonweb3/makefun-pump-fun-sharpe-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/georgeonweb3/makefun-pump-fun-sharpe-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

**HotLaunch** — a paper-trading bot for the [Pump.fun Sharpe Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) ($2, closes 2026-11-28T17:00:00Z). Places go by hourly Sharpe ratio on a 6-hour pump.fun forward replay; a prize needs net PnL above 0 after every fee, at least 20 counted round trips (≥0.01 SOL each) and max drawdown ≤ 50%.

## The idea

The dev window (24h, 1,222 universe coins, 126,801 trades) says the median coin spikes +19% in its first slot and decays back to its create price — and the creator always buys within 2 slots, so no bot can ever buy pre-spike. Buying ordinary launches means buying the top of the creator spike: the three house pilots all lose on dev (momentum −9.44 SOL, reversion −3.99 SOL, sniper −0.50 SOL).

The only positive edge found is **velocity**: coins with **≥12 trades in their create slot** are the hottest launches. Bought at the fill (2 slots later) with TP +18% / SL −8% / hold ≤600 slots, they win ~60–75% of the time. Everything broader loses; TP +22% falls off a cliff and trailing stops lose money (thin-curve noise triggers them early).

## Strategy (strategy.ts, pure function of the batches — deterministic, no clock, no randomness)

- **Tier A (hot):** on the create batch only, if the coin has ≥12 trades in slot 0 and the creator has not sold, buy 0.5 SOL (capped at 1% of real SOL reserve). Exit at TP +18%, SL −8%, max hold 600 slots, or on a creator sell.
- **Tier B (coverage):** the guardrail needs 20 counted mints per 6h, but hot launches only give ~5–9 per 6h. When counted mints lag the pace (target 25 per 6h), buy 0.01 SOL of a merely-warm launch (≥3 slot-0 trades) and exit fast (TP/SL ±10%, hold 60 slots). It costs ~0.004 SOL per 24h and delivers exactly 25 counted mints per 6h slice.
- Max 5 open positions, one entry per coin, 30-slot cooldown after an exit.

## Dev-window backtest (local simulator, same fees/latency/caps as the house)

| Config | Full 24h net | Sharpe | 6h slices net | Counted / slice | Max DD |
|---|---|---|---|---|---|
| HotLaunch (locked params) | **+0.776 SOL** | **+0.64** | −0.01 / +0.22 / +0.37 / +0.04 | 25 / 25 / 25 / 25 | 0.005 |
| House sniper (best pilot) | −0.497 SOL | −0.84 | all negative | 353 mints / 24h | 0.054 |
| House momentum | −9.44 SOL | −0.58 | all negative | — | 0.954 |
| House reversion | −3.99 SOL | −0.48 | all negative | — | 0.490 |

Caveats: the dev window is one 24h sample and the final window is unseen. Slice 0 (Sunday 03:09–09:09 UTC, lowest activity) is ~breakeven; slices 1–3 are solidly positive. TP is the sensitive knob (+15–20% is the robust zone; +22% collapses). The final window runs Friday 17:00–23:00 UTC, a busier period than the dev slice 0.

## Run

```sh
node main.ts   # Node 22, no dependencies; the grader runs `node /bot/main.ts`
```

## Files

- `main.ts` — entrypoint (Node 22, erasable TypeScript).
- `strategy.ts` — HotLaunch strategy.
- `vendor/agentfun-bot.ts` — the protocol shim (vendored from the competition kit).
- `LICENSE` — MIT.

---

*Built for the make.fun bounty [Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532). Referral: `eqkgefdh`*
