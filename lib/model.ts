// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   baseMultiple = clamp(BASE_MULTIPLE x (1 + TVL_LOG_WEIGHT x log10(REFERENCE_TVL / tvl_usd)),
//                        BASE_MULTIPLE_MIN, BASE_MULTIPLE_MAX)
//   base         = tvl_usd x baseMultiple                    (log-compressed fee-capture multiple)
//   growth       = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) per cent
//   growthMult   = 1 + GROWTH_WEIGHT x tanh(growth / GROWTH_SCALE)
//   maturity     = MATURITY_FLOOR + min(age_days, MATURITY_DAYS) / MATURITY_DAYS x MATURITY_RANGE
//   categoryMult = a small, stated adjustment for the protocol's category
//   implied      = max(1, round(base x growthMult x maturity x categoryMult))
//
// The log term keeps the largest protocol from taking the whole board, tanh keeps the seven-day
// growth factor mild and monotonic, and maturity grows with the time a protocol has run with no token,
// capped at four years. The constants are stated in the dashboard and changeable in the model sandbox.
// No protocol name is ever special-cased: the same function scores every pre-token row and every
// live-token comparison row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  reference_tvl_usd: number;
  tvl_log_weight: number;
  base_multiple_min: number;
  base_multiple_max: number;
  growth_weight: number;
  growth_scale: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  anchor_weight: number;
  anchor_floor: number;
  anchor_cap: number;
  anchor_min_peers: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.34,
  reference_tvl_usd: 100_000_000,
  tvl_log_weight: 0.55,
  base_multiple_min: 0.05,
  base_multiple_max: 0.9,
  growth_weight: 0.32,
  growth_scale: 22,
  growth_floor: -80,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.55,
  maturity_days: 1460,
  unknown_age_days: 365,
  anchor_weight: 0.15,
  anchor_floor: 0.75,
  anchor_cap: 1.35,
  anchor_min_peers: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 136;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token' | 'live-token';
  age_days: number | null;
  implied_value_usd: number;
  model_implied_usd: number;
  anchor_multiplier: number;
  peer_median_tvl_mcap: number | null;
  peer_count: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the model's inputs and the board's farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token' | 'live-token';
  implied_value_usd: number;
  model_implied_usd: number;
  anchor_multiplier: number;
  peer_median_tvl_mcap: number | null;
  peer_count: number;
  base_multiple: number;
  category_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so its market cap is a fact and the model is a comparison. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  implied_value_usd: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  pre_token_size: number;
  live_size: number;
  live_token_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A small, stated adjustment for what a category's token may capture; no protocol name is read. */
export function categoryMultiplier(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c === 'chain') return 1.06;
  if (c.includes('dex')) return 1.04;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 1.05;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) return 1.03;
  if (c.includes('rwa')) return 1.01;
  if (c.includes('insurance')) return 0.99;
  if (c.includes('bridge')) return 0.97;
  if (c.includes('curator') || c.includes('allocator')) return 0.95;
  if (c.includes('derivative') || c.includes('perpetual')) return 1.02;
  if (c.includes('stable')) return 1.02;
  if (c.includes('payment') || c.includes('privacy')) return 0.98;
  return 1;
}

/** The log-compressed TVL multiple and the three multipliers the implied value uses. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; baseMultiple: number; categoryMult: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + model.growth_weight * Math.tanh(growthPct / model.growth_scale);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const tvl = Math.max(1, protocol.tvl_usd);
  const rawBaseMultiple = model.base_multiple * (1 + model.tvl_log_weight * Math.log10(model.reference_tvl_usd / tvl));
  const baseMultiple = Math.min(model.base_multiple_max, Math.max(model.base_multiple_min, rawBaseMultiple));
  const categoryMult = categoryMultiplier(protocol.category);
  const base = tvl * baseMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * categoryMult));
  return { implied, baseMultiple, categoryMult, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  pre_token_size: number;
  live_size: number;
  live_token_size: number;
}

/** The live-token protocols below the floor that ride along as already-issued comparisons, by TVL. */
function liveComparisonProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS);
}

/** A category's live-token TVL/market-cap median: the snapshot's own comparable valuation anchor. */
export interface CategoryAnchor {
  category: string;
  median_tvl_mcap: number;
  count: number;
}

export function categoryAnchors(snapshot: Snapshot): Map<string, CategoryAnchor> {
  const groups = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === null || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.tvl_usd / p.mcap_usd;
    const list = groups.get(p.category);
    if (list) list.push(ratio);
    else groups.set(p.category, [ratio]);
  }
  const out = new Map<string, CategoryAnchor>();
  for (const [category, ratios] of groups) {
    ratios.sort((a, b) => a - b);
    const n = ratios.length;
    const median = n % 2 === 1 ? ratios[(n - 1) / 2]! : (ratios[n / 2 - 1]! + ratios[n / 2]!) / 2;
    out.set(category, { category, median_tvl_mcap: median, count: n });
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  // Already-issued comparison rows: the token is a fact, so the row is labelled live-token and its
  // modelled value is shown beside the market cap, never mixed into the pre-token claim.
  for (const p of liveComparisonProtocols(snapshot)) chosen.set(p.slug, p);

  const anchors = categoryAnchors(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    const anchor = p.category === null ? undefined : anchors.get(p.category);
    const peerMedian = anchor === undefined ? null : anchor.median_tvl_mcap;
    const peerCount = anchor === undefined ? 0 : anchor.count;
    let anchorMultiplier = 1;
    if (isPreToken(p) && anchor !== undefined && anchor.count >= model.anchor_min_peers) {
      const anchorImplied = p.tvl_usd / anchor.median_tvl_mcap;
      const raw = Math.pow(anchorImplied / v.implied, model.anchor_weight);
      anchorMultiplier = Math.min(model.anchor_cap, Math.max(model.anchor_floor, raw));
    }
    const implied = Math.max(1, Math.round(v.implied * anchorMultiplier));
    return { p, implied, modelImplied: v.implied, anchorMultiplier, peerMedian, peerCount, baseMultiple: v.baseMultiple, categoryMult: v.categoryMult, growthPct: v.growthPct, growthMult: v.growthMult, maturityMult: v.maturityMult, age: v.age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: isPreToken(s.p) ? 'pre-token' : 'live-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model_implied_usd: s.modelImplied,
    anchor_multiplier: round4(s.anchorMultiplier),
    peer_median_tvl_mcap: s.peerMedian === null ? null : round4(s.peerMedian),
    peer_count: s.peerCount,
    model: {
      base_multiple: round4(s.baseMultiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_multiplier: round4(s.categoryMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much a first farm position needs, from the protocol's own TVL scale. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 40;
  return 30;
}

/** A chain's rough gas level, so every plan quotes a chain-specific cost instead of one flat number. */
interface ChainGas {
  label: string;
  setup: string;
  weekly: string;
  exit: string;
  bridge: string;
  buffer: string;
}

function chainGas(chain: string): ChainGas {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) {
    return { label: 'Ethereum gas', setup: '$4-15', weekly: '$2-8', exit: '$4-15', bridge: '$8-25', buffer: '$15-30' };
  }
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('hyperliquid') || c.includes('sei') || c.includes('sonic')) {
    return { label: 'low-fee chain gas', setup: 'under $0.10', weekly: 'under $0.05', exit: 'under $0.10', bridge: '$0.10-0.60', buffer: 'under $2' };
  }
  if (c.includes('tron')) {
    return { label: 'Tron bandwidth/energy', setup: '$0.50-2', weekly: '$0.30-1', exit: '$0.50-2', bridge: '$1-4', buffer: '$3-8' };
  }
  if (c.includes('binance') || c.includes('bsc') || c.includes('bnb')) {
    return { label: 'BNB Chain gas', setup: '$0.20-0.80', weekly: '$0.15-0.60', exit: '$0.20-0.80', bridge: '$0.50-2', buffer: '$2-6' };
  }
  if (c.includes('bitcoin') || c.includes('lightning') || c.includes('btc')) {
    return { label: 'Bitcoin fees', setup: '$1-6', weekly: '$0.50-3', exit: '$1-6', bridge: '$2-8', buffer: '$8-20' };
  }
  if (c.includes('avalanche') || c.includes('polygon') || c.includes('gnosis') || c.includes('fantom')) {
    return { label: 'low-cost EVM gas', setup: '$0.05-0.30', weekly: '$0.03-0.20', exit: '$0.05-0.30', bridge: '$0.50-2', buffer: '$2-6' };
  }
  return { label: 'chain gas', setup: '$0.05-0.60', weekly: '$0.05-0.30', exit: '$0.05-0.60', bridge: '$0.30-2', buffer: '$2-6' };
}

/** The category's action, its exit trigger and its setup time, in words a farmer can follow. */
interface CategoryPlan {
  action: string;
  exit: string;
  time: string;
}

function categoryPlan(p: SnapshotProtocol, capital: number, chain: string): CategoryPlan {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return {
      action: `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain}; start with one range and keep half in the base asset.`,
      exit: `Exit if 7-day volume halves, fee APR drops below 10%, or price leaves your range for two days; withdraw both tokens.`,
      time: '25 minutes to set up',
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow at most 25% against it if the protocol rewards borrowing.`,
      exit: `Exit if utilization stays above 90%, borrow APR doubles, or health factor falls under 1.5; repay first, then withdraw.`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('synthetic')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge or basis position.`,
      exit: `Exit if funding turns against you for two days, margin ratio falls under 150%, or open interest halves; close the perp first.`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('yield')) {
    return {
      action: `Deposit $${capital} of USDC into ${name}'s vault on ${chain} and keep the receipt token in the same wallet.`,
      exit: `Exit if reported APY halves, the strategy or curator changes, or withdrawals queue more than 48 hours; redeem to the base asset.`,
      time: '10 minutes to set up',
    };
  }
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) {
    return {
      action: `Stake $${capital} of ${chain}'s staking asset through ${name} and keep the liquid receipt token.`,
      exit: `Exit if the validator set changes, a slashing event appears, or the unbonding queue passes 14 days; unstake and wait for settlement.`,
      time: '15 minutes plus unbonding',
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      action: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`,
      exit: `Exit if bridge TVL drops sharply, a withdrawal takes over 24 hours, or the route is paused; bridge back before adding funds.`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('rwa') || c.includes('anchor btc') || c.includes('decentralized btc')) {
    return {
      action: `Mint or deposit $${capital} of ${name}'s yield asset on ${chain} and keep the redemption record.`,
      exit: `Exit if the issuer changes redemption terms, NAV stalls, or transfer restrictions tighten; redeem in an open window.`,
      time: '25 minutes including checks',
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy document.`,
      exit: `Exit if coverage terms change or the underwriter's capital falls; let the policy expire instead of paying a cancel fee.`,
      time: '10 minutes to set up',
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      action: `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
      exit: `Exit if the curator raises fees, changes allocation outside the stated mandate, or vault TVL halves; redeem shares.`,
      time: '10 minutes to set up',
    };
  }
  if (c === 'chain') {
    return {
      action: `Bridge or stake $${capital} on ${name} through its official bridge or staking page, then use one native app.`,
      exit: `Exit if chain TVL or validator count falls for two weeks, or the bridge back is paused; move activity to a second chain.`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('index')) {
    return {
      action: `Mint $${capital} of ${name}'s index token on ${chain} and keep the basket receipt.`,
      exit: `Exit if the index methodology changes or the basket's liquidity thins; redeem to the base asset.`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('stable')) {
    return {
      action: `Mint or deposit $${capital} of ${name}'s stable asset on ${chain} and keep the receipt.`,
      exit: `Exit if the peg leaves 1% for a day or redemption is paused; redeem to USDC.`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} and place one small market position.`,
      exit: `Exit when the market resolves or the odds move 20 points against you; withdraw the remainder.`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('leveraged')) {
    return {
      action: `Open a small $${capital} leveraged position through ${name} on ${chain} with at most 2x leverage.`,
      exit: `Exit if the collateral ratio falls under 150%, funding turns against you, or vault TVL halves; close before adding margin.`,
      time: '20 minutes to set up',
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the receipt token.`,
    exit: `Exit if TVL falls by a third in a week, withdrawals pause, or the reward terms change; withdraw and stop.`,
    time: '15 minutes to set up',
  };
}

/** The chain and chain-count guidance a farm plan needs, from the protocol's own chains. */
function chainStep(p: SnapshotProtocol, capital: number, gas: ChainGas): FarmStep {
  if (p.chains.length > 1) {
    const spread = Math.min(p.chains.length, 3);
    const named = p.chains.slice(0, spread).join(', ');
    return {
      text: `Split the $${capital} across up to ${spread} of ${p.name}'s ${p.chains.length} chains (${named}); bridge only what you will farm and check each chain's gas before moving.`,
      cost: `${gas.label} bridge about ${gas.bridge} per bridge, plus destination-chain gas`,
      time: `${spread * 20} minutes to set up`,
    };
  }
  return {
    text: `Keep the $${capital} on ${chainOf(p)}, ${p.name}'s deepest market; do not bridge for a single-chain protocol.`,
    cost: `no bridge; ${gas.label} about ${gas.setup} for setup and approvals`,
    time: '5 minutes to set up',
  };
}

/** A pre-token protocol's plan: category action, chains, TVL scale, age, costs, exit and log. */
function preTokenSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = chainGas(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const plan = categoryPlan(p, capital, chain);
  return [
    {
      text: `Start with a fresh wallet and a first position of $${capital} on ${chain}; keep ${gas.buffer} aside for gas and never reuse a wallet that already holds other airdrops.`,
      cost: `$${capital} working capital plus ${gas.buffer} gas buffer`,
      time: '10 minutes to set up',
    },
    {
      text: plan.action,
      cost: `$${capital} position; ${gas.label} about ${gas.setup} for setup and approvals`,
      time: plan.time,
    },
    chainStep(p, capital, gas),
    {
      text: `Make one qualifying action each week on ${chain}, such as a deposit, borrow, swap or vote, and keep the size steady.`,
      cost: `${gas.label} about ${gas.weekly} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so it is counted in more than one snapshot; keep the receipt token in the same wallet.`,
      cost: `the $${capital} stays in the position; no extra fee`,
      time: `${hold} days`,
    },
    {
      text: plan.exit,
      cost: `${gas.label} about ${gas.exit} to exit`,
      time: '10-20 minutes to unwind',
    },
    {
      text: `Before you withdraw, check ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay to claim.`,
      cost: `no fee to check; claim gas about ${gas.exit}`,
      time: '10 minutes',
    },
    {
      text: `Log the wallet, dates, deposits, gas and the exit trigger in a farm journal so you can repeat or unwind the position.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** An already-issued protocol's plan: it is a comparison row, not a pre-token farm target. */
function liveTokenSteps(p: SnapshotProtocol): FarmStep[] {
  const chain = chainOf(p);
  const gas = chainGas(chain);
  const capital = capitalFor(p);
  const plan = categoryPlan(p, capital, chain);
  return [
    {
      text: `${p.name} already records a token${p.symbol === null ? '' : ` (${p.symbol})`}; treat this row as an already-issued comparison, not an airdrop target.`,
      cost: 'no capital to compare',
      time: '5 minutes',
    },
    {
      text: `Compare ${p.name}'s recorded market cap with the model's implied value for its $${Math.round(p.tvl_usd / 1_000_000)}M TVL, and write the gap in your log.`,
      cost: 'no capital, only the page figures',
      time: '10 minutes',
    },
    {
      text: `If you still want exposure, ${plan.action.replace(/^./, (ch) => ch.toLowerCase())}`,
      cost: `$${capital} position; ${gas.label} about ${gas.setup} for setup`,
      time: plan.time,
    },
    {
      text: plan.exit,
      cost: `${gas.label} about ${gas.exit} to exit`,
      time: '10-20 minutes to unwind',
    },
    {
      text: `Watch ${p.name}'s token liquidity and unlock schedule before using its market cap as a benchmark for younger protocols.`,
      cost: 'no capital to watch; trading fees only if you trade',
      time: '15 minutes a month',
    },
    {
      text: `Keep this row as a reference only: its token already trades, so there is no pre-token position to hold for an airdrop.`,
      cost: 'nothing',
      time: '2 minutes',
    },
  ];
}

/**
 * A protocol's farm plan: category template plus the protocol's own chains and TVL scale, with the
 * age setting the hold. Already-issued protocols get comparison steps instead of an airdrop plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  return isPreToken(p) ? preTokenSteps(p, age) : liveTokenSteps(p);
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      implied_value_usd: impliedValue(p, snapshot.as_of, model).implied,
    }));
}

/** A board row's compact form for data.js, with the model's inputs and the board's farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    token_status: row.token_status,
    implied_value_usd: row.implied_value_usd,
    model_implied_usd: row.model_implied_usd,
    anchor_multiplier: row.anchor_multiplier,
    peer_median_tvl_mcap: row.peer_median_tvl_mcap,
    peer_count: row.peer_count,
    base_multiple: row.model.base_multiple,
    category_multiplier: row.model.category_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot, model);
  const early = board.filter((r) => r.token_status === 'pre-token' && !snapshot.watchlist.includes(r.slug)).length;
  const preTokenSize = board.filter((r) => r.token_status === 'pre-token').length;
  const liveTokenSize = board.length - preTokenSize;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    pre_token_size: preTokenSize,
    live_size: live.length,
    live_token_size: liveTokenSize,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
