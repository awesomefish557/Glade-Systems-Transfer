import type { Env } from "../db";
import type { UniversalCategory, UniversalMarket } from "./types";

const BASE = "https://api.matchbook.com/edge/rest";
const OFFERS_V2 = "https://api.matchbook.com/edge/rest/v2/offers";
const SETTLED_V2 = "https://api.matchbook.com/edge/rest/reports/v2/bets/settled";
/** Session login — same token is sent as `session-token` on edge API calls. */
const SESSION_URL = "https://www.matchbook.com/bpapi/rest/security/session";

function inferCategory(name: string): UniversalCategory {
  const x = name.toLowerCase();
  if (x.includes("politic") || x.includes("election")) return "politics";
  if (x.includes("bitcoin") || x.includes("crypto")) return "crypto";
  return "sports";
}

export async function getMatchbookSessionToken(env: Env): Promise<string | null> {
  const username = env.MATCHBOOK_USERNAME?.trim();
  const password = env.MATCHBOOK_PASSWORD?.trim();
  if (!username || !password) {
    console.error("[matchbook] session skipped: missing MATCHBOOK_USERNAME or MATCHBOOK_PASSWORD");
    return null;
  }

  const res = await fetch(SESSION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password })
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error("[matchbook] session parse error status=", res.status, "body=", text);
    return null;
  }
  const token = json["session-token"];
  if (typeof token === "string" && token.length > 0) return token;
  if (!res.ok) {
    console.error("[matchbook] session failed status=", res.status, "body=", text);
    return null;
  }
  console.error("[matchbook] session missing session-token in body=", text);
  return null;
}

export async function submitMatchbookBackOffer(
  env: Env,
  params: { runnerId: number; odds: number; stake: number }
): Promise<{ ok: true; betId: string } | { ok: false; error: string }> {
  const token = await getMatchbookSessionToken(env);
  if (!token) return { ok: false, error: "login_failed" };

  const res = await fetch(OFFERS_V2, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "session-token": token
    },
    body: JSON.stringify({
      "odds-type": "DECIMAL",
      "exchange-type": "back-lay",
      offers: [
        {
          "runner-id": params.runnerId,
          side: "back",
          odds: params.odds,
          stake: params.stake,
          "keep-in-play": false
        }
      ]
    })
  });

  const raw = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof raw["error"] === "string"
        ? raw["error"]
        : typeof raw["message"] === "string"
          ? raw["message"]
          : `http_${res.status}`;
    return { ok: false, error: msg };
  }

  const offers = raw.offers as Array<Record<string, unknown>> | undefined;
  const offer = offers?.[0];
  if (!offer) return { ok: false, error: "no_offer" };

  const matched = offer["matched-bets"] as
    | Array<{ id?: number | string }>
    | undefined;
  const firstBet = matched?.[0];
  const betId =
    firstBet?.id != null
      ? String(firstBet.id)
      : offer.id != null
        ? String(offer.id)
        : null;

  const status = String(offer.status ?? "");
  if (status === "failed") {
    return { ok: false, error: "offer_failed" };
  }

  if (!betId) return { ok: false, error: "no_bet_id" };
  return { ok: true, betId };
}

export async function fetchMatchbookSettledProfitsByBetId(
  env: Env,
  betIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (betIds.length === 0) return out;

  const token = await getMatchbookSessionToken(env);
  if (!token) return out;

  const want = new Set(betIds);
  const after = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  let offset = 0;
  const perPage = 50;
  for (let page = 0; page < 20; page++) {
    const url = `${SETTLED_V2}?after=${encodeURIComponent(after)}&per-page=${perPage}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "session-token": token }
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      markets?: Array<{
        selections?: Array<{
          bets?: Array<{
            id?: number | string;
            "net-profit-and-loss"?: number;
          }>;
        }>;
      }>;
      total?: number;
    };

    for (const m of data.markets ?? []) {
      for (const sel of m.selections ?? []) {
        for (const b of sel.bets ?? []) {
          const id = b.id != null ? String(b.id) : "";
          if (!id || !want.has(id)) continue;
          const pnl = b["net-profit-and-loss"];
          if (typeof pnl === "number") out.set(id, pnl);
        }
      }
    }

    offset += perPage;
    const total = typeof data.total === "number" ? data.total : 0;
    if (offset >= total || (data.markets?.length ?? 0) === 0) break;
  }

  return out;
}

/**
 * Matchbook — bpapi session login, then edge GET /events?sport-ids=...
 * On missing creds, auth failure, or API errors returns [] (no mock data).
 */
export async function fetchMatchbookMarkets(env: Env): Promise<UniversalMarket[]> {
  const user = env.MATCHBOOK_USERNAME?.trim();
  const pass = env.MATCHBOOK_PASSWORD?.trim();
  if (!user || !pass) {
    console.error("[matchbook] fetchMatchbookMarkets: missing credentials");
    return [];
  }

  try {
    const token = await getMatchbookSessionToken(env);
    if (!token) {
      return [];
    }

    const evRes = await fetch(
      `${BASE}/events?sport-ids=1,2,3,4&per-page=80&states=open`,
      {
        headers: {
          Accept: "application/json",
          "session-token": token
        }
      }
    );
    const evText = await evRes.text();
    if (!evRes.ok) {
      console.error("[matchbook] events failed status=", evRes.status, "body=", evText);
      return [];
    }
    let data: {
      events?: Array<{
        id: number | string;
        name?: string;
        start?: string;
        markets?: Array<{
          id: string;
          name?: string;
          runners?: Array<{
            id: number;
            name?: string;
            prices?: Array<{ side: string; "decimal-odds"?: number }>;
          }>;
        }>;
      }>;
    };
    try {
      data = JSON.parse(evText) as typeof data;
    } catch {
      console.error("[matchbook] events parse error body=", evText);
      return [];
    }
    const events = data.events ?? [];
    const out: UniversalMarket[] = [];

    for (const ev of events) {
      for (const m of ev.markets ?? []) {
        type R = {
          id: number;
          name: string;
          odds: number;
        };
        const backs: R[] = [];
        for (const r of m.runners ?? []) {
          const back = (r.prices ?? []).find((p) => p.side === "back");
          const dec = back ? back["decimal-odds"] : undefined;
          if (typeof dec !== "number" || dec <= 1) continue;
          backs.push({
            id: r.id,
            name: r.name ?? "Runner",
            odds: dec
          });
        }
        backs.sort((a, b) => 1 / b.odds - 1 / a.odds);
        if (backs.length === 0) continue;

        const p0 = backs[0]!;
        const p1 = backs[1];
        const yesP = Math.min(0.99, Math.max(0.01, 1 / p0.odds));
        const noP = p1
          ? Math.min(0.99, Math.max(0.01, 1 / p1.odds))
          : Math.min(0.99, Math.max(0.01, 1 - yesP));

        const q = p1
          ? `${ev.name ?? "Event"} — ${m.name ?? "Market"} — ${p0.name} vs ${p1.name}`
          : `${ev.name ?? "Event"} — ${m.name ?? "Market"} — ${p0.name}`;

        out.push({
          id: `mb_${m.id}_${p0.id}`.replace(/\s+/g, "_").slice(0, 80),
          platform: "matchbook",
          question: q,
          category: inferCategory(`${ev.name} ${m.name}`),
          yesPrice: yesP,
          noPrice: noP,
          volume: 60_000,
          endDate:
            ev.start ?? new Date(Date.now() + 7 * 864e5).toISOString(),
          resolved: false,
          commission: 0.01,
          externalUrl: `https://www.matchbook.com/events/${ev.id}`,
          placement: {
            matchbook: {
              marketId: String(m.id),
              yesRunnerId: p0.id,
              noRunnerId: p1?.id,
              yesDecimalOdds: p0.odds,
              noDecimalOdds: p1?.odds
            }
          }
        });
      }
    }
    return out;
  } catch (e) {
    console.error("[matchbook] fetchMatchbookMarkets error", e);
    return [];
  }
}
