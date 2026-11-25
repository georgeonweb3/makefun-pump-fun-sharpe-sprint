// HotLaunch: buy only the hottest launches, sized up, and ride them briefly.
//
// Data finding (dev window, 1222 universe coins): coins with >=10 trades in their CREATE slot
// are the highest-velocity launches. Bought at the fill (2 slots later) with TP +20-30% / SL -8%
// / hold <=300-600 slots, they win ~50-75% and net +0.8 SOL over 24h at 0.5 SOL stakes in the
// path backtest. Everything broader loses: the median coin spikes +19% in slot 1 and decays, so
// buying ordinary launches means buying the top of the creator spike. The filter is the edge.
//
// Tier B (coverage) exists only for the 20-counted-mints guardrail: when counted mints lag the
// pace, buy 0.01 SOL of a merely-warm launch (few slot-0 trades) and exit fast. Its cost is
// bounded and measured separately. Pure function of the batches: no clock, no randomness, no I/O.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Slot-0 trades needed for a Tier A (hot) buy. */
  minTradesHot: number;
  /** Slot-0 distinct non-creator buyers needed for Tier A. */
  minBuyersHot: number;
  /** Slot-0 gross buy SOL (lamports) needed for Tier A. */
  minBuySolHot: number;
  /** Tier A stake (lamports); the 1%-of-real-reserve cap applies too. */
  stakeHot: number;
  /** Tier A exits. */
  tpBpsHot: number;
  slBpsHot: number;
  maxHoldHot: number;
  /** Trailing stop for Tier A (0 = off). */
  trailArmBpsHot: number;
  trailBpsHot: number;
  /** Tier B (coverage): slot-0 trades needed, stake, exits. 0 stake disables it. */
  minTradesCov: number;
  minBuyersCov: number;
  stakeCov: number;
  tpBpsCov: number;
  slBpsCov: number;
  maxHoldCov: number;
  /** Coverage pacing: target counted mints over paceSecs of block time. */
  targetCoins: number;
  paceSecs: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
}

export const DEFAULT_PARAMS: Params = {
  // Locked after the dev-window sweeps (see README): minTradesHot 12 / TP +18% is the
  // robust peak. TP +22% falls off a cliff (positions decay before the take-profit), and
  // trailing stops lose money (thin-curve noise triggers them early).
  minTradesHot: 12,
  minBuyersHot: 0,
  minBuySolHot: 0,
  stakeHot: 500_000_000,
  tpBpsHot: 1800,
  slBpsHot: 800,
  maxHoldHot: 600,
  trailArmBpsHot: 0,
  trailBpsHot: 0,
  minTradesCov: 3,
  minBuyersCov: 0,
  stakeCov: 10_000_000,
  tpBpsCov: 1000,
  slBpsCov: 1000,
  maxHoldCov: 60,
  targetCoins: 25,
  paceSecs: 21_600,
  exitOnDevSell: true,
  buySlippageBps: 10_000,
  cooldown: 30,
};

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  trades0: number;
  buyers0: Set<Pubkey>;
  buySol0: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  entries: number;
  lastExit: number;
  done: boolean;
  complete: boolean;
  tier: number; // 0 = none, 1 = hot, 2 = coverage
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  devSoldAtOpen: boolean;
  tier: number;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

const FEE_BPS = 125n;

function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Strategy {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  const selling = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  /** Mints with a filled buy of >= 0.01 SOL (guardrail-counted, approximately). */
  const counted = new Set<Pubkey>();

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.block_time !== null) {
        if (firstTime === null) firstTime = e.block_time;
        if (e.block_time > (lastTime ?? 0)) lastTime = e.block_time;
      }
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint, createSlot: e.slot, creator: e.creator,
          trades0: 0, buyers0: new Set(), buySol0: 0n, devSold: false,
          lastTradeSlot: e.slot, entries: 0, lastExit: -1e12, done: false, complete: false, tier: 0,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        c.lastTradeSlot = e.slot;
        if (e.slot === c.createSlot) {
          c.trades0 += 1;
          if (e.is_buy) {
            c.buySol0 += BigInt(e.sol_amount);
            if (e.user !== c.creator) c.buyers0.add(e.user);
          } else if (e.user === c.creator) {
            c.devSold = true;
          }
        } else if (!e.is_buy && e.user === c.creator) {
          c.devSold = true;
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) { c.complete = true; c.done = true; }
      }
    }
  }

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') return true;
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') return true;
    return false;
  }

  return {
    onBatch(state, batch) {
      readEvents(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        if (f.status === 'filled' && f.side === 'buy' && BigInt(f.quote_lamports) >= 10_000_000n) counted.add(f.mint);
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          const c = coins.get(f.mint);
          held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n, devSoldAtOpen: c?.devSold ?? false, tier: c?.tier ?? 0 });
        }
      }
      for (const mint of [...selling]) if (!hasPendingSell(state, mint)) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) {
          held.delete(mint);
          const c = coins.get(mint);
          if (c !== undefined) c.lastExit = state.slot;
        }
      }

      // Exits first (per-tier rules).
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, devSoldAtOpen: c?.devSold ?? false, tier: c?.tier ?? 0 };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        if (value > h.best) h.best = value;
        const hot = h.tier !== 2;
        const tp = hot ? P.tpBpsHot : P.tpBpsCov;
        const sl = hot ? P.slBpsHot : P.slBpsCov;
        const maxHold = hot ? P.maxHoldHot : P.maxHoldCov;
        const trailArm = hot ? P.trailArmBpsHot : 0;
        const trail = hot ? P.trailBpsHot : 0;
        let exit = false;
        if (basis > 0n) {
          if (value * BPS >= basis * (BPS + BigInt(tp))) exit = true;
          if (value * BPS <= basis * (BPS - BigInt(sl))) exit = true;
          if (trailArm > 0 && h.best * BPS >= basis * (BPS + BigInt(trailArm)) && value * BPS <= h.best * (BPS - BigInt(trail))) exit = true;
        }
        if (state.slot - h.openedSlot >= maxHold) exit = true;
        if (c !== undefined && P.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // Entries: only on the create batch itself (age 0). The slot-0 tape is complete by then.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      const needCoverage = (() => {
        if (P.stakeCov <= 0 || firstTime === null || lastTime === null) return false;
        const pace = Math.min(1, (lastTime - firstTime) / P.paceSecs);
        return counted.size < Math.ceil(P.targetCoins * pace);
      })();
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        if (state.slot !== c.createSlot) {
          // Past the create batch without a decision: never buy it.
          if (state.slot > c.createSlot) c.done = true;
          continue;
        }
        if (c.entries > 0 || state.slot - c.lastExit < P.cooldown) continue;
        if (c.devSold) { c.done = true; continue; }
        if (open >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        let tier = 0;
        let stake = 0n;
        if (c.trades0 >= P.minTradesHot && c.buyers0.size >= P.minBuyersHot && c.buySol0 >= BigInt(P.minBuySolHot)) {
          tier = 1;
          stake = BigInt(P.stakeHot);
        } else if (needCoverage && c.trades0 >= P.minTradesCov && c.buyers0.size >= P.minBuyersCov) {
          tier = 2;
          stake = BigInt(P.stakeCov);
        }
        if (tier === 0) { c.done = true; continue; }
        const maxBuy = state.maxBuyLamports(c.mint);
        const amount = stake < maxBuy ? stake : maxBuy;
        if (amount < 10_000_000n && tier === 2) { c.done = true; continue; }
        if (amount < 5_000_000n) { c.done = true; continue; }
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        c.tier = tier;
        c.entries += 1;
        open += 1;
      }
      return orders;
    },
  };
}
