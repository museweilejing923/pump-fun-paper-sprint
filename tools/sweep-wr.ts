// Win-rate sweep: ranks parameter combos by mean win rate over 4 fail keys,
// subject to a net-PnL floor (default 0.20 SOL) and the eligibility bar (>=20 coins).
//
//   node tools/sweep-wr.ts <kit dir> '<base params json>' '<grid json: {"key":[v1,v2],...}>' [top N] [net floor]
//
// Prints win rate, net PnL, worst fail key, ex-best, trips, coins, fills, maxDD.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const [kit, baseJson, gridJson, topArg, floorArg] = process.argv.slice(2);
if (kit === undefined || gridJson === undefined) {
  console.error("usage: node tools/sweep-wr.ts <kit dir> '<base json>' '<grid json>' [top] [net floor]");
  process.exit(2);
}
const base = { ...DEFAULT_PARAMS, ...(JSON.parse(baseJson ?? '{}') as Partial<Params>) };
const grid = JSON.parse(gridJson) as Record<string, unknown[]>;
const floor = Number(floorArg ?? 0.2);
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const keys = Object.keys(grid);
const combos: Record<string, unknown>[] = [{}];
for (const k of keys) {
  const next: Record<string, unknown>[] = [];
  for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v });
  combos.splice(0, combos.length, ...next);
}
const FAIL_KEYS = [11n, 22n, 33n, 44n];
interface Row {
  c: Record<string, unknown>;
  wr: number;
  net: number;
  worst: number;
  exBest: number;
  trips: number;
  wins: number;
  coins: number;
  fills: number;
  dd: number;
}
const rows: Row[] = [];
for (const c of combos) {
  let netSum = 0;
  let wrSum = 0;
  let worst = Infinity;
  let exBest = 0;
  let trips = 0;
  let wins = 0;
  let coins = Infinity;
  let fills = Infinity;
  let dd = 0;
  for (const failKey of FAIL_KEYS) {
    const r = simulate(ds, hello, createStrategy({ ...base, ...c } as Params), { failKey });
    const pnl = r.trips.map((t) => Number(t.pnl) / 1e9).sort((a, b) => b - a);
    const net = Number(r.netPnl) / 1e9;
    const w = r.trips.filter((t) => t.pnl > 0n).length;
    netSum += net;
    wrSum += r.trips.length ? w / r.trips.length : 0;
    worst = Math.min(worst, net);
    exBest += (net - (pnl[0] ?? 0)) / FAIL_KEYS.length;
    trips = r.trips.length;
    wins = w;
    coins = Math.min(coins, r.mints);
    fills = Math.min(fills, r.fills);
    dd = Math.max(dd, r.maxDrawdown);
  }
  rows.push({ c, wr: wrSum / FAIL_KEYS.length, net: netSum / FAIL_KEYS.length, worst, exBest, trips, wins, coins, fills, dd });
}
const eligible = rows.filter((r) => r.net >= floor && r.coins >= 20);
eligible.sort((a, b) => b.wr - a.wr);
console.log(`combos ${rows.length}, net>=${floor} & coins>=20: ${eligible.length}`);
for (const r of eligible.slice(0, Number(topArg ?? 25))) {
  console.log(
    `wr ${(100 * r.wr).toFixed(1)}% net ${r.net.toFixed(3)} worst ${r.worst.toFixed(3)} exBest ${r.exBest.toFixed(3)} trips ${r.trips} wins ${r.wins} coins ${r.coins} fills ${r.fills} dd ${r.dd.toFixed(3)} ${JSON.stringify(r.c)}`,
  );
}
// Also show the best net overall for reference.
const byNet = [...rows].sort((a, b) => b.net - a.net)[0]!;
console.log(`best-net overall: wr ${(100 * byNet.wr).toFixed(1)}% net ${byNet.net.toFixed(3)} ${JSON.stringify(byNet.c)}`);
