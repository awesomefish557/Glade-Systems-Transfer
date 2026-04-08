import type { UniversalCategory, UniversalMarket } from "./types";

const API = "https://api.smarkets.com/v3";

function mockSmarketsMarkets(): UniversalMarket[] {
  const d = (days: number) =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return [
    {
      id: "sm_mock_1",
      platform: "smarkets",
      question: "Labour to win next UK election",
      category: "politics",
      yesPrice: 0.72,
      noPrice: 0.28,
      volume: 89_000,
      endDate: d(180),
      resolved: false,
      commission: 0.02,
      externalUrl: "https://smarkets.com/"
    },
    {
      id: "sm_mock_2",
      platform: "smarkets",
      question: "Next UK PM — key by-election swing",
      category: "politics",
      yesPrice: 0.41,
      noPrice: 0.59,
      volume: 34_000,
      endDate: d(90),
      resolved: false,
      commission: 0.02
    }
  ];
}

function slugCategory(fullSlug: string | undefined): UniversalCategory {
  const s = (fullSlug ?? "").toLowerCase();
  if (s.includes("politic") || s.includes("election") || s.includes("current-affairs")) {
    return "politics";
  }
  if (s.includes("crypto") || s.includes("bitcoin")) return "crypto";
  if (s.includes("sport")) return "sports";
  return "other";
}

function bestBidProb(
  quotes: Record<string, { bids?: Array<{ price: number }> }>,
  contractId: string
): number {
  const q = quotes[contractId];
  const bids = q?.bids ?? [];
  if (bids.length === 0) return 0;
  const mx = Math.max(...bids.map((b) => b.price));
  return Math.min(0.99, Math.max(0, mx / 10_000));
}

/**
 * Smarkets public read API — no auth.
 * Events → markets → contracts + quotes (prices in 1/10_000).
 */
export async function fetchSmarketsMarkets(): Promise<UniversalMarket[]> {
  const mocks = mockSmarketsMarkets();
  try {
    const evRes = await fetch(
      `${API}/events/?state=new&state=live&limit=20&sort=id`
    );
    if (!evRes.ok) return mocks;
    const evJson = (await evRes.json()) as {
      events?: Array<{
        id: string;
        name?: string;
        full_slug?: string;
        start_datetime?: string;
        bettable?: boolean;
      }>;
    };
    const events = (evJson.events ?? []).filter((e) => e.bettable !== false);
    const out: UniversalMarket[] = [];

    for (const ev of events.slice(0, 10)) {
      const mRes = await fetch(`${API}/events/${ev.id}/markets/`);
      if (!mRes.ok) continue;
      const mJson = (await mRes.json()) as {
        markets?: Array<{
          id: string;
          name?: string;
          state?: string;
          category?: string;
        }>;
      };
      const markets = (mJson.markets ?? [])
        .filter((m) => m.state === "live")
        .slice(0, 2);

      for (const m of markets) {
        const [cRes, qRes] = await Promise.all([
          fetch(`${API}/markets/${m.id}/contracts/`),
          fetch(`${API}/markets/${m.id}/quotes/`)
        ]);
        if (!cRes.ok || !qRes.ok) continue;
        const cJson = (await cRes.json()) as {
          contracts?: Array<{ id: string; name?: string }>;
        };
        const quotes = (await qRes.json()) as Record<
          string,
          { bids?: Array<{ price: number; quantity?: number }> }
        >;
        const contracts = cJson.contracts ?? [];
        let fav: { id: string; name: string; p: number; vol: number } | null =
          null;
        for (const c of contracts) {
          const p = bestBidProb(quotes, c.id);
          if (p < 0.02) continue;
          const q = quotes[c.id];
          const vol =
            (q?.bids ?? []).reduce((s, b) => s + (b.quantity ?? 0), 0) || 50_000;
          if (!fav || p > fav.p) {
            fav = { id: c.id, name: c.name ?? "?", p, vol };
          }
        }
        if (!fav) continue;
        const yesP = fav.p;
        const end = ev.start_datetime ?? new Date(Date.now() + 30 * 864e5).toISOString();
        out.push({
          id: `sm_${m.id}_${fav.id}`,
          platform: "smarkets",
          question: `${ev.name ?? "Event"} — ${m.name ?? "Market"} — ${fav.name}`,
          category: slugCategory(ev.full_slug),
          yesPrice: yesP,
          noPrice: Math.min(0.99, Math.max(0.01, 1 - yesP)),
          volume: Math.max(10_000, Math.min(2_000_000, fav.vol / 100)),
          endDate: end,
          resolved: false,
          commission: 0.02,
          externalUrl: `https://smarkets.com/event/${ev.id}`
        });
      }
    }

    return out.length > 0 ? out : mocks;
  } catch (e) {
    console.warn("[smarkets]", e);
    return mocks;
  }
}
