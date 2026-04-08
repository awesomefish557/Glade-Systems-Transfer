import { useCallback, useEffect, useMemo, useState } from "react";
import { QueueTab } from "./QueueTab";

const BG = "#0f0f0d";
const TEXT = "#e8e4d9";
const GOLD = "#d4a853";
const MUTED = "#9a9588";
const CARD = "#1a1916";
const BORDER = "#2e2c27";

type BookieStatus = "active" | "restricted" | "gubbed" | "dormant" | "closed";
type BetType = "qualifying" | "free_bet" | "mug" | "reload" | "boost";

type BookieRow = {
  id: number;
  name: string;
  status: BookieStatus;
  welcome_claimed: number;
  welcome_profit?: number;
  current_balance: number;
  total_pl?: number;
  notes: string | null;
  joined_at?: string;
  last_activity?: string;
  onboarding_stage?: number;
};

type BetRow = {
  id: number;
  bookie_id: number;
  bet_type: BetType;
  market: string;
  back_stake: number;
  back_odds: number;
  lay_stake: number;
  lay_odds: number;
  commission: number;
  pl: number;
  is_free_bet: number;
  notes: string | null;
  placed_at: string;
};

type DashboardPayload = {
  total_pl?: number;
  monthly_pl?: number;
  active_bookie_count?: number;
  gubbed_count?: number;
  welcome_claimed?: number;
  welcome_total?: number;
  compliance_status?: string;
  recent_bets?: BetRow[];
};

type CheckinPayload = {
  date: string;
  checks: Record<string, boolean>;
  mug_bet_placed: number;
  activity_notes: string;
};

/** Stored in API as checks["1"]..checks["12"] (dashboard / governor). */
const SIGN_OFF_COMMANDMENTS: { id: string; label: string }[] = [
  { id: "1", label: "Odd stakes used" },
  { id: "2", label: "Markets varied" },
  { id: "3", label: "Browsed naturally" },
  { id: "4", label: "Spaced activity" },
  { id: "5", label: "Left balance" },
  { id: "6", label: "No price boosts" },
  { id: "7", label: "Used app too" },
  { id: "8", label: "Records updated" },
  { id: "9", label: "Qual loss present" },
  { id: "10", label: "No tight matching" },
  { id: "11", label: "Gubbed = dormant" },
  { id: "12", label: "Mug bet budgeted" },
];

const TODAY_ACTIONS: { id: string; text: string }[] = [
  { id: "a1", text: "Pick a market with back/lay odds within 0.15 of each other" },
  { id: "a2", text: "Use an odd stake — add pence e.g. £10.37 not £10.00 (commandment 1)" },
  { id: "a3", text: "Browse the bookie site for 2–3 mins before placing (commandment 4)" },
  { id: "a4", text: "Check you haven't claimed this offer already today (commandment 7)" },
  { id: "a5", text: "Place your lay bet on Smarkets first, then back bet at bookie immediately after" },
];

function apiBase(): string {
  const u = import.meta.env.VITE_API_URL || "";
  return u.replace(/\/+$/, "");
}

function adminHeaders(): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Admin-Secret": import.meta.env.VITE_ADMIN_SECRET || "",
  };
  return h;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase();
  if (!base) throw new Error("VITE_API_URL is not set");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...init?.headers },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string"
          ? body
          : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return body as T;
}

function unwrapArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && "data" in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: T[] }).data;
  }
  if (data && typeof data === "object" && "bookies" in data && Array.isArray((data as { bookies: unknown }).bookies)) {
    return (data as { bookies: T[] }).bookies;
  }
  if (data && typeof data === "object" && "bets" in data && Array.isArray((data as { bets: unknown }).bets)) {
    return (data as { bets: T[] }).bets;
  }
  return [];
}

function commissionDecimal(pct: number): number {
  return Math.max(0, pct) / 100;
}

/** Lay stake: commission applied to exchange winnings only. */
function calcLayStake(
  backStake: number,
  backOdds: number,
  layOdds: number,
  commissionPct: number,
  snr: boolean,
): number {
  const c = commissionDecimal(commissionPct);
  const denom = layOdds - 1 - c * (layOdds - 1);
  if (denom <= 0 || backStake <= 0 || backOdds < 1 || layOdds < 1) return 0;
  if (snr) {
    const stake = backStake * (backOdds - 1);
    return stake / denom;
  }
  return (backStake * backOdds) / denom;
}

function calcBetPl(
  backStake: number,
  backOdds: number,
  layStake: number,
  layOdds: number,
  commissionPct: number,
): { ifBackWins: number; ifLayWins: number; worst: number } {
  const c = commissionDecimal(commissionPct);
  const ifBackWins = backStake * (backOdds - 1) - layStake * (layOdds - 1);
  const ifLayWins = -backStake + layStake * (layOdds - 1) * (1 - c);
  const worst = Math.min(ifBackWins, ifLayWins);
  return { ifBackWins, ifLayWins, worst };
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekStartISO(): string {
  const d = startOfWeekMonday(new Date());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function newCasinoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Turnover (stake-through) × house edge % → expected loss in £. */
function casinoExpectedLossFromEdge(bonusAmount: number, wageringMultiplier: number, houseEdgePct: number): number {
  if (!Number.isFinite(bonusAmount) || !Number.isFinite(wageringMultiplier) || !Number.isFinite(houseEdgePct)) return 0;
  const turnover = bonusAmount * wageringMultiplier;
  return turnover * (houseEdgePct / 100);
}

function isCurrentMonth(iso: string): boolean {
  const t = new Date(iso);
  const n = new Date();
  return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth();
}

function startOfWeekMonday(ref = new Date()): Date {
  const day = ref.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function isInCurrentCalendarWeek(iso: string): boolean {
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(t.getTime())) return false;
  const start = startOfWeekMonday(new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return t >= start && t < end;
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

const statusColors: Record<BookieStatus, string> = {
  active: "#4a8f6a",
  restricted: "#c9a227",
  gubbed: "#b84d4d",
  dormant: "#6b6b6b",
  closed: "#4a4a4a",
};

const TIER_1_NAMES = new Set(["bet365", "betway", "888sport", "unibet"]);
const TIER_2_NAMES = new Set(["sky bet", "paddy power", "coral", "ladbrokes", "william hill"]);
const TIER_3_NAMES = new Set(["boylesports", "quinnbet", "betvictor", "marathonbet", "virgin bet"]);

type BookieTierMeta = {
  tier: 1 | 2 | 3;
  tierLabel: string;
  short: string;
  strategy: string;
  bg: string;
  fg: string;
  border: string;
};

function bookieTierMeta(name: string): BookieTierMeta | null {
  const n = name.trim().toLowerCase();
  if (TIER_1_NAMES.has(n)) {
    return {
      tier: 1,
      tierLabel: "Tier 1",
      short: "extract fast",
      strategy: "Claim welcome, 1-2 mugs, withdraw, go dormant",
      bg: "#5c2424",
      fg: "#f0d0d0",
      border: "#8b3535",
    };
  }
  if (TIER_2_NAMES.has(n)) {
    return {
      tier: 2,
      tierLabel: "Tier 2",
      short: "nurture",
      strategy: "Regular mugs, use app, work reloads carefully",
      bg: "#5c4a1e",
      fg: "#f5e6b8",
      border: "#9a7b28",
    };
  }
  if (TIER_3_NAMES.has(n)) {
    return {
      tier: 3,
      tierLabel: "Tier 3",
      short: "long-term",
      strategy: "Prioritise for reloads, most forgiving",
      bg: "#1e3d2e",
      fg: "#c4e8d4",
      border: "#3d6b4f",
    };
  }
  return null;
}

type CasinoStatus = "active" | "wagering" | "cleared" | "forfeited" | "expired";

type CasinoAccount = {
  id: string;
  name: string;
  bonus_type: string;
  wagering_requirement: number;
  bonus_amount: number;
  status: CasinoStatus;
  notes: string;
};

const casinoStatusColors: Record<CasinoStatus, string> = {
  active: "#4a8f6a",
  wagering: "#c9a227",
  cleared: "#6b6b6b",
  forfeited: "#b84d4d",
  expired: "#4a4a4a",
};

const BOOKIES_CASINO_STORAGE = "bookies_casino_accounts_v1";
const BOOKIES_STRATEGY_STORAGE = "bookies_week_strategy_v1";

const STRATEGY_CHECKLIST: { id: string; label: string }[] = [
  {
    id: "t3_reload",
    label: "Tier 3 bookies — reload offers available: do these first while accounts are healthy",
  },
  {
    id: "t1_welcome",
    label: "Tier 1 bookies — unclaimed welcome: extract value and plan your exit",
  },
  {
    id: "casino_ev",
    label: "Casino bonuses available — run the EV numbers on the Casino tab before playing",
  },
  {
    id: "acca",
    label: "Acca insurance opportunities — review the OddsMonkey acca tool",
  },
];

const RECOMMENDED_CASINO_GAMES: { name: string; edge: string; note: string }[] = [
  { name: "Blackjack", edge: "0.5% edge", note: "best choice" },
  { name: "Baccarat", edge: "1.06% edge", note: "good" },
  { name: "Roulette European", edge: "2.7% edge", note: "acceptable" },
  { name: "Slots", edge: "3–5%+ edge", note: "avoid unless bonus requires it" },
];

const ANTI_DETECTION_TIPS = [
  "Vary games",
  "Browse lobby first",
  "Don't withdraw exact bonus amount",
  "Occasional slots session",
];

type TabId = "dashboard" | "bookies" | "queue" | "bets" | "casino" | "checkin";

const BOOKIES_AUTH_KEY = "bookies_authed";
const BOOKIES_LOGIN_PASSWORD = "bookies-admin-secret";

export default function App() {
  const [authed, setAuthed] = useState(() => {
    try {
      return localStorage.getItem(BOOKIES_AUTH_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [loginPassword, setLoginPassword] = useState("");
  const [loginWrong, setLoginWrong] = useState(false);
  const [loginShake, setLoginShake] = useState(0);

  const [tab, setTab] = useState<TabId>("dashboard");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [bookies, setBookies] = useState<BookieRow[]>([]);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [dashboardRemote, setDashboardRemote] = useState<DashboardPayload | null>(null);

  const [newBookieName, setNewBookieName] = useState("");
  const [editingBookie, setEditingBookie] = useState<Record<number, Partial<BookieRow>>>({});

  const [betBookieId, setBetBookieId] = useState<number | "">("");
  const [betType, setBetType] = useState<BetType>("qualifying");
  const [betMarket, setBetMarket] = useState("");
  const [backStake, setBackStake] = useState("");
  const [backOdds, setBackOdds] = useState("");
  const [layOdds, setLayOdds] = useState("");
  const [commission, setCommission] = useState("2");
  const [freeBetSnr, setFreeBetSnr] = useState(false);
  const [betNotes, setBetNotes] = useState("");

  const [checkinChecks, setCheckinChecks] = useState<Record<string, boolean | undefined>>({});
  const [checkinActionsDone, setCheckinActionsDone] = useState<Record<string, boolean>>({});
  const [mugBet, setMugBet] = useState<"yes" | "no" | "">("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [checkinSaving, setCheckinSaving] = useState(false);

  const [checkinBetBookieId, setCheckinBetBookieId] = useState<number | "">("");
  const [checkinBetMarket, setCheckinBetMarket] = useState("");
  const [checkinBetBackStake, setCheckinBetBackStake] = useState("");
  const [checkinBetBackOdds, setCheckinBetBackOdds] = useState("");
  const [checkinBetLayOdds, setCheckinBetLayOdds] = useState("");
  const [checkinBetCommission, setCheckinBetCommission] = useState("2");
  const [checkinBetFreeSnr, setCheckinBetFreeSnr] = useState(false);
  const [checkinBetSaving, setCheckinBetSaving] = useState(false);

  const [casinoAccounts, setCasinoAccounts] = useState<CasinoAccount[]>([]);
  const [editingCasino, setEditingCasino] = useState<Record<string, Partial<CasinoAccount>>>({});
  const [newCasinoName, setNewCasinoName] = useState("");
  const [newCasinoBonusType, setNewCasinoBonusType] = useState("");
  const [newCasinoWr, setNewCasinoWr] = useState("");
  const [newCasinoBonusAmt, setNewCasinoBonusAmt] = useState("");
  const [newCasinoStatus, setNewCasinoStatus] = useState<CasinoStatus>("active");
  const [newCasinoNotes, setNewCasinoNotes] = useState("");
  const [portfolioEdgePct, setPortfolioEdgePct] = useState("1.06");
  const [calcBonus, setCalcBonus] = useState("");
  const [calcWr, setCalcWr] = useState("");
  const [calcEdge, setCalcEdge] = useState("1.06");
  const [strategyChecks, setStrategyChecks] = useState<Record<string, boolean>>({});

  const refreshBookies = useCallback(async () => {
    const raw = await apiJson<unknown>("/api/bookies");
    setBookies(unwrapArray<BookieRow>(raw));
  }, []);

  const refreshBets = useCallback(async () => {
    const raw = await apiJson<unknown>("/api/bets?limit=200");
    setBets(unwrapArray<BetRow>(raw));
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      const d = await apiJson<DashboardPayload>("/api/dashboard");
      setDashboardRemote(d);
    } catch {
      setDashboardRemote(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoadErr(null);
    try {
      await Promise.all([refreshBookies(), refreshBets(), refreshDashboard()]);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [refreshBookies, refreshBets, refreshDashboard]);

  useEffect(() => {
    if (!authed) return;
    void loadAll();
  }, [authed, loadAll]);

  const computed = useMemo(() => {
    const totalPlBets = bets.reduce((s, b) => s + (Number(b.pl) || 0), 0);
    const monthlyPl = bets.filter((b) => isCurrentMonth(b.placed_at)).reduce((s, b) => s + (Number(b.pl) || 0), 0);
    const activeBookieCount = bookies.filter((b) => b.status === "active").length;
    const gubbedCount = bookies.filter((b) => b.status === "gubbed").length;
    const welcomeClaimed = bookies.filter((b) => Number(b.welcome_claimed) === 1).length;
    const welcomeTotal = bookies.length;
    const recentBets = [...bets].sort((a, b) => (a.placed_at < b.placed_at ? 1 : -1)).slice(0, 10);
    return {
      totalPlBets,
      monthlyPl,
      activeBookieCount,
      gubbedCount,
      welcomeClaimed,
      welcomeTotal,
      recentBets,
    };
  }, [bookies, bets]);

  const displayTotalPl = dashboardRemote?.total_pl ?? computed.totalPlBets;
  const displayMonthlyPl = dashboardRemote?.monthly_pl ?? computed.monthlyPl;
  const displayActive = dashboardRemote?.active_bookie_count ?? computed.activeBookieCount;
  const displayGubbed = dashboardRemote?.gubbed_count ?? computed.gubbedCount;
  const displayWelcomeClaimed = dashboardRemote?.welcome_claimed ?? computed.welcomeClaimed;
  const displayWelcomeTotal = dashboardRemote?.welcome_total ?? computed.welcomeTotal;
  const recentBets = dashboardRemote?.recent_bets ?? computed.recentBets;

  const hasMugBetThisWeek = useMemo(
    () => bets.some((b) => b.bet_type === "mug" && isInCurrentCalendarWeek(b.placed_at)),
    [bets],
  );
  const readyBookiesCount = useMemo(
    () => bookies.filter((b) => b.status === "active" && Number(b.welcome_claimed) === 1).length,
    [bookies],
  );
  const welcomeClaimedCount = useMemo(
    () => bookies.filter((b) => Number(b.welcome_claimed) === 1).length,
    [bookies],
  );
  const extractedSoFar = useMemo(
    () => bookies.reduce((sum, b) => sum + (Number(b.welcome_profit) || 0), 0),
    [bookies],
  );
  const hasReadyBookie = readyBookiesCount > 0;

  const allCommandmentsYes = SIGN_OFF_COMMANDMENTS.every((c) => checkinChecks[c.id] === true);
  const anyCommandmentNo = SIGN_OFF_COMMANDMENTS.some((c) => checkinChecks[c.id] === false);
  const complianceLabel =
    dashboardRemote?.compliance_status ??
    (allCommandmentsYes ? "Compliant" : anyCommandmentNo ? "Needs review" : "Incomplete");

  const loadCheckin = useCallback(async () => {
    const date = todayLocal();
    try {
      const raw = await apiJson<CheckinPayload | { data: CheckinPayload }>(`/api/checkin?date=${encodeURIComponent(date)}`);
      const row =
        raw && typeof raw === "object" && "data" in raw
          ? (raw as { data: CheckinPayload }).data
          : (raw as CheckinPayload);
      if (row && row.checks) {
        const next: Record<string, boolean | undefined> = {};
        for (const c of SIGN_OFF_COMMANDMENTS) {
          next[c.id] = row.checks[c.id];
        }
        setCheckinChecks(next);
        setMugBet(row.mug_bet_placed ? "yes" : "no");
        setSessionNotes(row.activity_notes || "");
        setCheckinActionsDone({});
        return;
      }
    } catch {
      /* no row yet */
    }
    setCheckinChecks({});
    setMugBet("");
    setSessionNotes("");
    setCheckinActionsDone({});
  }, []);

  useEffect(() => {
    if (!authed || tab !== "checkin") return;
    void loadCheckin();
    void refreshBookies();
    void refreshBets();
  }, [authed, tab, loadCheckin, refreshBookies, refreshBets]);

  useEffect(() => {
    if (!authed) return;
    try {
      const raw = localStorage.getItem(BOOKIES_CASINO_STORAGE);
      if (!raw) {
        setCasinoAccounts([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setCasinoAccounts(parsed as CasinoAccount[]);
    } catch {
      setCasinoAccounts([]);
    }
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const wk = weekStartISO();
    try {
      const raw = localStorage.getItem(BOOKIES_STRATEGY_STORAGE);
      const p = raw ? (JSON.parse(raw) as { week?: string; checks?: Record<string, boolean> }) : null;
      if (p?.week === wk && p.checks && typeof p.checks === "object") {
        setStrategyChecks(p.checks);
      } else {
        setStrategyChecks({});
        localStorage.setItem(BOOKIES_STRATEGY_STORAGE, JSON.stringify({ week: wk, checks: {} }));
      }
    } catch {
      setStrategyChecks({});
    }
  }, [authed]);

  const calcEvPreview = useMemo(() => {
    const bonus = parseFloat(calcBonus);
    const wr = parseFloat(calcWr);
    const edge = parseFloat(calcEdge);
    if (![bonus, wr, edge].every(Number.isFinite) || bonus < 0 || wr < 0 || edge < 0) return null;
    const wageringTurnover = bonus * wr;
    const expectedLoss = wageringTurnover * (edge / 100);
    const expectedProfit = bonus - expectedLoss;
    return { wageringTurnover, expectedLoss, expectedProfit };
  }, [calcBonus, calcWr, calcEdge]);

  const portfolioEdgeNum = parseFloat(portfolioEdgePct);
  const portfolioEdgeValid = Number.isFinite(portfolioEdgeNum) && portfolioEdgeNum >= 0;

  const strategyTier3Active = useMemo(
    () => bookies.filter((b) => bookieTierMeta(b.name)?.tier === 3 && b.status === "active"),
    [bookies],
  );
  const strategyTier1UnclaimedWelcome = useMemo(
    () =>
      bookies.filter(
        (b) =>
          bookieTierMeta(b.name)?.tier === 1 &&
          b.status !== "closed" &&
          Number(b.welcome_claimed) !== 1,
      ),
    [bookies],
  );
  const strategyCasinoBonuses = useMemo(
    () =>
      casinoAccounts.filter(
        (c) => (c.status === "active" || c.status === "wagering") && Number(c.bonus_amount) > 0,
      ),
    [casinoAccounts],
  );

  const weeklyQueueTier2Unstarted = useMemo(() => {
    const stageOf = (b: BookieRow) => {
      const s = Number(b.onboarding_stage);
      return Number.isFinite(s) && s >= 1 && s <= 5 ? Math.floor(s) : 1;
    };
    return bookies
      .filter(
        (b) =>
          b.status !== "closed" &&
          Number(b.welcome_claimed) !== 1 &&
          stageOf(b) === 1 &&
          bookieTierMeta(b.name)?.tier === 2,
      )
      .slice(0, 2);
  }, [bookies]);

  const persistCasinoAccounts = useCallback((updater: (prev: CasinoAccount[]) => CasinoAccount[]) => {
    setCasinoAccounts((prev) => {
      const next = updater(prev);
      if (authed) {
        try {
          localStorage.setItem(BOOKIES_CASINO_STORAGE, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, [authed]);

  const updateStrategyCheck = useCallback((id: string, checked: boolean) => {
    setStrategyChecks((prev) => {
      const next = { ...prev, [id]: checked };
      try {
        localStorage.setItem(BOOKIES_STRATEGY_STORAGE, JSON.stringify({ week: weekStartISO(), checks: next }));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const patchBookieField = async (id: number, patch: Partial<BookieRow>) => {
    await apiJson(`/api/bookies/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setEditingBookie((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    await refreshBookies();
  };

  const addBookie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBookieName.trim()) return;
    await apiJson("/api/bookies", {
      method: "POST",
      body: JSON.stringify({
        name: newBookieName.trim(),
        status: "active",
        welcome_claimed: 0,
        current_balance: 0,
        notes: "",
      }),
    });
    setNewBookieName("");
    await refreshBookies();
  };

  const layStakeNum = useMemo(() => {
    const bs = parseFloat(backStake);
    const bo = parseFloat(backOdds);
    const lo = parseFloat(layOdds);
    const comm = parseFloat(commission) || 0;
    if (!Number.isFinite(bs) || !Number.isFinite(bo) || !Number.isFinite(lo)) return 0;
    const snr = freeBetSnr && betType === "free_bet";
    return calcLayStake(bs, bo, lo, comm, snr);
  }, [backStake, backOdds, layOdds, commission, freeBetSnr, betType]);

  const betPlPreview = useMemo(() => {
    const bs = parseFloat(backStake);
    const bo = parseFloat(backOdds);
    const lo = parseFloat(layOdds);
    const comm = parseFloat(commission) || 0;
    if (!Number.isFinite(bs) || !Number.isFinite(bo) || !Number.isFinite(lo) || layStakeNum <= 0) {
      return null;
    }
    return calcBetPl(bs, bo, layStakeNum, lo, comm);
  }, [backStake, backOdds, layOdds, commission, layStakeNum]);

  const checkinLayStakeNum = useMemo(() => {
    const bs = parseFloat(checkinBetBackStake);
    const bo = parseFloat(checkinBetBackOdds);
    const lo = parseFloat(checkinBetLayOdds);
    const comm = parseFloat(checkinBetCommission) || 0;
    if (!Number.isFinite(bs) || !Number.isFinite(bo) || !Number.isFinite(lo)) return 0;
    return calcLayStake(bs, bo, lo, comm, checkinBetFreeSnr);
  }, [checkinBetBackStake, checkinBetBackOdds, checkinBetLayOdds, checkinBetCommission, checkinBetFreeSnr]);

  const checkinBetPlPreview = useMemo(() => {
    const bs = parseFloat(checkinBetBackStake);
    const bo = parseFloat(checkinBetBackOdds);
    const lo = parseFloat(checkinBetLayOdds);
    const comm = parseFloat(checkinBetCommission) || 0;
    if (!Number.isFinite(bs) || !Number.isFinite(bo) || !Number.isFinite(lo) || checkinLayStakeNum <= 0) {
      return null;
    }
    return calcBetPl(bs, bo, checkinLayStakeNum, lo, comm);
  }, [checkinBetBackStake, checkinBetBackOdds, checkinBetLayOdds, checkinBetCommission, checkinLayStakeNum]);

  const submitBet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (betBookieId === "" || !betMarket.trim()) return;
    const bs = parseFloat(backStake);
    const bo = parseFloat(backOdds);
    const lo = parseFloat(layOdds);
    const comm = parseFloat(commission) || 0;
    if (!Number.isFinite(bs) || !Number.isFinite(bo) || !Number.isFinite(lo)) return;
    const snr = freeBetSnr && betType === "free_bet";
    const ls = calcLayStake(bs, bo, lo, comm, snr);
    const pls = calcBetPl(bs, bo, ls, lo, comm);
    await apiJson("/api/bets", {
      method: "POST",
      body: JSON.stringify({
        bookie_id: betBookieId,
        bet_type: betType,
        market: betMarket.trim(),
        back_stake: bs,
        back_odds: bo,
        lay_stake: ls,
        lay_odds: lo,
        commission: comm,
        pl: pls.worst,
        is_free_bet: betType === "free_bet" ? 1 : 0,
        notes: betNotes.trim() || null,
      }),
    });
    setBetMarket("");
    setBetNotes("");
    await refreshBets();
    await refreshDashboard();
  };

  const submitCheckinBet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkinBetBookieId === "" || !checkinBetMarket.trim()) return;
    const bs = parseFloat(checkinBetBackStake);
    const bo = parseFloat(checkinBetBackOdds);
    const lo = parseFloat(checkinBetLayOdds);
    const comm = parseFloat(checkinBetCommission) || 0;
    if (!Number.isFinite(bs) || !Number.isFinite(bo) || !Number.isFinite(lo)) return;
    const ls = calcLayStake(bs, bo, lo, comm, checkinBetFreeSnr);
    const pls = calcBetPl(bs, bo, ls, lo, comm);
    const betType: BetType = checkinBetFreeSnr ? "free_bet" : "qualifying";
    setCheckinBetSaving(true);
    try {
      await apiJson("/api/bets", {
        method: "POST",
        body: JSON.stringify({
          bookie_id: checkinBetBookieId,
          bet_type: betType,
          market: checkinBetMarket.trim(),
          back_stake: bs,
          back_odds: bo,
          lay_stake: ls,
          lay_odds: lo,
          commission: comm,
          pl: pls.worst,
          is_free_bet: betType === "free_bet" ? 1 : 0,
          notes: null,
        }),
      });
      setCheckinBetMarket("");
      setCheckinBetBackStake("");
      setCheckinBetBackOdds("");
      setCheckinBetLayOdds("");
      await refreshBets();
      await refreshDashboard();
    } finally {
      setCheckinBetSaving(false);
    }
  };

  const saveCheckin = async () => {
    setCheckinSaving(true);
    try {
      const checks: Record<string, boolean> = {};
      for (const c of SIGN_OFF_COMMANDMENTS) {
        checks[c.id] = checkinChecks[c.id] === true;
      }
      await apiJson("/api/checkin", {
        method: "PUT",
        body: JSON.stringify({
          date: todayLocal(),
          checks,
          mug_bet_placed: mugBet === "yes" ? 1 : 0,
          activity_notes: sessionNotes,
        }),
      });
      await refreshDashboard();
    } finally {
      setCheckinSaving(false);
    }
  };

  const bookieName = (id: number) => bookies.find((b) => b.id === id)?.name ?? `#${id}`;

  const addCasinoAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCasinoName.trim()) return;
    const row: CasinoAccount = {
      id: newCasinoId(),
      name: newCasinoName.trim(),
      bonus_type: newCasinoBonusType.trim(),
      wagering_requirement: parseFloat(newCasinoWr) || 0,
      bonus_amount: parseFloat(newCasinoBonusAmt) || 0,
      status: newCasinoStatus,
      notes: newCasinoNotes,
    };
    persistCasinoAccounts((a) => [...a, row]);
    setNewCasinoName("");
    setNewCasinoBonusType("");
    setNewCasinoWr("");
    setNewCasinoBonusAmt("");
    setNewCasinoStatus("active");
    setNewCasinoNotes("");
  };

  const saveCasinoRow = (id: string, base: CasinoAccount) => {
    const ed = editingCasino[id] || {};
    const merged: CasinoAccount = {
      id,
      name: String(ed.name ?? base.name),
      bonus_type: String(ed.bonus_type ?? base.bonus_type),
      wagering_requirement: Number.isFinite(Number(ed.wagering_requirement))
        ? Number(ed.wagering_requirement)
        : base.wagering_requirement,
      bonus_amount: Number.isFinite(Number(ed.bonus_amount)) ? Number(ed.bonus_amount) : base.bonus_amount,
      status: (ed.status ?? base.status) as CasinoStatus,
      notes: ed.notes !== undefined ? String(ed.notes) : base.notes,
    };
    persistCasinoAccounts((rows) => rows.map((r) => (r.id === id ? merged : r)));
    setEditingCasino((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  };

  const deleteCasinoRow = (id: string) => {
    persistCasinoAccounts((rows) => rows.filter((r) => r.id !== id));
    setEditingCasino((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  };

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginPassword === BOOKIES_LOGIN_PASSWORD) {
      try {
        localStorage.setItem(BOOKIES_AUTH_KEY, "true");
      } catch {
        /* ignore */
      }
      setLoginWrong(false);
      setAuthed(true);
      setLoginPassword("");
      return;
    }
    setLoginWrong(true);
    setLoginShake((k) => k + 1);
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: ${BG}; color: ${TEXT}; }
        h1, h2, h3, .heading { font-family: Georgia, "Times New Roman", serif; font-weight: 600; }
        input, select, textarea, button {
          font: inherit;
          color: ${TEXT};
          background: ${CARD};
          border: 1px solid ${BORDER};
          border-radius: 6px;
          padding: 0.35rem 0.5rem;
        }
        button {
          cursor: pointer;
          background: linear-gradient(180deg, #2a2824 0%, #1f1e1b 100%);
          border-color: ${GOLD};
          color: ${GOLD};
        }
        button.secondary {
          border-color: ${BORDER};
          color: ${TEXT};
        }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid ${BORDER}; padding: 0.5rem 0.35rem; text-align: left; vertical-align: middle; }
        th { color: ${MUTED}; font-weight: 500; font-size: 0.85rem; }
        @keyframes bookies-login-shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .bookies-login-input-shake {
          animation: bookies-login-shake 0.42s ease;
        }
        a.glade-constellation-link {
          font-size: 12px;
          color: #555;
          text-decoration: none;
          transition: color 0.15s ease;
          align-self: center;
        }
        a.glade-constellation-link:hover {
          color: ${GOLD};
        }
      `}</style>
      {!authed ? (
        <div
          style={{
            minHeight: "100vh",
            background: BG,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            fontFamily: "system-ui, Segoe UI, sans-serif",
          }}
        >
          <form
            onSubmit={submitLogin}
            style={{
              width: "100%",
              maxWidth: 320,
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <h1 className="heading" style={{ margin: 0, color: GOLD, fontSize: "2.25rem", textAlign: "center" }}>
              Bookies
            </h1>
            <p style={{ margin: 0, color: MUTED, fontSize: "0.95rem", textAlign: "center" }}>Glade Systems</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                key={loginShake}
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={loginPassword}
                onChange={(ev) => {
                  setLoginPassword(ev.target.value);
                  setLoginWrong(false);
                }}
                className={loginShake > 0 ? "bookies-login-input-shake" : undefined}
                style={{ width: "100%" }}
              />
              {loginWrong && (
                <span style={{ color: "#c45c5c", fontSize: "0.85rem" }}>incorrect</span>
              )}
            </div>
            <button type="submit" style={{ width: "100%" }}>
              Submit
            </button>
          </form>
        </div>
      ) : (
      <div style={{ minHeight: "100vh", fontFamily: "system-ui, Segoe UI, sans-serif", padding: "1rem 1.25rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: "1.25rem", borderBottom: `1px solid ${BORDER}`, paddingBottom: "1rem" }}>
          <h1 className="heading" style={{ margin: 0, color: GOLD, letterSpacing: "0.02em" }}>
            Matched betting tracker
          </h1>
          <p style={{ margin: "0.35rem 0 0", color: MUTED, fontSize: "0.9rem" }}>Bookies · Queue · Bets · Daily check-in</p>
        </header>

        <nav style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "1.25rem", alignItems: "center" }}>
          <a className="glade-constellation-link" href="https://gladesystems.uk">
            ← Glade
          </a>
          {(
            [
              ["dashboard", "Dashboard"],
              ["bookies", "Bookies"],
              ["queue", "Queue"],
              ["bets", "Bets"],
              ["casino", "Casino"],
              ["checkin", "Check-in"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? undefined : "secondary"}
              onClick={() => setTab(id)}
              style={{
                borderColor: tab === id ? GOLD : BORDER,
                color: tab === id ? GOLD : TEXT,
                fontWeight: tab === id ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" className="secondary" onClick={() => void loadAll()} style={{ marginLeft: "auto" }}>
            Refresh
          </button>
        </nav>

        {loadErr && (
          <div
            role="alert"
            style={{
              padding: "0.75rem 1rem",
              marginBottom: "1rem",
              background: "#2a1f1f",
              border: `1px solid #6b3a3a`,
              borderRadius: 8,
              color: "#e8b4b4",
            }}
          >
            {loadErr}
          </div>
        )}

        {tab === "dashboard" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <Metric label="Total P&L" value={fmtMoney(displayTotalPl)} />
              <Metric label="Monthly P&L" value={fmtMoney(displayMonthlyPl)} />
              <Metric label="Active bookies" value={String(displayActive)} />
              <Metric label="Gubbed" value={String(displayGubbed)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
                <h3 className="heading" style={{ margin: "0 0 0.5rem", color: GOLD, fontSize: "1.05rem" }}>
                  Welcome offers
                </h3>
                <p style={{ margin: 0, fontSize: "1.35rem" }}>
                  {displayWelcomeClaimed} / {displayWelcomeTotal} claimed
                </p>
                <div
                  style={{
                    marginTop: "0.75rem",
                    height: 8,
                    background: BORDER,
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${displayWelcomeTotal ? (100 * displayWelcomeClaimed) / displayWelcomeTotal : 0}%`,
                      background: GOLD,
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              </div>

              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
                <h3 className="heading" style={{ margin: "0 0 0.5rem", color: GOLD, fontSize: "1.05rem" }}>
                  Compliance
                </h3>
                <p style={{ margin: 0, fontSize: "1.25rem" }}>{complianceLabel}</p>
                <p style={{ margin: "0.5rem 0 0", color: MUTED, fontSize: "0.85rem" }}>
                  Complete today&apos;s check-in tab to record the 12 commandments.
                </p>
              </div>
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
              <h3 className="heading" style={{ margin: "0 0 0.75rem", color: GOLD, fontSize: "1.05rem" }}>
                Recent bets
              </h3>
              {recentBets.length === 0 ? (
                <p style={{ color: MUTED, margin: 0 }}>No bets yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Bookie</th>
                      <th>Type</th>
                      <th>Market</th>
                      <th>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBets.map((b) => (
                      <tr key={b.id}>
                        <td style={{ color: MUTED, fontSize: "0.85rem" }}>{b.placed_at?.slice(0, 16) ?? "—"}</td>
                        <td>{bookieName(b.bookie_id)}</td>
                        <td>{b.bet_type}</td>
                        <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{b.market}</td>
                        <td style={{ color: b.pl < 0 ? "#c98a8a" : b.pl > 0 ? "#8fc9a8" : TEXT }}>{fmtMoney(b.pl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "queue" && (
          <QueueTab
            bookies={bookies}
            getTierMeta={bookieTierMeta}
            onPatchBookie={async (id, patch) => {
              await apiJson(`/api/bookies/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
              setEditingBookie((e) => {
                const n = { ...e };
                delete n[id];
                return n;
              });
              await refreshBookies();
            }}
            onRefresh={refreshBookies}
          />
        )}

        {tab === "bookies" && (
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <form onSubmit={addBookie} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <strong style={{ color: GOLD }}>New bookie</strong>
              <input
                placeholder="Name"
                value={newBookieName}
                onChange={(e) => setNewBookieName(e.target.value)}
                style={{ minWidth: 200 }}
              />
              <button type="submit">Add</button>
            </form>

            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th>Balance</th>
                    <th>Welcome</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bookies.map((b) => {
                    const ed = editingBookie[b.id] || {};
                    const status = (ed.status ?? b.status) as BookieStatus;
                    const balance = ed.current_balance ?? b.current_balance;
                    const notes = ed.notes !== undefined ? ed.notes : (b.notes ?? "");
                    const welcome = ed.welcome_claimed !== undefined ? ed.welcome_claimed : b.welcome_claimed;
                    const tier = bookieTierMeta(b.name);
                    return (
                      <tr key={b.id}>
                        <td style={{ fontWeight: 600 }}>{b.name}</td>
                        <td style={{ verticalAlign: "middle" }}>
                          {tier ? (
                            <span
                              title={tier.strategy}
                              style={{
                                display: "inline-flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: 2,
                                padding: "0.2rem 0.45rem",
                                borderRadius: 6,
                                fontSize: "0.68rem",
                                lineHeight: 1.2,
                                background: tier.bg,
                                color: tier.fg,
                                border: `1px solid ${tier.border}`,
                                cursor: "help",
                                maxWidth: 120,
                              }}
                            >
                              <span style={{ fontWeight: 700, letterSpacing: "0.02em" }}>{tier.tierLabel}</span>
                              <span style={{ opacity: 0.95, fontWeight: 500 }}>{tier.short}</span>
                            </span>
                          ) : (
                            <span style={{ color: MUTED, fontSize: "0.8rem" }}>—</span>
                          )}
                        </td>
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.15rem 0.45rem",
                              borderRadius: 4,
                              fontSize: "0.75rem",
                              background: `${statusColors[status]}33`,
                              color: statusColors[status],
                              border: `1px solid ${statusColors[status]}55`,
                              marginRight: "0.35rem",
                            }}
                          >
                            {status}
                          </span>
                          <select
                            value={status}
                            onChange={(e) =>
                              setEditingBookie((x) => ({
                                ...x,
                                [b.id]: { ...x[b.id], status: e.target.value as BookieStatus },
                              }))
                            }
                          >
                            {(["active", "restricted", "gubbed", "dormant", "closed"] as const).map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            style={{ width: 90 }}
                            value={balance}
                            onChange={(e) =>
                              setEditingBookie((x) => ({
                                ...x,
                                [b.id]: { ...x[b.id], current_balance: parseFloat(e.target.value) || 0 },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={Number(welcome) === 1}
                              onChange={(e) =>
                                setEditingBookie((x) => ({
                                  ...x,
                                  [b.id]: { ...x[b.id], welcome_claimed: e.target.checked ? 1 : 0 },
                                }))
                              }
                            />
                            claimed
                          </label>
                        </td>
                        <td>
                          <textarea
                            rows={2}
                            style={{ width: "100%", minWidth: 160, resize: "vertical" }}
                            value={notes}
                            onChange={(e) =>
                              setEditingBookie((x) => ({ ...x, [b.id]: { ...x[b.id], notes: e.target.value } }))
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              void patchBookieField(b.id, {
                                status,
                                current_balance: typeof balance === "number" ? balance : parseFloat(String(balance)) || 0,
                                notes,
                                welcome_claimed: Number(welcome) === 1 ? 1 : 0,
                              })
                            }
                          >
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "bets" && (
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <form
              onSubmit={submitBet}
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                padding: "1rem",
                display: "grid",
                gap: "0.65rem",
              }}
            >
              <h3 className="heading" style={{ margin: 0, color: GOLD, fontSize: "1.05rem" }}>
                Log bet
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Bookie</span>
                  <select value={betBookieId === "" ? "" : String(betBookieId)} onChange={(e) => setBetBookieId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">—</option>
                    {bookies.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Bet type</span>
                  <select value={betType} onChange={(e) => setBetType(e.target.value as BetType)}>
                    {(["qualifying", "free_bet", "mug", "reload", "boost"] as const).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1 / -1" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Market</span>
                  <input value={betMarket} onChange={(e) => setBetMarket(e.target.value)} placeholder="e.g. Man Utd win" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Back stake (£)</span>
                  <input value={backStake} onChange={(e) => setBackStake(e.target.value)} inputMode="decimal" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Back odds</span>
                  <input value={backOdds} onChange={(e) => setBackOdds(e.target.value)} inputMode="decimal" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Lay odds</span>
                  <input value={layOdds} onChange={(e) => setLayOdds(e.target.value)} inputMode="decimal" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Commission (%)</span>
                  <input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="decimal" />
                </label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input type="checkbox" checked={freeBetSnr} onChange={(e) => setFreeBetSnr(e.target.checked)} disabled={betType !== "free_bet"} />
                <span>Free bet SNR lay formula {betType !== "free_bet" && <span style={{ color: MUTED }}>(select free_bet)</span>}</span>
              </label>
              <div
                style={{
                  padding: "0.65rem 0.75rem",
                  background: BG,
                  borderRadius: 8,
                  border: `1px solid ${BORDER}`,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "0.35rem",
                }}
              >
                <div>
                  <span style={{ color: MUTED }}>Lay stake</span>{" "}
                  <strong style={{ color: GOLD }}>£{layStakeNum.toFixed(2)}</strong>
                </div>
                {betPlPreview && (
                  <>
                    <div>
                      <span style={{ color: MUTED }}>If back wins</span>{" "}
                      <strong style={{ color: betPlPreview.ifBackWins < 0 ? "#c98a8a" : "#8fc9a8" }}>
                        {fmtMoney(betPlPreview.ifBackWins)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: MUTED }}>If lay wins</span>{" "}
                      <strong style={{ color: betPlPreview.ifLayWins < 0 ? "#c98a8a" : "#8fc9a8" }}>
                        {fmtMoney(betPlPreview.ifLayWins)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: MUTED }}>Worst case</span>{" "}
                      <strong style={{ color: betPlPreview.worst < 0 ? "#c98a8a" : "#8fc9a8" }}>{fmtMoney(betPlPreview.worst)}</strong>
                    </div>
                  </>
                )}
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <span style={{ color: MUTED, fontSize: "0.8rem" }}>Notes</span>
                <textarea rows={2} value={betNotes} onChange={(e) => setBetNotes(e.target.value)} />
              </label>
              <button type="submit" style={{ justifySelf: "start" }}>
                Save bet
              </button>
            </form>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
              <h3 className="heading" style={{ margin: "0 0 0.75rem", color: GOLD, fontSize: "1.05rem" }}>
                Bet log
              </h3>
              {bets.length === 0 ? (
                <p style={{ color: MUTED, margin: 0 }}>No bets logged.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Bookie</th>
                        <th>Type</th>
                        <th>Market</th>
                        <th>Back</th>
                        <th>Lay</th>
                        <th>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bets]
                        .sort((a, b) => (a.placed_at < b.placed_at ? 1 : -1))
                        .map((b) => (
                          <tr key={b.id}>
                            <td style={{ color: MUTED, fontSize: "0.85rem", whiteSpace: "nowrap" }}>{b.placed_at?.slice(0, 16)}</td>
                            <td>{bookieName(b.bookie_id)}</td>
                            <td>
                              {b.bet_type}
                              {b.is_free_bet ? " (FB)" : ""}
                            </td>
                            <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{b.market}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              £{Number(b.back_stake).toFixed(2)} @ {Number(b.back_odds).toFixed(2)}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              £{Number(b.lay_stake).toFixed(2)} @ {Number(b.lay_odds).toFixed(2)}
                            </td>
                            <td style={{ color: b.pl < 0 ? "#c98a8a" : b.pl > 0 ? "#8fc9a8" : TEXT }}>{fmtMoney(b.pl)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "casino" && (
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <form
              onSubmit={addCasinoAccount}
              style={{
                display: "grid",
                gap: "0.65rem",
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                padding: "1rem",
              }}
            >
              <h3 className="heading" style={{ margin: 0, color: GOLD, fontSize: "1.05rem" }}>
                New casino account
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1 / -1" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Name</span>
                  <input value={newCasinoName} onChange={(e) => setNewCasinoName(e.target.value)} placeholder="e.g. Site / brand" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Bonus type</span>
                  <input
                    value={newCasinoBonusType}
                    onChange={(e) => setNewCasinoBonusType(e.target.value)}
                    placeholder="e.g. stake not returned"
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Wagering (×)</span>
                  <input value={newCasinoWr} onChange={(e) => setNewCasinoWr(e.target.value)} inputMode="decimal" placeholder="35" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Bonus (£)</span>
                  <input value={newCasinoBonusAmt} onChange={(e) => setNewCasinoBonusAmt(e.target.value)} inputMode="decimal" />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Status</span>
                  <select value={newCasinoStatus} onChange={(e) => setNewCasinoStatus(e.target.value as CasinoStatus)}>
                    {(["active", "wagering", "cleared", "forfeited", "expired"] as const).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1 / -1" }}>
                  <span style={{ color: MUTED, fontSize: "0.8rem" }}>Notes</span>
                  <textarea rows={2} value={newCasinoNotes} onChange={(e) => setNewCasinoNotes(e.target.value)} />
                </label>
              </div>
              <button type="submit" style={{ justifySelf: "start" }}>
                Add account
              </button>
            </form>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: MUTED, fontSize: "0.85rem" }}>Table EV uses assumed house edge (%):</span>
              <input
                value={portfolioEdgePct}
                onChange={(e) => setPortfolioEdgePct(e.target.value)}
                inputMode="decimal"
                style={{ width: 72 }}
                aria-label="Portfolio house edge percent for table"
              />
            </div>

            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Bonus type</th>
                    <th>WR (×)</th>
                    <th>Bonus £</th>
                    <th>Status</th>
                    <th>Exp. loss</th>
                    <th>Exp. profit</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {casinoAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ color: MUTED }}>
                        No casino accounts yet.
                      </td>
                    </tr>
                  ) : (
                    casinoAccounts.map((c) => {
                      const ed = editingCasino[c.id] || {};
                      const name = ed.name !== undefined ? ed.name : c.name;
                      const bonusType = ed.bonus_type !== undefined ? ed.bonus_type : c.bonus_type;
                      const wr = ed.wagering_requirement !== undefined ? ed.wagering_requirement : c.wagering_requirement;
                      const bonusAmt = ed.bonus_amount !== undefined ? ed.bonus_amount : c.bonus_amount;
                      const status = (ed.status ?? c.status) as CasinoStatus;
                      const notes = ed.notes !== undefined ? ed.notes : c.notes;
                      const expLoss = portfolioEdgeValid
                        ? casinoExpectedLossFromEdge(bonusAmt, wr, portfolioEdgeNum)
                        : 0;
                      const expProfit = bonusAmt - expLoss;
                      return (
                        <tr key={c.id}>
                          <td>
                            <input
                              style={{ minWidth: 100 }}
                              value={name}
                              onChange={(e) =>
                                setEditingCasino((x) => ({ ...x, [c.id]: { ...x[c.id], name: e.target.value } }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              style={{ minWidth: 110 }}
                              value={bonusType}
                              onChange={(e) =>
                                setEditingCasino((x) => ({ ...x, [c.id]: { ...x[c.id], bonus_type: e.target.value } }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: 72 }}
                              value={wr}
                              onChange={(e) =>
                                setEditingCasino((x) => ({
                                  ...x,
                                  [c.id]: { ...x[c.id], wagering_requirement: parseFloat(e.target.value) || 0 },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: 80 }}
                              value={bonusAmt}
                              onChange={(e) =>
                                setEditingCasino((x) => ({
                                  ...x,
                                  [c.id]: { ...x[c.id], bonus_amount: parseFloat(e.target.value) || 0 },
                                }))
                              }
                            />
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.15rem 0.45rem",
                                borderRadius: 4,
                                fontSize: "0.75rem",
                                background: `${casinoStatusColors[status]}33`,
                                color: casinoStatusColors[status],
                                border: `1px solid ${casinoStatusColors[status]}55`,
                                marginRight: "0.35rem",
                              }}
                            >
                              {status}
                            </span>
                            <select
                              value={status}
                              onChange={(e) =>
                                setEditingCasino((x) => ({
                                  ...x,
                                  [c.id]: { ...x[c.id], status: e.target.value as CasinoStatus },
                                }))
                              }
                            >
                              {(["active", "wagering", "cleared", "forfeited", "expired"] as const).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ color: expLoss > 0 ? "#c98a8a" : MUTED, whiteSpace: "nowrap" }}>
                            {portfolioEdgeValid ? fmtMoney(expLoss) : "—"}
                          </td>
                          <td style={{ color: expProfit >= 0 ? "#8fc9a8" : "#c98a8a", whiteSpace: "nowrap" }}>
                            {portfolioEdgeValid ? fmtMoney(expProfit) : "—"}
                          </td>
                          <td>
                            <textarea
                              rows={2}
                              style={{ width: "100%", minWidth: 140, resize: "vertical" }}
                              value={notes}
                              onChange={(e) =>
                                setEditingCasino((x) => ({ ...x, [c.id]: { ...x[c.id], notes: e.target.value } }))
                              }
                            />
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button type="button" onClick={() => saveCasinoRow(c.id, c)} style={{ marginRight: "0.35rem" }}>
                              Save
                            </button>
                            <button type="button" className="secondary" onClick={() => deleteCasinoRow(c.id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
                <h3 className="heading" style={{ margin: "0 0 0.75rem", color: GOLD, fontSize: "1.05rem" }}>
                  EV calculator
                </h3>
                <p style={{ margin: "0 0 0.65rem", color: MUTED, fontSize: "0.82rem", lineHeight: 1.45 }}>
                  Expected loss = (bonus × wagering multiplier) × house edge. Expected profit = bonus − expected loss.
                </p>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Bonus amount (£)</span>
                    <input value={calcBonus} onChange={(e) => setCalcBonus(e.target.value)} inputMode="decimal" />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Wagering requirement (×)</span>
                    <input value={calcWr} onChange={(e) => setCalcWr(e.target.value)} inputMode="decimal" />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>House edge (%)</span>
                    <input value={calcEdge} onChange={(e) => setCalcEdge(e.target.value)} inputMode="decimal" />
                  </label>
                </div>
                <div
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.65rem 0.75rem",
                    background: BG,
                    borderRadius: 8,
                    border: `1px solid ${BORDER}`,
                    fontSize: "0.9rem",
                    display: "grid",
                    gap: "0.35rem",
                  }}
                >
                  {calcEvPreview ? (
                    <>
                      <div>
                        <span style={{ color: MUTED }}>Wagering turnover</span>{" "}
                        <strong style={{ color: TEXT }}>{fmtMoney(calcEvPreview.wageringTurnover)}</strong>
                      </div>
                      <div>
                        <span style={{ color: MUTED }}>Expected loss</span>{" "}
                        <strong style={{ color: "#c98a8a" }}>{fmtMoney(calcEvPreview.expectedLoss)}</strong>
                      </div>
                      <div>
                        <span style={{ color: MUTED }}>Expected profit</span>{" "}
                        <strong style={{ color: calcEvPreview.expectedProfit >= 0 ? "#8fc9a8" : "#c98a8a" }}>
                          {fmtMoney(calcEvPreview.expectedProfit)}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <span style={{ color: MUTED }}>Enter valid numbers to see live EV.</span>
                  )}
                </div>
              </div>

              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
                <h3 className="heading" style={{ margin: "0 0 0.65rem", color: GOLD, fontSize: "1.05rem" }}>
                  Recommended games
                </h3>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", color: TEXT, lineHeight: 1.55, fontSize: "0.9rem" }}>
                  {RECOMMENDED_CASINO_GAMES.map((g) => (
                    <li key={g.name}>
                      <strong>{g.name}</strong> ({g.edge}) — {g.note}
                    </li>
                  ))}
                </ul>
              </div>

              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "1rem" }}>
                <h3 className="heading" style={{ margin: "0 0 0.65rem", color: GOLD, fontSize: "1.05rem" }}>
                  Anti-detection tips
                </h3>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", color: MUTED, lineHeight: 1.55, fontSize: "0.9rem" }}>
                  {ANTI_DETECTION_TIPS.map((t) => (
                    <li key={t} style={{ color: TEXT }}>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {tab === "checkin" && (
          <div style={{ maxWidth: 680, margin: "0 auto", paddingBottom: "2rem" }}>
            <section
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
              }}
            >
              <p style={{ margin: 0, color: TEXT, fontSize: "0.92rem", lineHeight: 1.5 }}>
                Setup progress: <strong>{readyBookiesCount}</strong> of 38 bookies ready ·{" "}
                <strong>{welcomeClaimedCount}</strong> welcome offers claimed ·{" "}
                <strong>{fmtMoney(extractedSoFar)}</strong> extracted so far
              </p>
            </section>
            <p style={{ margin: "0 0 1.5rem", color: MUTED, fontSize: "0.88rem", lineHeight: 1.5 }}>
              <span style={{ color: TEXT }}>{todayLocal()}</span>
              {" · "}
              Guided routine — about 10 minutes top to bottom
            </p>

            {hasReadyBookie ? (
              <>
            {new Date().getDay() === 1 && (
              <section
                style={{
                  marginBottom: "1.25rem",
                  padding: "1rem 1.1rem",
                  background: "#1e2218",
                  border: `1px solid ${GOLD}`,
                  borderRadius: 10,
                }}
              >
                <h3
                  className="heading"
                  style={{
                    margin: "0 0 0.5rem",
                    color: GOLD,
                    fontSize: "0.82rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  This week&apos;s new accounts
                </h3>
                <p style={{ margin: 0, color: TEXT, fontSize: "0.9rem", lineHeight: 1.55 }}>
                  This week&apos;s new accounts: you can open 1-2 new bookies this week. Recommended next:{" "}
                  <strong style={{ color: GOLD }}>
                    {weeklyQueueTier2Unstarted.length > 0
                      ? weeklyQueueTier2Unstarted.map((b) => b.name).join(" · ")
                      : "add Tier 2 bookies in Bookies tab, then set them in Queue"}
                  </strong>
                  . Remember: account creation only — no deposit until tomorrow, no bet until day after.
                </p>
              </section>
            )}

            <section
              style={{
                paddingBottom: "1.35rem",
                marginBottom: "1.35rem",
                borderBottom: `1px solid ${BORDER}`,
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 10,
                padding: "1rem 1.1rem",
              }}
            >
              <h3
                className="heading"
                style={{
                  margin: "0 0 0.5rem",
                  color: GOLD,
                  fontSize: "0.82rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                This week&apos;s strategy
              </h3>
              <p style={{ margin: "0 0 0.85rem", color: MUTED, fontSize: "0.82rem", lineHeight: 1.5 }}>
                Priority focus for the week (week starting {weekStartISO()}). Suggestions from your data — tick when you&apos;ve
                planned or done the work. Resets each calendar week.
              </p>
              <div
                style={{
                  marginBottom: "1rem",
                  padding: "0.65rem 0.75rem",
                  background: BG,
                  borderRadius: 8,
                  border: `1px solid ${BORDER}`,
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                <div style={{ color: GOLD, fontWeight: 600, marginBottom: "0.35rem" }}>Suggested queue</div>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", color: MUTED }}>
                  {strategyTier3Active.length > 0 ? (
                    <li style={{ color: TEXT }}>
                      <span style={{ color: MUTED }}>Tier 3 active (reloads): </span>
                      {strategyTier3Active.map((b) => b.name).join(", ")}
                    </li>
                  ) : (
                    <li>No Tier 3 accounts marked active — add bookies or adjust status for reload priority.</li>
                  )}
                  {strategyTier1UnclaimedWelcome.length > 0 ? (
                    <li style={{ color: TEXT, marginTop: "0.35rem" }}>
                      <span style={{ color: MUTED }}>Tier 1 welcome not claimed: </span>
                      {strategyTier1UnclaimedWelcome.map((b) => b.name).join(", ")}
                    </li>
                  ) : (
                    <li style={{ marginTop: "0.35rem" }}>No Tier 1 unclaimed welcomes flagged.</li>
                  )}
                  {strategyCasinoBonuses.length > 0 ? (
                    <li style={{ color: TEXT, marginTop: "0.35rem" }}>
                      <span style={{ color: MUTED }}>Casino bonuses in play: </span>
                      {strategyCasinoBonuses.map((c) => c.name).join(", ")}
                    </li>
                  ) : (
                    <li style={{ marginTop: "0.35rem" }}>No active / wagering casino bonuses with value logged.</li>
                  )}
                  <li style={{ marginTop: "0.35rem" }}>
                    Acca insurance: use the{" "}
                    <a
                      href="https://www.oddsmonkey.com/Tools/AccaMatcher.aspx"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: GOLD, textDecoration: "underline", textUnderlineOffset: "3px" }}
                    >
                      OddsMonkey acca tool
                    </a>
                    .
                  </li>
                </ul>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.65rem" }}>
                {STRATEGY_CHECKLIST.map((item) => (
                  <li key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
                    <input
                      type="checkbox"
                      id={`strat-${item.id}`}
                      checked={!!strategyChecks[item.id]}
                      onChange={(e) => updateStrategyCheck(item.id, e.target.checked)}
                      style={{ marginTop: "0.2rem", width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
                    />
                    <label htmlFor={`strat-${item.id}`} style={{ cursor: "pointer", lineHeight: 1.45, color: TEXT }}>
                      {item.label}
                    </label>
                  </li>
                ))}
              </ul>
              <a
                href="https://www.oddsmonkey.com/Tools/AccaMatcher.aspx"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: "0.85rem",
                  color: MUTED,
                  fontSize: "0.88rem",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Open OddsMonkey acca matcher →
              </a>
            </section>

            {/* 1. DISCOVER */}
            <section
              style={{
                paddingBottom: "1.35rem",
                marginBottom: "1.35rem",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="heading"
                style={{
                  margin: "0 0 0.85rem",
                  color: GOLD,
                  fontSize: "0.82rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Discover
              </h3>
              <a
                href="https://www.oddsmonkey.com/Tools/OddsMatcher.aspx"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  textAlign: "center",
                  padding: "0.95rem 1.1rem",
                  background: "linear-gradient(180deg, #2f2d28 0%, #1f1e1b 100%)",
                  border: `2px solid ${GOLD}`,
                  borderRadius: 10,
                  color: GOLD,
                  fontWeight: 600,
                  textDecoration: "none",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
                }}
              >
                Open OddsMonkey odds matcher
              </a>
              <a
                href="https://www.oddsmonkey.com/Members/PromotionsFinder.aspx"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: "0.65rem",
                  color: MUTED,
                  fontSize: "0.88rem",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Check today&apos;s reload offers
              </a>
            </section>

            {/* 2. TODAY'S ACTIONS */}
            <section
              style={{
                paddingBottom: "1.35rem",
                marginBottom: "1.35rem",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="heading"
                style={{
                  margin: "0 0 0.85rem",
                  color: GOLD,
                  fontSize: "0.82rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Today&apos;s actions
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
                {TODAY_ACTIONS.map((a) => (
                  <li
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.65rem",
                      padding: "0.55rem 0",
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      id={a.id}
                      checked={!!checkinActionsDone[a.id]}
                      onChange={(e) =>
                        setCheckinActionsDone((prev) => ({ ...prev, [a.id]: e.target.checked }))
                      }
                      style={{ marginTop: "0.2rem", width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
                    />
                    <label htmlFor={a.id} style={{ cursor: "pointer", lineHeight: 1.45, color: TEXT }}>
                      {a.text}
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            {/* 3. LOG YOUR BET */}
            <section
              style={{
                paddingBottom: "1.35rem",
                marginBottom: "1.35rem",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="heading"
                style={{
                  margin: "0 0 0.85rem",
                  color: GOLD,
                  fontSize: "0.82rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Log your bet
              </h3>
              <form
                onSubmit={(e) => void submitCheckinBet(e)}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "0.85rem",
                  display: "grid",
                  gap: "0.55rem",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.45rem" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", gridColumn: "1 / -1" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Bookie</span>
                    <select
                      value={checkinBetBookieId === "" ? "" : String(checkinBetBookieId)}
                      onChange={(e) => setCheckinBetBookieId(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">—</option>
                      {bookies.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", gridColumn: "1 / -1" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Market</span>
                    <input
                      value={checkinBetMarket}
                      onChange={(e) => setCheckinBetMarket(e.target.value)}
                      placeholder="e.g. Man Utd win"
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Back £</span>
                    <input value={checkinBetBackStake} onChange={(e) => setCheckinBetBackStake(e.target.value)} inputMode="decimal" />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Back odds</span>
                    <input value={checkinBetBackOdds} onChange={(e) => setCheckinBetBackOdds(e.target.value)} inputMode="decimal" />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Lay odds</span>
                    <input value={checkinBetLayOdds} onChange={(e) => setCheckinBetLayOdds(e.target.value)} inputMode="decimal" />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    <span style={{ color: MUTED, fontSize: "0.75rem" }}>Comm %</span>
                    <input value={checkinBetCommission} onChange={(e) => setCheckinBetCommission(e.target.value)} inputMode="decimal" />
                  </label>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", cursor: "pointer", fontSize: "0.88rem" }}>
                  <input
                    type="checkbox"
                    checked={checkinBetFreeSnr}
                    onChange={(e) => setCheckinBetFreeSnr(e.target.checked)}
                  />
                  <span>Free bet (SNR lay formula)</span>
                </label>
                <div
                  style={{
                    padding: "0.5rem 0.6rem",
                    background: BG,
                    borderRadius: 8,
                    border: `1px solid ${BORDER}`,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.65rem 1rem",
                    fontSize: "0.85rem",
                  }}
                >
                  <span>
                    <span style={{ color: MUTED }}>Lay stake</span>{" "}
                    <strong style={{ color: GOLD }}>£{checkinLayStakeNum.toFixed(2)}</strong>
                  </span>
                  {checkinBetPlPreview && (
                    <>
                      <span>
                        <span style={{ color: MUTED }}>Worst P&amp;L</span>{" "}
                        <strong style={{ color: checkinBetPlPreview.worst < 0 ? "#c98a8a" : "#8fc9a8" }}>
                          {fmtMoney(checkinBetPlPreview.worst)}
                        </strong>
                      </span>
                      <span style={{ color: MUTED }}>
                        Back wins {fmtMoney(checkinBetPlPreview.ifBackWins)} · Lay wins {fmtMoney(checkinBetPlPreview.ifLayWins)}
                      </span>
                    </>
                  )}
                </div>
                <button type="submit" disabled={checkinBetSaving} style={{ justifySelf: "start", marginTop: "0.15rem" }}>
                  {checkinBetSaving ? "Saving…" : "Save bet"}
                </button>
              </form>
            </section>

            {/* 4. MUG BET REMINDER */}
            {!hasMugBetThisWeek && (
              <section
                style={{
                  paddingBottom: "1.35rem",
                  marginBottom: "1.35rem",
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                <h3
                  className="heading"
                  style={{
                    margin: "0 0 0.65rem",
                    color: GOLD,
                    fontSize: "0.82rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  Mug bet reminder
                </h3>
                <p style={{ margin: "0 0 0.85rem", color: TEXT, lineHeight: 1.5, fontSize: "0.92rem" }}>
                  Budget reminder: place a small mug bet this session (£2–5, any popular match, unmatched).
                </p>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: MUTED, fontSize: "0.85rem", marginRight: "0.25rem" }}>This session:</span>
                  <button type="button" className={mugBet === "yes" ? undefined : "secondary"} onClick={() => setMugBet("yes")}>
                    Yes
                  </button>
                  <button type="button" className={mugBet === "no" ? undefined : "secondary"} onClick={() => setMugBet("no")}>
                    No
                  </button>
                </div>
              </section>
            )}

            {hasMugBetThisWeek && (
              <p
                style={{
                  margin: "0 0 1.35rem",
                  paddingBottom: "1.35rem",
                  borderBottom: `1px solid ${BORDER}`,
                  color: MUTED,
                  fontSize: "0.88rem",
                }}
              >
                Mug bet already logged this calendar week — skip the budget reminder.
              </p>
            )}

            {/* 5. COMMANDMENTS SIGN-OFF */}
            <section
              style={{
                paddingBottom: "1.35rem",
                marginBottom: "1.35rem",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="heading"
                style={{
                  margin: "0 0 0.85rem",
                  color: GOLD,
                  fontSize: "0.82rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Commandments sign-off
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "0.5rem",
                }}
              >
                {SIGN_OFF_COMMANDMENTS.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: CARD,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                      padding: "0.45rem 0.4rem",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "0.35rem",
                      minHeight: 88,
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      className="heading"
                      style={{
                        fontSize: "0.72rem",
                        lineHeight: 1.25,
                        textAlign: "center",
                        color: TEXT,
                        fontWeight: 600,
                      }}
                    >
                      {c.label}
                    </span>
                    <span style={{ display: "flex", gap: "0.25rem" }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setCheckinChecks((x) => ({ ...x, [c.id]: true }))}
                        style={{
                          padding: "0.2rem 0.4rem",
                          fontSize: "0.75rem",
                          borderColor: checkinChecks[c.id] === true ? "#4a8f6a" : BORDER,
                          color: checkinChecks[c.id] === true ? "#8fc9a8" : MUTED,
                        }}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setCheckinChecks((x) => ({ ...x, [c.id]: false }))}
                        style={{
                          padding: "0.2rem 0.4rem",
                          fontSize: "0.75rem",
                          borderColor: checkinChecks[c.id] === false ? "#b84d4d" : BORDER,
                          color: checkinChecks[c.id] === false ? "#c98a8a" : MUTED,
                        }}
                      >
                        ✗
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
              </>
            ) : (
              <section
                style={{
                  paddingBottom: "1.35rem",
                  marginBottom: "1.35rem",
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                <h3
                  className="heading"
                  style={{
                    margin: "0 0 0.85rem",
                    color: GOLD,
                    fontSize: "0.82rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  Today&apos;s actions
                </h3>
                <p style={{ margin: "0 0 0.75rem", color: TEXT, lineHeight: 1.6 }}>
                  You&apos;re in setup phase — no betting actions yet.
                </p>
                <p style={{ margin: "0 0 0.75rem", color: TEXT, lineHeight: 1.6 }}>
                  Today&apos;s job:
                  <br />
                  → Check your queue tab to see what stage each bookie is at
                  <br />
                  → Do only what the queue tells you to do today
                  <br />
                  → No bets until at least one bookie reaches Day 3
                </p>
                <button type="button" onClick={() => setTab("queue")}>
                  Open queue tab
                </button>
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "0.85rem 1rem",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    opacity: 0.65,
                  }}
                >
                  <h3
                    className="heading"
                    style={{
                      margin: "0 0 0.45rem",
                      color: MUTED,
                      fontSize: "0.82rem",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                    }}
                  >
                    Mug bet reminder
                  </h3>
                  <p style={{ margin: 0, color: MUTED, lineHeight: 1.5, fontSize: "0.92rem" }}>
                    not yet — comes after first qualifying bet
                  </p>
                </div>
              </section>
            )}

            {/* 6. SESSION NOTES */}
            <section style={{ display: "grid", gap: "0.75rem" }}>
              <h3
                className="heading"
                style={{
                  margin: 0,
                  color: GOLD,
                  fontSize: "0.82rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Session notes
              </h3>
              <textarea
                rows={5}
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Balances, follow-ups, anything to remember…"
                style={{ width: "100%", resize: "vertical" }}
              />
              <button type="button" disabled={checkinSaving} onClick={() => void saveCheckin()}>
                {checkinSaving ? "Saving…" : "Save check-in"}
              </button>
            </section>
          </div>
        )}
      </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "0.85rem 1rem",
      }}
    >
      <div style={{ color: MUTED, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="heading" style={{ fontSize: "1.35rem", marginTop: "0.25rem", color: GOLD }}>
        {value}
      </div>
    </div>
  );
}
