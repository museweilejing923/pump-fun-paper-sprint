// Diagnostic: which of the dataset's biggest forward movers did we trade, and how did each trip end?
//   node tools/diag.ts <kit dir> [params json]

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from './sim.ts';

const [kit, paramsJson] = process.argv.slice(2);
if (kit === undefined) {
  console.error('usage: node tools/diag.ts <kit dir> [params json]');
  process.exit(2);
}
const params: Params = { ...DEFAULT_PARAMS, ...(paramsJson ? (JSON.parse(paramsJson) as Partial<Params>) : {}) };
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const r = simulate(ds, hello, createStrategy(params), { failKey: 11n });
const trips = [...r.trips].sort((a, b) => Number(b.pnl - a.pnl));
console.log(`net ${(Number(r.netPnl) / 1e9).toFixed(4)} trips ${trips.length} coins ${r.mints}`);
console.log('--- top 15 trips by pnl (SOL) ---');
for (const t of trips.slice(0, 15)) {
  console.log(`${(Number(t.pnl) / 1e9).toFixed(4)}  ${t.mint}  slots ${t.open}->${t.close}`);
}
console.log('--- bottom 10 trips ---');
for (const t of trips.slice(-10)) {
  console.log(`${(Number(t.pnl) / 1e9).toFixed(4)}  ${t.mint}  slots ${t.open}->${t.close}`);
}
// How much did we make/lose on the coins that actually ran? perMint top/bottom:
const pm = [...r.perMint.entries()].sort((a, b) => Number(b[1] - a[1]));
console.log('--- top 10 coins by total pnl ---');
for (const [m, v] of pm.slice(0, 10)) console.log(`${(Number(v) / 1e9).toFixed(4)}  ${m}`);
console.log('--- bottom 10 coins by total pnl ---');
for (const [m, v] of pm.slice(-10)) console.log(`${(Number(v) / 1e9).toFixed(4)}  ${m}`);
