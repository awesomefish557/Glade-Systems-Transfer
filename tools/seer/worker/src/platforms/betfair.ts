import type { Env } from "../db";
import type { UniversalCategory, UniversalMarket } from "./types";

/** Non-interactive SSO (no client cert — Workers cannot do SSL cert auth to cert host). */
const SSO_LOGIN = "https://identitysso.betfair.com/api/login";
const BETTING_REST = "https://api.betfair.com/exchange/betting/rest/v1.0/";
const BETTING_JSON_RPC = "https://api.betfair.com/exchange/betting/json-rpc/v1";

/**
 * Soccer, tennis, golf, rugby union, rugby league, boxing, horse racing, specials.
 */
const EVENT_TYPE_IDS = ["1", "2", "3", "4", "5", "6", "7", "8"];

/** Betfair listMarketBook data-weight limit; stay well under with small batches. */
const LIST_MARKET_BOOK_CHUNK = 40;

let jsonRpcSeq = 0;

function marketStartRangeNext14Days(): { from: string; to: string } {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

function eventTypeToCategory(ids: string[]): UniversalCategory {
  const s = ids.join(",");
  if (s.includes("2378961") || s.toLowerCase().includes("polit")) {
    return "politics";
  }
  return "sports";
}

type MarketBookRunner = {
  selectionId: number;
  ex?: {
    availableToBack?: Array<{ price: number; size: number }>;
    availableToLay?: Array<{ price: number; size: number }>;
  };
};

type MarketBookRow = {
  marketId: string;
  totalMatched?: number;
  runners?: MarketBookRunner[];
};

type JsonRpcEnvelope<T> = {
  jsonrpc?: string;
  result?: T;
  error?: { code?: number; message?: string; data?: string };
  id?: number;
};

async function betfairJsonRpc<T>(
  appKey: string,
  sessionToken: string,
  method: string,
  params: Record<string, unknown>
): Promise<T | null> {
  const id = ++jsonRpcSeq;
  const res = await fetch(BETTING_JSON_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Application": appKey,
      "X-Authentication": sessionToken
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id
    })
  });
  const rawText = await res.text();
  let body: JsonRpcEnvelope<T>;
  try {
    body = JSON.parse(rawText) as JsonRpcEnvelope<T>;
  } catch {
    console.error("[betfair] json-rpc parse error", method, res.status, rawText.slice(0, 300));
    return null;
  }
  if (!res.ok) {
    console.error("[betfair] json-rpc http error", method, res.status, rawText.slice(0, 300));
    return null;
  }
  if (body.error) {
    console.error(
      "[betfair] json-rpc fault",
      method,
      body.error.message ?? body.error.code,
      body.error.data ?? ""
    );
    return null;
  }
  if (body.result === undefined) {
    console.error("[betfair] json-rpc missing result", method, rawText.slice(0, 300));
    return null;
  }
  return body.result;
}

async function betfairListMarketBook(
  appKey: string,
  sessionToken: string,
  marketIds: string[]
): Promise<MarketBookRow[]> {
  const result = await betfairJsonRpc<MarketBookRow[]>(appKey, sessionToken, "SportsAPING/v1.0/listMarketBook", {
    marketIds,
    priceProjection: { priceData: ["EX_BEST_OFFERS"] }
  });
  if (!result) return [];
  if (!Array.isArray(result)) {
    console.error("[betfair] listMarketBook unexpected result shape", String(result).slice(0, 200));
    return [];
  }
  return result;
}

function parseSessionTokenFromLoginBody(text: string): string | null {
  const xml = text.match(/<token>([^<]+)<\/token>/i);
  if (xml?.[1]) return xml[1].trim();
  try {
    const j = JSON.parse(text) as { token?: string; sessionToken?: string };
    const t = j.token ?? j.sessionToken;
    if (typeof t === "string" && t.length > 0) return t;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Betfair SSO: POST form body to `identitysso.betfair.com/api/login` (cert host omitted — Workers cannot do SSL client cert).
 * On failure, logs HTTP status and full response body.
 */
export async function getBetfairSessionToken(env: Env): Promise<string | null> {
  const appKey = env.BETFAIR_APP_KEY?.trim();
  const username = env.BETFAIR_USERNAME?.trim();
  const password = env.BETFAIR_PASSWORD?.trim();
  if (!appKey || !username || !password) {
    console.error("[betfair] auth skipped: missing BETFAIR_APP_KEY, BETFAIR_USERNAME, or BETFAIR_PASSWORD");
    return null;
  }

  const params = new URLSearchParams();
  params.set("username", username);
  params.set("password", password);

  const res = await fetch(SSO_LOGIN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "X-Application": appKey
    },
    body: params.toString()
  });
  const responseText = await res.text();
  const token = parseSessionTokenFromLoginBody(responseText);
  if (token) return token;
  console.error("[betfair] sso login failed status=", res.status, "full_response_body=", responseText);
  return null;
}

/**
 * Place a BACK bet on the Exchange. Uses SSO session from the same secrets as catalogue fetch.
 * Docs: https://docs.developer.betfair.com
 */
export async function placeBetfairBackBet(
  env: Env,
  params: {
    marketId: string;
    selectionId: number;
    size: number;
    price: number;
    customerOrderRef: string;
  }
): Promise<{ ok: true; betId: string } | { ok: false; error: string }> {
  const appKey = env.BETFAIR_APP_KEY?.trim();
  if (!appKey) return { ok: false, error: "missing_app_key" };

  const sessionToken = await getBetfairSessionToken(env);
  if (!sessionToken) return { ok: false, error: "login_failed" };

  const res = await fetch(`${BETTING_REST}placeOrders/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Application": appKey,
      "X-Authentication": sessionToken
    },
    body: JSON.stringify({
      marketId: params.marketId,
      instructions: [
        {
          selectionId: params.selectionId,
          handicap: 0,
          side: "BACK",
          orderType: "LIMIT",
          limitOrder: {
            size: params.size,
            price: params.price,
            persistenceType: "LAPSE"
          },
          customerOrderRef: params.customerOrderRef
        }
      ]
    })
  });

  const json = (await res.json()) as {
    status?: string;
    instructionReports?: Array<{
      status?: string;
      errorCode?: string;
      placeInstructionReports?: Array<{
        status?: string;
        betId?: string;
        instruction?: { betId?: string };
        errorCode?: string;
      }>;
    }>;
  };

  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }

  const ir = json.instructionReports?.[0];
  if (json.status === "FAILURE" || ir?.status === "FAILURE") {
    const code =
      ir?.errorCode ??
      ir?.placeInstructionReports?.[0]?.errorCode ??
      "place_failed";
    return { ok: false, error: String(code) };
  }

  const pir = ir?.placeInstructionReports?.[0];
  const betId = pir?.betId ?? pir?.instruction?.betId;
  if (pir?.status === "SUCCESS" && betId) {
    return { ok: true, betId: String(betId) };
  }
  if (pir?.status === "FAILURE") {
    return { ok: false, error: String(pir.errorCode ?? "instruction_failed") };
  }

  return { ok: false, error: "no_bet_id" };
}

/** Map Betfair betId → profit (winnings − stake, before our DB semantics). */
export async function fetchBetfairSettledProfitsByBetId(
  env: Env,
  betIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (betIds.length === 0) return out;

  const appKey = env.BETFAIR_APP_KEY?.trim();
  const sessionToken = await getBetfairSessionToken(env);
  if (!appKey || !sessionToken) return out;

  const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${BETTING_REST}listClearedOrders/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Application": appKey,
      "X-Authentication": sessionToken
    },
    body: JSON.stringify({
      betStatus: "SETTLED",
      settledDateRange: { from, to: new Date().toISOString() },
      recordCount: 500
    })
  });

  if (!res.ok) return out;
  const data = (await res.json()) as Record<string, unknown>;
  type Cleared = { betId?: string; profit?: number };
  let rows: Cleared[] = [];
  const co = data.clearedOrders;
  if (Array.isArray(co)) {
    rows = co as Cleared[];
  } else if (co && typeof co === "object" && co !== null && "clearedOrder" in co) {
    const inner = (co as { clearedOrder?: unknown }).clearedOrder;
    rows = Array.isArray(inner) ? (inner as Cleared[]) : [];
  }
  const want = new Set(betIds);
  for (const row of rows) {
    const id = row.betId != null ? String(row.betId) : "";
    if (!id || !want.has(id)) continue;
    if (typeof row.profit === "number") out.set(id, row.profit);
  }
  return out;
}

/**
 * Betfair Exchange — SSO login + JSON-RPC listMarketCatalogue + listMarketBook (live best back/lay).
 * On auth or API failure: log and return [] (never mock data).
 */
export async function fetchBetfairMarkets(env: Env): Promise<UniversalMarket[]> {
  const appKey = env.BETFAIR_APP_KEY?.trim();
  const user = env.BETFAIR_USERNAME?.trim();
  const pass = env.BETFAIR_PASSWORD?.trim();
  if (!appKey || !user || !pass) {
    console.error("[betfair] fetchBetfairMarkets: missing credentials");
    return [];
  }

  try {
    const sessionToken = await getBetfairSessionToken(env);
    if (!sessionToken) {
      return [];
    }

    const timeRange = marketStartRangeNext14Days();
    const catalogueRaw = await betfairJsonRpc<
      Array<{
        marketId: string;
        marketName?: string;
        marketStartTime?: string;
        eventType?: { id?: string; name?: string };
        event?: { name?: string; id?: string };
        runners?: Array<{ selectionId: number; runnerName?: string }>;
      }>
    >(appKey, sessionToken, "SportsAPING/v1.0/listMarketCatalogue", {
      filter: {
        eventTypeIds: EVENT_TYPE_IDS,
        marketCountries: ["GB", "IE"],
        marketStartTime: timeRange
      },
      marketProjection: ["EVENT", "RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      maxResults: 100
    });
    if (!catalogueRaw) {
      return [];
    }
    if (!Array.isArray(catalogueRaw)) {
      console.error(
        "[betfair] listMarketCatalogue unexpected result",
        JSON.stringify(catalogueRaw).slice(0, 240)
      );
      return [];
    }
    const catalogue = catalogueRaw;
    if (catalogue.length === 0) {
      return [];
    }

    const marketIds = catalogue.map((m) => m.marketId).filter(Boolean);
    const books: MarketBookRow[] = [];
    for (let i = 0; i < marketIds.length; i += LIST_MARKET_BOOK_CHUNK) {
      const chunk = marketIds.slice(i, i + LIST_MARKET_BOOK_CHUNK);
      const part = await betfairListMarketBook(appKey, sessionToken, chunk);
      books.push(...part);
    }
    const bookById = new Map(books.map((b) => [b.marketId, b]));

    const out: UniversalMarket[] = [];
    for (const mc of catalogue) {
      const book = bookById.get(mc.marketId);
      const nameBySel = new Map(
        (mc.runners ?? []).map((r) => [r.selectionId, r.runnerName ?? ""])
      );
      const runners = book?.runners ?? [];

      type Back = {
        selectionId: number;
        name: string;
        decimalOdds: number;
        vol: number;
      };
      const backs: Back[] = [];
      for (const r of runners) {
        const b = r.ex?.availableToBack?.[0];
        if (!b || b.price <= 1) continue;
        backs.push({
          selectionId: r.selectionId,
          name: nameBySel.get(r.selectionId) || String(r.selectionId),
          decimalOdds: b.price,
          vol: b.size ?? 0
        });
      }
      backs.sort((a, b) => 1 / b.decimalOdds - 1 / a.decimalOdds);

      if (backs.length === 0) continue;

      const primary = backs[0]!;
      const secondary = backs[1];
      const yesP = Math.min(0.99, Math.max(0.01, 1 / primary.decimalOdds));
      const noP = secondary
        ? Math.min(0.99, Math.max(0.01, 1 / secondary.decimalOdds))
        : Math.min(0.99, Math.max(0.01, 1 - yesP));

      const eventName = String(mc.event?.name ?? "").trim();
      const marketName = String(mc.marketName ?? "Market").trim();
      const q =
        eventName.length > 0
          ? `${eventName} — ${marketName}`
          : marketName;

      const start =
        mc.marketStartTime ?? new Date(Date.now() + 864e5).toISOString();

      const volSum = backs.reduce((s, x) => s + x.vol, 0);
      const totalMatched =
        book?.totalMatched != null && Number.isFinite(book.totalMatched)
          ? book.totalMatched
          : 0;
      /** GBP matched on exchange; fall back to best-back size sum for liquidity ranking. */
      const volumeGbp = Math.max(totalMatched, volSum, 1);

      const eventTypeId = mc.eventType?.id != null ? String(mc.eventType.id) : "";
      out.push({
        id: `bf_${mc.marketId}`,
        platform: "betfair",
        question: q,
        category: eventTypeToCategory(eventTypeId ? [eventTypeId] : ["1"]),
        yesPrice: yesP,
        noPrice: noP,
        volume: volumeGbp,
        endDate: start,
        resolved: false,
        commission: 0.05,
        externalUrl: `https://www.betfair.com/exchange/plus/market/${mc.marketId}`,
        placement: {
          betfair: {
            marketId: mc.marketId,
            yesSelectionId: primary.selectionId,
            noSelectionId: secondary?.selectionId,
            yesDecimalOdds: primary.decimalOdds,
            noDecimalOdds: secondary?.decimalOdds
          }
        }
      });
    }

    return out;
  } catch (e) {
    console.error("[betfair] fetchBetfairMarkets error", e);
    return [];
  }
}
