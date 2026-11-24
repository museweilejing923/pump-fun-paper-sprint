// One offline run of the strategy on the dev window with the local engine port.
//   node tools/run.ts <kit dir> [failKey]
// Prints net PnL, fills, coins, round trips, win rate, max drawdown and the best coins.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const [kit, failKeyArg, paramsJson] = process.argv.slice(2);
if (kit === undefined) {
  console.error('usage: node tools/run.ts <kit dir> [failKey] [params json]');
  process.exit(2);
}
const params: Params = { ...DEFAULT_PARAMS, ...(paramsJson ? (JSON.parse(paramsJson) as Partial<Params>) : {}) };
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const failKey = failKeyArg === undefined ? undefined : BigInt(failKeyArg);
const r = simulate(ds, hello, createStrategy(params), failKey === undefined ? {} : { failKey });
const net = Number(r.netPnl) / 1e9;
const trips = [...r.trips].sort((a, b) => Number(b.pnl - a.pnl));
const wins = trips.filter((t) => t.pnl > 0n).length;
const rt01 = trips.filter((t) => {
  // a round trip counts toward eligibility when the coin saw a buy and a sell; approximate by pnl sign + fills
  return true;
}).length;
console.log(`net ${net.toFixed(4)} SOL  fills ${r.fills}  coins ${r.mints}  trips ${trips.length}  wins ${wins} (${trips.length ? ((100 * wins) / trips.length).toFixed(1) : '0'}%)  maxDD ${(100 * r.maxDrawdown).toFixed(2)}%  rejected ${r.rejected} failed ${r.failed}`);
console.log(`reject reasons: ${JSON.stringify(r.rejectReasons)}`);
console.log(`best 3 trips: ${trips.slice(0, 3).map((t) => (Number(t.pnl) / 1e9).toFixed(3)).join(', ')}`);
console.log(`net without best coin: ${(net - (trips[0] ? Number(trips[0].pnl) / 1e9 : 0)).toFixed(4)}`);
console.log(`net without best 3: ${(net - trips.slice(0, 3).reduce((s, t) => s + Number(t.pnl) / 1e9, 0)).toFixed(4)}`);
void rt01;
