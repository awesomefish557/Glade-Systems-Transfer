import { corsJson } from "./cors";
import type { Env } from "./db";
import {
  normalizePostPaperBody,
  openPaperPositionWithVenuePricing
} from "./paperPosition";

/**
 * Drop-in handler fragment for `POST /api/positions` paper branch.
 * Live / exchange-backed opens stay in your existing handler.
 */
export async function tryHandlePaperPositionPost(
  env: Env,
  body: unknown
): Promise<Response | null> {
  const b = normalizePostPaperBody(body);
  if (!b) return null;

  const r = await openPaperPositionWithVenuePricing(env, b);
  if (r.ok) {
    return corsJson({
      ok: true,
      positionId: r.positionId,
      entryPrice: r.entryPrice,
      paperPlatform: r.paperPlatform,
      message: "paper_position_opened"
    });
  }
  return corsJson(
    {
      ok: false,
      error: r.error,
      message: r.message ?? r.error
    },
    400
  );
}
