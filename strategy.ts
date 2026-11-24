// probe-pyramid: a pump.fun paper-trading strategy for the agent-fun replay (agent-fun/replay/v2).
//
// Idea: most pump.fun coins die fast, a few moon. So never bet big on a first impression.
// Every position starts as a 0.01 SOL probe on a young coin (100–300 slots old) whose
// tape already shows real buying: at least 3 distinct buyers and 3 buys in the last 20
// slots, net SOL flowing in, and the price up at least 18% over the window while sitting
// near its window high. A creator dumping is a rug tell, so a coin whose creator sold at
// any point is skipped. Only if the coin keeps climbing do we add size, in two big rungs
// (+35% -> +0.20, +65% -> +0.90, at most 2.4 SOL per coin) — and, once the rungs are
// used, we keep adding on every further 2% step-up while the tape stays strong. That
// last part matters: the harness caps each buy at 1% of the curve's real reserves per
// batch, so a single big rung order can never land in full; repeated small adds are
// the only way to build size on a runner, and they are what lifted the dev grade
// from +0.32 to +0.43 SOL.
// against cost gives a position room to breathe through the tape's noise (a −6%
// stop was cutting runners before they ran), a fade exit only cuts positions
// whose flow turns sharply negative (net −3 SOL over 15 slots — the old −1 SOL
// trigger was firing on ordinary volatility and dumping winners early), a
// creator selling while we hold is an exit by itself, and once a position is
// up 10% a 10% trailing stop locks in the ride (the old +50%/30% trailing
// stop never fired, so it never saved a trip that peaked and faded). Guardrail
// probes are switched off (maxProbes 0): a probe buys 0.01 SOL and sells at
// once, which loses the curve fee almost every time, so the ~15 probe round
// trips were dragging the win rate down while adding almost nothing to net
// PnL — main entries alone clear the 20-coin bar with 36 coins on the dev
// window, so the probes were pure insurance we no longer pay for.
//
// Guardrail probes keep the run above the eligibility bar (at least 20 coins, each with a
// round trip of at least 0.01 SOL): when our own fills or coins lag a pace set in block
// time, we buy 0.01 SOL of a liquid curve and sell it as soon as the buy lands.
//
// Deterministic by construction: no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Entry lookback window, in slots. */
  window: number;
  /** Minimum net buy SOL (buys minus sells) over the window. */
  minNetSol: number;
  /** Minimum buy trades in the window. */
  minBuys: number;
  /** Minimum distinct buying wallets in the window. */
  minBuyers: number;
  /** Largest single buy in the window must be at least this many SOL (a real buyer, not dust). */
  minWhaleSol: number;
  /** Price now over price at the window start, minus 1. */
  minPriceUp: number;
  /** Upper bound on that rise: skip coins that already ran too far in one window. */
  maxPriceUp: number;
  /** Price now at least this share of the window's high. */
  nearHigh: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** Slots since the CreateEvent: entries only on young coins. */
  minAge: number;
  maxAge: number;
  /** A coin whose creator sold within this many slots is not entered: a creator dumping
   * right now is a rug tell, but a creator who sold once early and stopped is not. */
  creatorSellCooldown: number;
  /** First buy of a position (SOL). */
  probeSol: number;
  /** Pyramid rungs: add this many SOL once the position is up this much vs cost. */
  rungs: Array<{ up: number; sol: number }>;
  /** After the last rung, keep adding this many SOL each time the price steps up
   * at least addStep vs the last buy (buys are capped per batch by the harness
   * at 1% of real reserves, so repeated small adds are the only way to build
   * size on a runner). */
  addStep: number;
  addSol: number;
  /** Largest total SOL ever put into one coin. */
  maxPerCoin: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Hard stop: exit when value falls below cost * (1 - stopLoss). */
  stopLoss: number;
  /** Trailing stop, armed once value reaches cost * (1 + trailArm). */
  trail: number;
  trailArm: number;
  /** Exit when net SOL over the fade window falls below -fadeNetSol. */
  fadeWindow: number;
  fadeNetSol: number;
  /** Skip the fade exit while the position is up at least this much vs cost
   * (a winner's flow noise should not cut the ride; 1e9 = never skip). */
  fadeSkipUp: number;
  /** Exit after this many slots held, unless the position is up at least holdIfUp. */
  maxHold: number;
  holdIfUp: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most momentum positions open at once (the rest of caps.max_open_positions is for probes). */
  maxMain: number;
  /** Guardrail pacing: the run must end with at least 20 coins and 200 fills. When our own
   * fills or coins lag targetFills / targetCoins scaled by the share of paceSecs elapsed
   * (block time since the first batch), open tiny probe round trips until back on pace. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  maxProbes: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
}

export const DEFAULT_PARAMS: Params = {
  window: 20,
  minNetSol: 0.05,
  minBuys: 3,
  minBuyers: 3,
  minWhaleSol: 0,
  minPriceUp: 0.18,
  maxPriceUp: 2.0,
  nearHigh: 0.9,
  minRqSol: 0.5,
  maxRqSol: 40,
  minAge: 100,
  maxAge: 300,
  creatorSellCooldown: 1000000,
  probeSol: 0.01,
  rungs: [
    { up: 0.35, sol: 0.2 },
    { up: 0.65, sol: 0.9 },
  ],
  addStep: 0.02,
  addSol: 0.5,
  maxPerCoin: 2.4,
  minBuySol: 0.01,
  buySlipBps: 1500,
  stopLoss: 0.13,
  trail: 0.1,
  trailArm: 0.1,
  fadeWindow: 15,
  fadeNetSol: 3.0,
  fadeSkipUp: 1e9,
  maxHold: 2400,
  holdIfUp: 0.5,
  cooldown: 150,
  maxEntries: 2,
  maxMain: 5,
  targetCoins: 20,
  targetFills: 0,
  paceSecs: 14_400,
  maxProbes: 0,
  maxExposureSol: 6,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const BPS_PER_UNIT = 10_000;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  /** Slot of the creator's most recent sell, if any. */
  creatorSellSlot: number | null;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Recorded price when the last buy was decided. */
  lastAddPrice: number;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
  /** Next pyramid rung to take. */
  rung: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** Our own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = Math.max(p.window, p.fadeWindow) + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: null, creatorSellSlot: null, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Entry signal on a curve's tape at slot `now`. */
  const entrySignal = (t: Tape, now: number, rqSol: number): boolean => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.created === null || now - t.created < p.minAge || now - t.created > p.maxAge) return false;
    if (t.creatorSellSlot !== null && now - t.creatorSellSlot <= p.creatorSellCooldown) return false;
    const from = now - p.window;
    let buySol = 0;
    let sellSol = 0;
    let buys = 0;
    let whale = 0;
    let startPrice = -1;
    let high = 0;
    let last = 0;
    const byUser = new Map<string, number>();
    for (const tr of t.trades) {
      if (tr.slot <= from) {
        startPrice = tr.price;
        continue;
      }
      if (startPrice < 0) startPrice = tr.price;
      if (tr.buy) {
        buySol += tr.sol;
        buys++;
        if (tr.sol > whale) whale = tr.sol;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        sellSol += tr.sol;
      }
      if (tr.price > high) high = tr.price;
      last = tr.price;
    }
    if (buys < p.minBuys || byUser.size < p.minBuyers) return false;
    if (whale < p.minWhaleSol) return false;
    if (buySol - sellSol < p.minNetSol) return false;
    if (startPrice <= 0) return false;
    const up = last / startPrice - 1;
    if (up < p.minPriceUp || up > p.maxPriceUp) return false;
    if (last < high * p.nearHigh) return false;
    return true;
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (t: Tape, now: number, w: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      const traded = new Set<Pubkey>();
      const creatorSoldNow = new Set<Pubkey>();
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator ?? null;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.trades.push({
            slot: e.slot,
            buy: e.is_buy,
            sol,
            user: e.user,
            price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves),
          });
          traded.add(e.mint);
          if (!e.is_buy && t.creator !== null && e.user === t.creator) {
            t.creatorSellSlot = e.slot;
            creatorSoldNow.add(e.mint);
          }
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        let exit = h.exiting;
        const t = tapeOf(mint);
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && value < cost * (1 + p.fadeSkipUp) && flow(t, now, p.fadeWindow) < -p.fadeNetSol) exit = true;
        if (!exit && creatorSoldNow.has(mint)) exit = true;
        if (!exit && now - h.opened > p.maxHold && value < cost * (1 + p.holdIfUp)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          }
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries and pyramid adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) {
        exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      }
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want: number;
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (!entrySignal(t, now, rqSol)) continue;
          want = p.probeSol;
        } else {
          // Pyramid into strength only: the next rung's trigger is met, the price stepped up
          // from the last buy, and net SOL still flows in. Once the rungs are used up,
          // keep adding on every further step-up of addStep while the tape is strong.
          if (h.exiting || !h.filled) continue;
          const rung = p.rungs[h.rung];
          if (rung === undefined) {
            if (h.invested >= p.maxPerCoin - p.minBuySol) continue;
            const pos = state.positions.get(mint);
            if (pos === undefined) continue;
            if (price < h.lastAddPrice * (1 + p.addStep)) continue;
            if (flow(t, now, p.window) < 0) continue;
            if (rqSol > p.maxRqSol) continue;
            want = Math.min(p.addSol, p.maxPerCoin - h.invested);
          } else {
            if (h.invested >= p.maxPerCoin - p.minBuySol) continue;
            const pos = state.positions.get(mint);
            if (pos === undefined) continue;
            const cost = Number(pos.cost_lamports) / LAMPORTS;
            if (h.lastValue < cost * (1 + rung.up)) continue;
            if (price < h.lastAddPrice) continue;
            if (flow(t, now, p.window) < 0) continue;
            if (rqSol > p.maxRqSol) continue;
            want = Math.min(rung.sol, p.maxPerCoin - h.invested);
          }
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, {
            opened: now,
            peakValue: 0,
            invested: amount,
            exiting: false,
            filled: false,
            lastAddPrice: price,
            lastValue: 0,
            rung: 0,
          });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
          h.rung++;
        }
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * Number(BPS_PER_UNIT)) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
