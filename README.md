# pump-fun-paper-sprint

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/museweilejing923/pump-fun-paper-sprint/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/museweilejing923/pump-fun-paper-sprint/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

probe-pyramid: a paper-trading bot for pump.fun. Probes young coins with 0.01 SOL, pyramids into winners, with a hard stop and trailing stop. Dev grade: +0.3786 SOL on 10 SOL, 52 coins, max drawdown 2.21%.

## Run it

```sh
node cli/makefun.mjs grade-local --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>

---

# probe-pyramid — Pump.fun Paper Sprint bot

A paper-trading bot for make.fun's **Pump.fun Paper Sprint: Any Bot Can Win**
(`u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b`). It trades no real
money: the replay harness feeds it recorded pump.fun bonding-curve events and
scores it on a 6-hour forward window, ranked by net PnL from 10 SOL of
starting capital.

## Strategy

Most pump.fun coins die fast and a few moon, so the bot never bets big on a
first impression:

- **Probe first.** A position starts as a 0.01 SOL probe on a young coin
  (100–300 slots old) whose tape already shows real buying: at least 3
  distinct buyers and 3 buys in the last 20 slots, net SOL flowing in, and
  the price up at least 18% over the window while sitting near its window
  high. A coin whose creator sold at any point is skipped — a creator
  dumping is a rug tell, and the dev data says dropping that filter nearly
  quadruples the bleed (the one 9x coin whose creator sold early is the
  exception that proves the rule: it is not worth the ~70 extra rugs).
- **Pyramid into strength only.** If the coin keeps climbing, the bot adds
  fixed rungs: +0.20 SOL at +35%, +0.90 SOL at +65%
  (at most 2.4 SOL per coin), each only while the price stepped up from the
  last buy and net SOL still flows in — and once the rungs are used up, it
  keeps adding on every further 2% step-up while the tape stays strong.
  That last part matters: the harness caps each buy at 1% of the curve's
  real reserves per batch, so a single big rung order can never land in
  full; repeated small adds are the only way to build size on a runner.
- **Cut losers, let winners run — loosely.** A hard stop at −13% against cost
  gives a position room to breathe through the tape's noise (a −6% stop was
  cutting runners before they ran), a fade exit only when net flow over 15
  slots turns below −3 SOL (the old −1 SOL trigger fired on ordinary
  volatility and dumped winners early), an exit when the creator sells while
  holding, a 2400-slot hold limit, and once a position is up 10% a 10%
  trailing stop from its peak (the old +50%/30% trailing stop never fired,
  so it never saved a trip that peaked and faded).
- **No guardrail probes.** Probe round trips (buy 0.01 SOL, sell at once) lose
  the curve fee almost every time, so the ~15 of them were dragging the win
  rate down while adding almost nothing to net PnL. Main entries alone clear
  the eligibility bar (36 coins on the dev window), so the probes were pure
  insurance the run no longer pays for — but note the trade: if a future
  window yields far fewer entry signals, the run could fall under 20 coins
  with no safety net; on the dev window the margin is 36 vs the 20 bar.

Everything is deterministic: no clock, no randomness, iteration only over
insertion-ordered maps fed by the batch stream, so two runs produce
byte-identical action logs.

## Files

- `main.ts` — entry point (the grader runs `node /bot/main.ts`).
- `strategy.ts` — the strategy, parameters in `DEFAULT_PARAMS`.
- `vendor/agentfun-bot.ts` — the kit's bot shim, vendored byte for byte.
- `tools/sim.ts` — a local port of the replay engine for fast offline sweeps.
- `tools/sweep.ts` — parameter grid sweep over the dev window.
- `tools/run.ts`, `tools/diag.ts` — single-run summary and per-coin diagnostics.

## Official local grade (`grade-local --driver process`)

Run twice on the dev dataset (`b661cee…`, 2026-11-02 03:09 → 2026-11-03
03:09 UTC); both runs produced the byte-identical action log
(`6ad9048592b6f42bcbe8659cd449b965676ed917a202c37ac15f731ed48c0f61`, result
`d44fbdbf584acb054fd7090677ac22922a43acd683dc0b5a35bab5813d0dd819`):

| metric | value |
| --- | --- |
| net PnL | **+0.3786 SOL** (+3.79% on 10 SOL) |
| max drawdown | 2.21% (limit 50%) |
| win rate | 29.6% (16 of 54 round trips) |
| round trips | 54 |
| distinct coins | 52 (bar: ≥ 20) |
| fills | 120 |
| curve fees | 0.0924 SOL |
| tx fees | 0.0130 SOL |
| rejected / failed txs | 0 / 4 |
| ranked | true |

`prize_eligible` is false only because of the two submission-time checks
(`no_transcripts`, `cost_unpriced`), which are satisfied by the submission
bundle, not by trading: net PnL is positive and every trading constraint
passes. The kit's own momentum baseline scores −9.45 SOL on the same grade,
so the bot is worth about +9.8 SOL against it. The dev window is brutal
(median coin never rises above its early price), and the final 6-hour window
is a fresh draw: the bot is built to lose a little per coin and to catch a
runner if one appears — on this dev window the top three coins made 98% of
the gains (without them net PnL is −0.03 SOL), so the result still rides on
a few runners.

## What the tuning showed

The first version scored −0.0347 SOL on the official grade: 51 trips, best
trip +0.003, every exit firing too early. Parameter sweeps over the dev
window (offline sim, mean over 4 fail keys; the sim was fixed first — it
only loaded the first of the dataset's three parts, so it scored a different
universe until that was corrected) found one live mechanism and a lot of
dead knobs:

- **The live mechanism is exit looseness, not entry selectivity.** Making
  entries pickier (higher `minPriceUp`, narrower age window) only cut the
  bleed to about −0.015 SOL: fewer trips, same tiny losses. But widening the
  hard stop from −6% to −15% and softening the fade exit from −1 SOL to
  −3 SOL over 15 slots flipped the grade to +0.20 SOL: positions that used
  to be dumped on ordinary volatility now survive long enough to catch a
  runner. The fade exit was the main culprit — an oracle check showed the
  entry signal's coins typically peak +54% (median) within 1200 slots of
  entry, but the old exits sold them before the rise.
- **Robustness, not a single peak.** The first tuned setting (`stopLoss`
  0.15, `fadeNetSol` 3.0, `minPriceUp` 0.18) sits inside a plateau, not on a
  spike: stopLoss 0.10–0.25 all score +0.19 to +0.21, fadeNetSol 2–5 all
  score +0.20 to +0.22, minPriceUp 0.15–0.18 all score +0.17 to +0.20 —
  and the chosen point stays positive even without its single best trip
  (+0.05 ex-best). The one sharp edge is `minPriceUp` above 0.20, where
  the runner that carries the result stops being entered.

## Fourth tuning round: net PnL +0.3187 → +0.3786 SOL (official)

The goal this round was net PnL. The official grade moved from +0.3187 to
**+0.3786 SOL** (+19%), with win rate 27.8% → 29.6% and coins 36 → 52.
(The offline sim's mean over fail keys 11/22/33/44 says +0.430; the
official harness draws its own failed-tx key, so the official +0.379 sits
below the sim mean but well above the previous +0.319 — and the two
official runs are byte-identical.)

The one live mechanism this round: **the per-order size cap**. The
harness caps each buy at 1% of the curve's real reserves per batch
(`max_order_bps_of_real_reserve: 100`), so the fixed rung sizes never
mattered — every rung-size variant scored identically, because the cap,
not the `want`, bound every buy. The fix was a new `addStep`/`addSol`
mechanism: once the two rungs are used, keep adding on every further 2%
step-up while net flow stays positive, up to `maxPerCoin` 2.4 SOL. That
alone lifted the sim from +0.319 to +0.427; the top trip grew from +0.257
to +0.314 (fail key 11). The mechanism is a plateau, not a spike:
addStep 0.01–0.02, addSol 0.5–1.0 and maxPerCoin 2.4–4.0 all score +0.427
in the sim, and the chosen point (0.02 / 0.5 / 2.4) sits in the middle.

Two more small changes, both in the same direction (more chances to catch
a runner, still cheap per coin):
- `minAge` 150 → **100** slots: coins 36 → 52, sim +0.427 → +0.428,
  wins 11 → 16 — and the eligibility margin grows from 80% to 160%
  above the 20-coin bar, which also covers the "quiet final window"
  risk flagged last round. `minAge` 100 with `maxAge` 450 is slightly
  worse (+0.421); `minPriceUp` 0.15 dilutes to +0.416.
- `probeSol` was tested at 0.02 (+0.430 sim mean, 18 wins) but kept at
  **0.01**: the mean gain is 0.002 (noise), while 0.01 has the better
  worst fail key (+0.422 vs +0.392) and stays positive without its best
  two trips (+0.009 vs −0.007). Robustness over a rounding error.

What did *not* move the net, all swept and recorded as dead knobs this
round: `nearHigh` / `minBuyers` / `minNetSol` / `minWhaleSol` (identical
scores — the binding filters are `minPriceUp`/`minAge`/`maxAge`);
`maxMain` / `maxExposureSol` (never bind); `maxHold` / `holdIfUp`
(1200–4800 identical); `creatorSellCooldown` / `maxEntries` / `cooldown`;
`maxPriceUp` / `minRqSol` / `buySlipBps`; `fadeWindow` 10 ≈ 15, but
`fadeNetSol` 4–6 and `fadeWindow` 25 are clearly worse (+0.23–0.24);
`trail` 0.2 is worse (+0.338) than 0.1; a `fadeSkipUp` exemption (skip
the fade exit while a position is up) changes nothing — the winner
exits on its trailing stop, not on fade. Sharper edges, all flagged:
earlier rungs (+25%/+50%) collapse the run to −0.27; `window` 30 drops
it to +0.259; `probeSol` 0.05 drops it to +0.038; `stopLoss` 0.20 drops
it to +0.276 (bigger positions make a looser stop cost more);
`maxRqSol` 100 drops it to +0.392.

Robustness of the chosen point (sim, mean over fail keys 11/22/33/44):
worst fail key +0.422, ex-best +0.058; the official grade's own
accounting is sterner — top three coins made 90% of the gains, without
them net PnL is −0.03 SOL — so the result still rides on a few runners,
and the dev window is not the final window. Fees rose with the bigger
positions (curve 0.0924 + tx 0.0130 SOL); at 2× fees the official net
would be +0.2695 SOL, still positive.

## Third tuning round: win rate 15.7% → 27.8%

The goal this round was win rate, with net PnL not allowed to fall below
+0.20 SOL. The official grade moved from 15.7% wins / +0.3320 SOL to
**27.8% wins / +0.3187 SOL** — win rate up 12.1 points, net PnL down only
0.0133 SOL. (The offline sim says 30.6% wins / +0.3195 SOL; the official
harness's own failed-tx draw flips one trip to a loss, so the official
27.8% is the honest number.)

What actually moved the win rate — and what did not:

- **The probes were the drag.** With probes on, 51 trips included ~15
  guardrail probe round trips, ~14 of them losses (a probe buys 0.01 SOL
  and sells at once, so it loses the curve fee almost every time).
  `maxProbes: 1 → 0` cut trips 51 → 36 and lifted the win rate from
  17.6% to 28.5% in the sim at nearly unchanged net PnL (+0.300 vs
  +0.287). Keeping probes on a slower pace (paceSecs 21600, targetCoins
  25) keeps 54 coins and 27.8% wins at +0.310 net — the safer variant if
  the final window turns out much quieter — but the chosen setting takes
  the higher win rate and net, with 36 coins still 80% above the 20 bar.
- **The trailing stop finally fires.** `trailArm 0.5 → 0.1, trail 0.3 →
  0.1` is a sharp single cell: 30.6% wins in the sim vs 22–25% for every
  neighbouring trail setting. It converts ~3 trips that peak ~+10% and
  fade into small wins instead of stop-loss exits. Sharpness flagged:
  if the trail effect does not reproduce on the final window, the
  fallback is still ~22% wins at ~+0.30 net — still above the old 15.7%.
- **Looser fade.** `fadeNetSol 2.0 → 3.0` (with stopLoss 0.13) holds
  30.6% wins at +0.317–0.319 net; fade 3–6 is a flat plateau at
  stopLoss 0.13–0.16, so 3.0 sits in the middle of it. stopLoss 0.18
  also reaches 31.3% wins but with net +0.257 and ex-best ≈ 0.000
  (the whole net rides on the best trip), so it was not chosen.
- **Dead knobs for win rate:** entry strictness (higher `minPriceUp` /
  `minBuyers` / `minNetSol` *lowers* wins — the trips that drop out
  include winners), `maxHold` / `holdIfUp` (most trips exit via
  stop/fade long before the hold limit; maxHold 600 only cuts net to
  +0.205), smaller rungs / `maxPerCoin` / `maxEntries`.
- **Robustness:** stopLoss 0.13–0.16 × fadeNetSol 3–6 all score 30.6–
  31.3% wins at +0.303–0.319 net in the sim; worst fail key +0.319,
  ex-best +0.062 (net stays positive without the best trip). Max
  drawdown 0.83%, 36 coins, 77 fills.

The trade, stated plainly: win rate is up because the run now *counts
fewer losing trips*, not because it found more winners — absolute wins
went 8 → 10 (official) while losing trips fell 43 → 26. And win rate
is not what this bounty pays for: it ranks by net PnL, so a higher win
rate with a lower net would be a worse entry. Here net PnL is nearly
unchanged (+0.3187 vs +0.3320), so the win-rate gain is free — but the
result still rides on the top three coins (98% of gains; −0.03 SOL
without them), and the dev window is not the final window.

## Second tuning round: +0.1991 → +0.3320 SOL

A second sweep (same offline sim, mean over 4 fail keys, then the official
grade twice) pushed the dev-window net PnL from +0.1991 to **+0.3320 SOL**
(+67%). Only four parameters changed from the first tuned setting:

- `rungs`: +50%/+100% → **+35%/+65%** — adding size earlier, while the
  coin is still climbing, is worth about +0.03 SOL on its own; combined
  with the longer hold it is worth more. The second rung's size (0.9 vs
  1.1 SOL) makes no difference, and neither does `maxPerCoin` above 1.2 —
  the rung rarely fills at full size.
- `maxHold`: 1200 → **2400 slots** — winners get twice as long to run
  (+0.008 alone, more in combination); 4800+ is worse again, so 2400 is
  the plateau centre.
- `fadeNetSol`: 3.0 → **2.0** — cutting a little earlier on flow reversal
  helps once the pyramid is earlier (fade 2–3 all stay positive; fade 1.5
  collapses to ~0, a cliff one coin's flow pattern creates, so 2.0 sits
  just above it — flagged, not hidden).
- `stopLoss`: 0.15 → **0.13** — the middle of the 0.10–0.14 plateau at
  fade 2.0 (0.10, 0.12 and 0.14 all score +0.320 to +0.333).

Neighbourhood of the final point (sim mean over 4 fail keys): rungs
+35%/+65% vs +35%/+70% vs +35%/+75% score +0.333 / +0.321 / +0.329;
stopLoss 0.10–0.14 at fade 2.0 score +0.320 to +0.333; fade 2.5/3.0 score
+0.297/+0.285. Worst fail key +0.332, ex-best +0.077, ex-best-two +0.011
— the point survives removing its best two trips in the sim. The
official grade's own accounting is sterner: its top three coins made 99%
of the gains, and without them net PnL is −0.05 SOL, so the result still
rides on a few runners — that is the strategy's shape, not a bug.
- **Dead knobs in round two** (no measurable effect): `trail`/`trailArm`
  (the trailing stop still never fires before another exit), `maxMain`,
  `maxExposureSol`, `holdIfUp`, `cooldown`, `window` (20 stays best),
  `minPriceUp` 0.18 stays best (0.15 adds coins but dilutes to +0.325,
  0.20 drops to +0.284), age window 150–300 stays best, `probeSol` 0.01
  stays best.
- The kit's own momentum baseline scores −9.45 SOL on the same official
  grade, so probe-pyramid's risk control is worth about +9.8 SOL against
  it — but this dev window is brutal (median coin never rises above its
  early price; only 1 of 232 coins went 5x), and the final 6-hour window
  is a fresh draw: the bot is a qualified, positive-expectation-shaped
  entry: tiny downside per coin, uncapped upside if it catches a runner.

## Run it

```sh
node main.ts   # the grader runs this; it speaks agent-fun/replay/v2 on stdin/stdout
```

