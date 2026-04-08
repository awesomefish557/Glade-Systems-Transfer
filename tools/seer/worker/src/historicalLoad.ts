import type { Env } from "./db";
import { insertPriceSnapshot, upsertMarket } from "./db";
import { normalizeMarketRow, type PolymarketMarket } from "./pipeline";

/**
 * Paged Gamma ingest: open (`active=true&closed=false`) and resolved (`closed=true`)
 * streams, two GETs per invocation max. Calibration: POST /admin/rebuild-calibration.
 */

const GAMMA = "https://gamma-api.polymarket.com/markets";
const BATCH = 100;

export interface HistoricalLoadBatchOptions {
  openOffset: number;
  closedOffset: number;
  openDone: boolean;
  closedDone: boolean;
}

export interface HistoricalLoadBatchResult {
  done: boolean;
  loaded: number;
  nextOpenOffset: number;
  nextClosedOffset: number;
  openDone: boolean;
  closedDone: boolean;
}

async function fetchGamma(
  params: Record<string, string>
): Promise<PolymarketMarket[]> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${GAMMA}?${qs.toString()}`);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${t.slice(0, 120)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Expected JSON array");
  return data as PolymarketMarket[];
}

function advanceStream(
  offset: number,
  batch: PolymarketMarket[],
  wasDone: boolean
): { nextOffset: number; done: boolean } {
  if (wasDone) {
    return { nextOffset: offset, done: true };
  }
  if (batch.length === 0) {
    return { nextOffset: offset, done: true };
  }
  if (batch.length < BATCH) {
    return { nextOffset: offset + batch.length, done: true };
  }
  return { nextOffset: offset + BATCH, done: false };
}

async function upsertBatch(env: Env, batch: PolymarketMarket[]): Promise<number> {
  let loaded = 0;
  for (const raw of batch) {
    const row = normalizeMarketRow(raw);
    if (!row) continue;
    await upsertMarket(env, row);
    loaded += 1;
    if (row.resolved === 0) {
      await insertPriceSnapshot(env, row.id, row.yes_price, row.volume);
    }
  }
  return loaded;
}

/**
 * Up to two Gamma GETs: open page and/or closed page. Pass openDone=1 / closedDone=1
 * (query) once a stream has no more pages so we stop refetching it.
 */
export async function runHistoricalLoadBatch(
  env: Env,
  options: HistoricalLoadBatchOptions
): Promise<HistoricalLoadBatchResult> {
  const { openOffset, closedOffset, openDone: openDoneIn, closedDone: closedDoneIn } =
    options;

  let openBatch: PolymarketMarket[] = [];
  let closedBatch: PolymarketMarket[] = [];

  if (!openDoneIn) {
    openBatch = await fetchGamma({
      active: "true",
      closed: "false",
      limit: String(BATCH),
      offset: String(openOffset)
    });
  }

  if (!closedDoneIn) {
    closedBatch = await fetchGamma({
      closed: "true",
      limit: String(BATCH),
      offset: String(closedOffset),
      order: "endDate",
      ascending: "false"
    });
  }

  const openAdv = advanceStream(openOffset, openBatch, openDoneIn);
  const closedAdv = advanceStream(closedOffset, closedBatch, closedDoneIn);

  const loaded =
    (await upsertBatch(env, openBatch)) + (await upsertBatch(env, closedBatch));

  const openDone = openAdv.done;
  const closedDone = closedAdv.done;
  const done = openDone && closedDone;

  return {
    done,
    loaded,
    nextOpenOffset: openAdv.nextOffset,
    nextClosedOffset: closedAdv.nextOffset,
    openDone,
    closedDone
  };
}
