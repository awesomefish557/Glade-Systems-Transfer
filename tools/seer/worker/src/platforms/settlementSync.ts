import type { Env } from "../db";
import { fetchBetfairSettledProfitsByBetId } from "./betfair";
import { fetchMatchbookSettledProfitsByBetId } from "./matchbook";

type OpenPlatformRow = {
  id: number;
  platform: string;
  platform_bet_id: string;
  stake: number;
};

/**
 * Poll Betfair / Matchbook for settled bets and close matching LIVE positions.
 * Uses exchange-reported net P&L as `profit_loss`.
 */
export async function syncExchangePositionSettlements(
  env: Env,
  db: D1Database
): Promise<number> {
  const { results = [] } = await db
    .prepare(
      `SELECT id, platform, platform_bet_id, stake FROM positions
       WHERE status = 'OPEN' AND mode = 'LIVE'
         AND platform_bet_id IS NOT NULL AND TRIM(platform_bet_id) != ''
         AND platform IN ('betfair', 'matchbook')`
    )
    .all<OpenPlatformRow>();

  if (results.length === 0) return 0;

  const bfIds = results
    .filter((r) => r.platform === "betfair")
    .map((r) => r.platform_bet_id);
  const mbIds = results
    .filter((r) => r.platform === "matchbook")
    .map((r) => r.platform_bet_id);

  const [bfMap, mbMap] = await Promise.all([
    fetchBetfairSettledProfitsByBetId(env, bfIds),
    fetchMatchbookSettledProfitsByBetId(env, mbIds)
  ]);

  let closed = 0;
  for (const row of results) {
    const pnl =
      row.platform === "betfair"
        ? bfMap.get(row.platform_bet_id)
        : mbMap.get(row.platform_bet_id);
    if (pnl === undefined) continue;

    await db
      .prepare(
        `UPDATE positions
         SET status = 'CLOSED',
             profit_loss = ?,
             exit_price = NULL,
             resolved_at = datetime('now')
         WHERE id = ? AND status = 'OPEN'`
      )
      .bind(pnl, row.id)
      .run();
    closed += 1;
  }

  return closed;
}
