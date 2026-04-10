import { useCallback, useMemo, useState } from "react";

const BG = "#0f0f0d";
const TEXT = "#e8e4d9";
const GOLD = "#d4a853";
const MUTED = "#9a9588";
const CARD = "#1a1916";
const BORDER = "#2e2c27";
const AMBER = "#c9a227";

export type QueueBookie = {
  id: number;
  name: string;
  status: string;
  welcome_claimed: number;
  joined_at?: string;
  last_activity?: string;
  onboarding_stage?: number;
  queue_stage?: number;
  stage_updated_at?: string;
};

export type TierMeta = {
  tier: 1 | 2 | 3;
  tierLabel: string;
  short: string;
  bg: string;
  fg: string;
  border: string;
};

const KANBAN_COLUMNS: { stage: number; title: string }[] = [
  { stage: 1, title: "Not started" },
  { stage: 2, title: "Account created" },
  { stage: 3, title: "Deposited" },
  { stage: 4, title: "Qualifying bet placed" },
  { stage: 5, title: "Free bet claimed ✓" },
];

const STAGE_HINTS: Record<number, string> = {
  1: "When ready: create the account only — no deposit until tomorrow.",
  2: "Deposit £10-25 after browsing; don't touch the welcome offer yet.",
  3: "Run the qualifying bet — OddsMonkey matcher, lay on Smarkets first.",
  4: "Use the free bet — SNR calculator, odds ~4–6, lay first.",
  5: "Enter your welcome profit below to finish — card leaves the queue.",
};

const ONGOING_TIPS = [
  "Leave a small balance after claiming — don’t withdraw everything immediately",
  "Place 1–2 small mug bets before withdrawing (£2–5, popular matches)",
  "Wait at least a week before withdrawing bulk",
  "Keep the app installed and open it occasionally",
  "Never place bets immediately after logging in — browse first every single time",
  "Vary the times of day you log in",
  "Never use round stakes — always add odd pence",
];

/** Kanban column = persisted queue_stage (falls back to onboarding_stage for older rows). */
function queueStage(b: QueueBookie): number {
  const q = Number(b.queue_stage);
  if (Number.isFinite(q) && q >= 1 && q <= 5) return Math.floor(q);
  const s = Number(b.onboarding_stage);
  if (Number.isFinite(s) && s >= 1 && s <= 5) return Math.floor(s);
  return 1;
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** First YYYY-MM-DD from ISO / SQLite timestamp. */
function stageDayOnly(iso: string | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Whole calendar days from stage_updated_at (date part) to today (local). */
function daysSinceStageUpdate(stageUpdatedAt: string | undefined): number {
  const start = stageDayOnly(stageUpdatedAt);
  if (!start) return 0;
  const t0 = new Date(`${start}T12:00:00`).getTime();
  const t1 = new Date(`${ymdLocal(new Date())}T12:00:00`).getTime();
  const diff = Math.floor((t1 - t0) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff);
}

function parseMaybeDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(t.getTime())) return null;
  return t;
}

function startOfWeekMonday(ref = new Date()): Date {
  const day = ref.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function isInCurrentCalendarWeek(iso: string | undefined): boolean {
  const t = parseMaybeDate(iso);
  if (!t) return false;
  const start = startOfWeekMonday(new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return t >= start && t < end;
}

type AccountActionLine = { text: string; overdue?: boolean };

function accountActionLines(b: QueueBookie): AccountActionLine[] {
  const stage = queueStage(b);
  const d = daysSinceStageUpdate(b.stage_updated_at);
  const name = b.name;

  if (stage === 2) {
    if (d >= 2) {
      return [{ text: "Overdue: you should have deposited by now — do it today", overdue: true }];
    }
    if (d >= 1) {
      return [
        {
          text: `Today: Open ${name} → browse 2 mins → deposit £10-25 → close it. Don't touch welcome offer.`,
        },
      ];
    }
    return [{ text: "Tomorrow: deposit £10-25 after browsing 2 mins" }];
  }
  if (stage === 3) {
    if (d >= 2) {
      return [{ text: "Overdue: you should have placed the qualifying bet by now — do it today", overdue: true }];
    }
    if (d >= 1) {
      return [
        {
          text: `Today: Open OddsMonkey → filter for ${name} → find odds within 0.15 → lay Smarkets FIRST → back at bookie → log in Bookies`,
        },
      ];
    }
    return [{ text: "Tomorrow: place qualifying bet" }];
  }
  if (stage === 4) {
    if (d >= 2) {
      return [{ text: "Overdue: you should have extracted the free bet by now — do it today", overdue: true }];
    }
    if (d >= 1) {
      return [
        {
          text:
            "Today: Check free bet landed → find odds 4.0-6.0 → SNR calculator → lay Smarkets FIRST → back with free bet → log profit",
        },
      ];
    }
    return [{ text: "Tomorrow: check free bet has landed, then extract it" }];
  }
  return [];
}

function tierSortKey(getTierMeta: (name: string) => TierMeta | null, name: string): number {
  const t = getTierMeta(name)?.tier;
  if (t === 1) return 0;
  if (t === 2) return 1;
  if (t === 3) return 2;
  return 3;
}

/** Lower = more urgent for “today’s action” among stages 2–4. */
const STAGE_URGENCY: Record<number, number> = {
  2: 0,
  3: 1,
  4: 2,
  1: 3,
  5: 4,
};

/**
 * Sort bucket for focus card: 0 = overdue (≥2d), 1 = today (1d), 2 = tomorrow (0d), 9 = other (e.g. stage 1).
 */
function urgencyBucket(b: QueueBookie): number {
  const stage = queueStage(b);
  if (stage < 2 || stage > 4) return 9;
  const d = daysSinceStageUpdate(b.stage_updated_at);
  if (d >= 2) return 0;
  if (d >= 1) return 1;
  return 2;
}

function pickFocusBookie(rows: QueueBookie[], getTierMeta: (name: string) => TierMeta | null): QueueBookie | null {
  const pipe = rows.filter((b) => b.status !== "closed" && Number(b.welcome_claimed) !== 1);
  if (!pipe.length) return null;
  return [...pipe].sort((a, b) => {
    const ba = urgencyBucket(a);
    const bb = urgencyBucket(b);
    if (ba !== bb) return ba - bb;
    const sa = queueStage(a);
    const sb = queueStage(b);
    const ua = STAGE_URGENCY[sa] ?? 9;
    const ub = STAGE_URGENCY[sb] ?? 9;
    if (ua !== ub) return ua - ub;
    const ta = tierSortKey(getTierMeta, a.name);
    const tb = tierSortKey(getTierMeta, b.name);
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  })[0];
}

function cardStageHint(b: QueueBookie): string {
  const stage = queueStage(b);
  const d = daysSinceStageUpdate(b.stage_updated_at);
  if (stage === 2) {
    if (d >= 2) return "Overdue: deposit today";
    if (d >= 1) return "Today: deposit (browse first)";
    return "Tomorrow: deposit after browsing";
  }
  if (stage === 3) {
    if (d >= 2) return "Overdue: qualifying bet";
    if (d >= 1) return "Today: qualifying bet (OM + Smarkets first)";
    return "Tomorrow: qualifying bet";
  }
  if (stage === 4) {
    if (d >= 2) return "Overdue: extract free bet";
    if (d >= 1) return "Today: free bet / SNR";
    return "Tomorrow: check free bet landed";
  }
  return STAGE_HINTS[stage];
}

const CHECKLIST_DAY1 = [
  "Go to bookie website directly — not via Google Ads or comparison site",
  "Sign up with real details — real name, real address, real DOB, real phone number",
  "Use your regular email address (not a new one created for this)",
  "Verify email immediately",
  "Browse homepage naturally for 2-3 mins — check a few markets, glance at promotions page",
  "Add something to betslip, remove it",
  "Download their app on your phone, open it briefly",
  "Close everything — do not deposit today",
];

const CHECKLIST_DAY2 = [
  "Open bookie site or app",
  "Browse for 2 mins before touching deposit",
  "Deposit £10-25 (normal new customer amount)",
  "Browse a bit more after depositing — don't immediately look for offers",
  "Close it — do not place any bets today",
];

const CHECKLIST_DAY3 = [
  "Open OddsMonkey odds matcher — filter by this bookie",
  "Find market where back/lay odds difference is under 0.15",
  "Open Bookies calculator — enter back stake, back odds, lay odds, 2% commission",
  "Note the lay stake and qualifying loss",
  "Open Smarkets — place lay bet FIRST",
  "Immediately open bookie — place back bet",
  "Screenshot both bets",
  "Log bet in Bookies app",
];

const CHECKLIST_DAY4 = [
  "Check free bet has landed in your account",
  "Find market with odds between 4.0-6.0 (maximises free bet retention)",
  "Run free bet calculator in Bookies (SNR toggle on)",
  "Place lay on Smarkets FIRST",
  "Place free bet back at bookie",
  "Log in Bookies",
  "Screenshot both",
  "Move card to column 5, enter profit",
];

type QueueTabProps = {
  bookies: QueueBookie[];
  getTierMeta: (name: string) => TierMeta | null;
  onPatchStage: (id: number, stage: number) => Promise<void>;
  onPatchBookie: (id: number, patch: Record<string, unknown>) => Promise<void>;
  onRefresh: () => Promise<void>;
};

export function QueueTab({ bookies, getTierMeta, onPatchStage, onPatchBookie, onRefresh }: QueueTabProps) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [profitModal, setProfitModal] = useState<{ id: number; name: string } | null>(null);
  const [profitInput, setProfitInput] = useState("");
  const [profitSaving, setProfitSaving] = useState(false);
  const [guideBookie, setGuideBookie] = useState<QueueBookie | null>(null);
  const [patchErr, setPatchErr] = useState<string | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  const pipeline = useMemo(
    () => bookies.filter((b) => b.status !== "closed" && Number(b.welcome_claimed) !== 1),
    [bookies],
  );

  const focus = useMemo(() => pickFocusBookie(bookies, getTierMeta), [bookies, getTierMeta]);

  const upcomingSorted = useMemo(() => {
    const rows = pipeline.filter((b) => {
      const s = queueStage(b);
      return s >= 2 && s <= 4;
    });
    return [...rows].sort((a, b) => {
      const da = a.stage_updated_at ?? "";
      const db = b.stage_updated_at ?? "";
      if (da !== db) return da.localeCompare(db);
      return a.name.localeCompare(b.name);
    });
  }, [pipeline]);

  const recommendedNewAccount = useMemo(() => {
    const activePipeline = bookies.filter((b) => {
      if (b.status === "closed" || Number(b.welcome_claimed) === 1) return false;
      const s = queueStage(b);
      return s >= 2 && s <= 4;
    });
    const currentlySettingUpCount = activePipeline.length;

    const openedThisWeekCount = activePipeline.filter((b) => isInCurrentCalendarWeek(b.last_activity)).length;

    const mostRecentCreatedMs = activePipeline
      .map((b) => parseMaybeDate(b.last_activity)?.getTime() ?? NaN)
      .filter((t) => Number.isFinite(t))
      .reduce<number | null>((max, t) => (max === null || t > max ? t : max), null);
    const mostRecentCreatedDaysAgo =
      mostRecentCreatedMs === null ? null : Math.max(0, Math.floor((Date.now() - mostRecentCreatedMs) / (24 * 60 * 60 * 1000)));
    const staleEnough = mostRecentCreatedDaysAgo === null || mostRecentCreatedDaysAgo >= 3;

    const tier2Order = ["Sky Bet", "Paddy Power", "Ladbrokes", "William Hill", "Coral", "BetVictor"];
    const byName = new Map(
      bookies.map((b) => [b.name.trim().toLowerCase(), b] as const),
    );
    const nextUnstarted = tier2Order
      .map((name) => byName.get(name.toLowerCase()))
      .find((b) => b && b.status !== "closed" && Number(b.welcome_claimed) !== 1 && queueStage(b) === 1);

    const shouldRecommend = currentlySettingUpCount < 2 && staleEnough && openedThisWeekCount < 2 && !!nextUnstarted;
    return shouldRecommend ? nextUnstarted : null;
  }, [bookies]);

  const handleDropOnColumn = useCallback(
    async (bookieId: number, stage: number) => {
      setPatchErr(null);
      const b = bookies.find((x) => x.id === bookieId);
      if (!b) return;
      if (stage === 5) {
        setProfitModal({ id: bookieId, name: b.name });
        setProfitInput("");
        return;
      }
      try {
        await onPatchStage(bookieId, stage);
        await onRefresh();
      } catch (e) {
        setPatchErr(e instanceof Error ? e.message : String(e));
      }
    },
    [bookies, onPatchStage, onRefresh],
  );

  const confirmProfit = useCallback(async () => {
    if (!profitModal) return;
    const n = parseFloat(profitInput.replace(/,/g, ""));
    if (!Number.isFinite(n)) {
      setPatchErr("Enter a valid profit amount.");
      return;
    }
    setProfitSaving(true);
    setPatchErr(null);
    try {
      await onPatchBookie(profitModal.id, {
        welcome_claimed: 1,
        welcome_profit: n,
        onboarding_stage: 5,
        queue_stage: 5,
      });
      setProfitModal(null);
      await onRefresh();
    } catch (e) {
      setPatchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProfitSaving(false);
    }
  }, [profitModal, profitInput, onPatchStage, onPatchBookie, onRefresh]);

  const n = (name: string) => name.trim().toLowerCase();
  const isCoral = focus && n(focus.name) === "coral";
  const focusStage = focus ? queueStage(focus) : 1;
  const focusActionLines = focus ? accountActionLines(focus) : [];

  return (
    <div style={{ display: "grid", gap: "1.5rem", paddingBottom: "2rem" }}>
      {patchErr && (
        <div
          role="alert"
          style={{
            padding: "0.65rem 0.85rem",
            background: "#2a1f1f",
            border: "1px solid #6b3a3a",
            borderRadius: 8,
            color: "#e8b4b4",
            fontSize: "0.88rem",
          }}
        >
          {patchErr}
        </div>
      )}

      {recommendedNewAccount && (
        <section>
          <div
            style={{
              padding: "1rem 1.1rem",
              background: "#1e2218",
              border: `1px solid ${GOLD}`,
              borderRadius: 10,
              boxShadow: "0 4px 24px rgba(0,0,0,0.28)",
            }}
          >
            <h2
              className="heading"
              style={{
                margin: "0 0 0.5rem",
                color: GOLD,
                fontSize: "0.82rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Ready to open a new account this week?
            </h2>
            <p style={{ margin: 0, color: TEXT, fontSize: "0.92rem", lineHeight: 1.55 }}>
              Recommended next: <strong style={{ color: GOLD }}>{recommendedNewAccount.name}</strong>
              . Remember: account creation only today - no deposit until tomorrow.
            </p>
          </div>
        </section>
      )}

      {/* Section 1 */}
      <section>
        <h2
          className="heading"
          style={{
            margin: "0 0 0.75rem",
            color: GOLD,
            fontSize: "0.82rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Today&apos;s account action
        </h2>
        {!focus ? (
          <p style={{ color: MUTED, margin: 0 }}>No bookies in the welcome pipeline — add one or unclaim a welcome to see actions here.</p>
        ) : (
          <>
            <div
              style={{
                background: `linear-gradient(145deg, ${CARD} 0%, #141311 100%)`,
                border: `1px solid ${GOLD}`,
                borderRadius: 12,
                padding: "1.1rem 1.2rem",
                boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ color: MUTED, fontSize: "0.78rem", marginBottom: "0.35rem", letterSpacing: "0.06em" }}>
                Most urgent · <span style={{ color: GOLD }}>{focus.name}</span> · stage {focusStage}
                {focus.stage_updated_at && (
                  <span style={{ marginLeft: "0.5rem", opacity: 0.85 }}>
                    · stage since {stageDayOnly(focus.stage_updated_at) ?? focus.stage_updated_at.slice(0, 10)}
                  </span>
                )}
              </div>
              {focusStage >= 2 && focusStage <= 4 ? (
                <div style={{ display: "grid", gap: "0.85rem", color: TEXT, lineHeight: 1.55, fontSize: "0.92rem" }}>
                  {focusActionLines.map((line, i) => (
                    <p
                      key={i}
                      style={{
                        margin: 0,
                        color: line.overdue ? AMBER : TEXT,
                        fontWeight: line.overdue ? 600 : 400,
                      }}
                    >
                      {line.text}
                    </p>
                  ))}
                  {focusStage === 2 && !focusActionLines.some((l) => l.overdue) && (
                    <p style={{ margin: 0 }}>
                      <strong style={{ color: GOLD }}>{focus.name} welcome offer:</strong> Bet £5 get £20. Expected qualifying loss: ~£0.50-1.00.
                      Expected free bet profit: £13-16.
                    </p>
                  )}
                </div>
              ) : (
                <div style={{ color: TEXT, lineHeight: 1.55, fontSize: "0.92rem" }}>
                  <p style={{ margin: "0 0 0.75rem" }}>
                    <strong style={{ color: GOLD }}>{focus.name}</strong> — {STAGE_HINTS[focusStage]}
                  </p>
                  <p style={{ margin: 0, color: MUTED, fontSize: "0.88rem" }}>
                    Follow the account opening guide (click the bookie card in the kanban) for full day-by-day steps.
                  </p>
                </div>
              )}
            </div>
            {focusStage === 2 && (
              <div
                style={{
                  marginTop: "0.85rem",
                  padding: "0.85rem 1rem",
                  background: CARD,
                  border: `0.5px solid ${BORDER}`,
                  borderRadius: 10,
                  borderLeft: `3px solid ${GOLD}`,
                  color: TEXT,
                  fontSize: "0.88rem",
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: GOLD }}>Reminder:</strong> Download the {isCoral ? "Coral" : focus.name} app on your phone today — open it
                once, browse briefly, close it. Signals normal behaviour from day 1.
              </div>
            )}

            {upcomingSorted.length >= 1 && (
              <div style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowAllUpcoming((v) => !v)}
                  style={{ fontSize: "0.85rem" }}
                >
                  {showAllUpcoming ? "Hide all upcoming" : "View all upcoming"}
                </button>
                {showAllUpcoming && (
                  <div
                    style={{
                      marginTop: "0.65rem",
                      padding: "0.85rem 1rem",
                      background: BG,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 10,
                      display: "grid",
                      gap: "0.75rem",
                    }}
                  >
                    <div style={{ color: MUTED, fontSize: "0.78rem", letterSpacing: "0.06em" }}>
                      All bookies in stages 2–4 (oldest stage date first)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", color: TEXT, fontSize: "0.88rem", lineHeight: 1.5 }}>
                      {upcomingSorted.map((b) => {
                        const lines = accountActionLines(b);
                        const day = stageDayOnly(b.stage_updated_at) ?? "—";
                        return (
                          <li key={b.id} style={{ marginBottom: "0.5rem" }}>
                            <strong style={{ color: GOLD }}>{b.name}</strong>
                            <span style={{ color: MUTED }}> · stage {queueStage(b)} · since {day}</span>
                            <div style={{ marginTop: "0.25rem", color: MUTED }}>
                              {lines.map((l, i) => (
                                <div key={i} style={{ color: l.overdue ? AMBER : MUTED }}>
                                  {l.text}
                                </div>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Section 2 */}
      <section>
        <h2
          className="heading"
          style={{
            margin: "0 0 0.75rem",
            color: GOLD,
            fontSize: "0.82rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Kanban pipeline
        </h2>
        <div
          style={{
            padding: "0.75rem 0.9rem",
            marginBottom: "1rem",
            background: "#2a2418",
            border: "0.5px solid #6b5420",
            borderRadius: 10,
            color: "#e8d4a8",
            fontSize: "0.82rem",
            lineHeight: 1.5,
          }}
        >
          ⚠ Max 2 new accounts per week · Space deposits across different days · Never claim offers same day as deposit · Never sign up to more than
          2 bookies in one day
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(140px, 1fr))",
            gap: "0.5rem",
            alignItems: "stretch",
            overflowX: "auto",
            paddingBottom: "0.35rem",
          }}
        >
          {KANBAN_COLUMNS.map((col) => (
            <div
              key={col.stage}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw = e.dataTransfer.getData("text/plain");
                const id = parseInt(raw, 10);
                if (!Number.isFinite(id)) return;
                void handleDropOnColumn(id, col.stage);
              }}
              style={{
                minHeight: 280,
                background: BG,
                border: `0.5px solid ${BORDER}`,
                borderRadius: 8,
                padding: "0.5rem",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
            >
              <h3
                className="heading"
                style={{
                  margin: "0 0 0.5rem",
                  fontSize: "0.72rem",
                  color: GOLD,
                  letterSpacing: "0.06em",
                  textAlign: "center",
                  lineHeight: 1.3,
                }}
              >
                {col.title}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                {pipeline
                  .filter((b) => queueStage(b) === col.stage)
                  .map((b) => {
                    const tier = getTierMeta(b.name);
                    const stage = queueStage(b);
                    const d = daysSinceStageUpdate(b.stage_updated_at);
                    const stageHint = cardStageHint(b);
                    const dayLabel = stageDayOnly(b.stage_updated_at);
                    return (
                      <div
                        key={b.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggingId(b.id);
                          e.dataTransfer.setData("text/plain", String(b.id));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            setGuideBookie(b);
                          }
                        }}
                        onClick={() => setGuideBookie(b)}
                        style={{
                          cursor: "grab",
                          background: CARD,
                          border: `0.5px solid ${BORDER}`,
                          borderRadius: 8,
                          borderLeft: tier ? `4px solid ${tier.border}` : `4px solid ${MUTED}`,
                          padding: "0.55rem 0.5rem",
                          opacity: draggingId === b.id ? 0.55 : 1,
                          transition: "opacity 0.15s ease, transform 0.12s ease",
                          transform: draggingId === b.id ? "scale(0.98)" : undefined,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: TEXT, fontSize: "0.88rem", marginBottom: "0.35rem" }}>{b.name}</div>
                        {tier ? (
                          <div
                            style={{
                              display: "inline-flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 1,
                              padding: "0.15rem 0.35rem",
                              borderRadius: 4,
                              fontSize: "0.62rem",
                              lineHeight: 1.15,
                              background: tier.bg,
                              color: tier.fg,
                              border: `1px solid ${tier.border}`,
                              marginBottom: "0.35rem",
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>{tier.tierLabel}</span>
                            <span style={{ opacity: 0.95 }}>{tier.short}</span>
                          </div>
                        ) : (
                          <div style={{ color: MUTED, fontSize: "0.68rem", marginBottom: "0.35rem" }}>Tier —</div>
                        )}
                        <div style={{ color: MUTED, fontSize: "0.68rem", marginBottom: "0.35rem" }}>
                          {stage >= 2 && stage <= 4
                            ? dayLabel
                              ? `${d}d in stage · since ${dayLabel}`
                              : "Stage date — set by moving card"
                            : "Not in timed stage"}
                        </div>
                        <div
                          style={{
                            color: stage >= 2 && stage <= 4 && d >= 2 ? AMBER : MUTED,
                            fontSize: "0.7rem",
                            lineHeight: 1.35,
                          }}
                        >
                          {stageHint}
                        </div>
                        <div style={{ marginTop: "0.4rem", fontSize: "0.65rem", color: GOLD, opacity: 0.85 }}>
                          Drag to next column once you've completed this stage
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {profitModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => !profitSaving && setProfitModal(null)}
        >
          <div
            style={{
              background: CARD,
              border: `1px solid ${GOLD}`,
              borderRadius: 12,
              padding: "1.25rem",
              maxWidth: 380,
              width: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="heading" style={{ margin: "0 0 0.75rem", color: GOLD, fontSize: "1.1rem" }}>
              Welcome profit — {profitModal.name}
            </h3>
            <p style={{ margin: "0 0 0.75rem", color: MUTED, fontSize: "0.88rem", lineHeight: 1.45 }}>
              Enter the profit from this welcome offer. The bookie will be marked as claimed and removed from the queue.
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "1rem" }}>
              <span style={{ color: MUTED, fontSize: "0.8rem" }}>Profit (£)</span>
              <input
                autoFocus
                value={profitInput}
                onChange={(e) => setProfitInput(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 14.50"
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" disabled={profitSaving} onClick={() => void confirmProfit()}>
                {profitSaving ? "Saving…" : "Save & complete"}
              </button>
              <button type="button" className="secondary" disabled={profitSaving} onClick={() => setProfitModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {guideBookie && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => setGuideBookie(null)}
        >
          <div
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: "1.15rem 1.25rem",
              maxWidth: 520,
              width: "100%",
              maxHeight: "85vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="heading" style={{ margin: "0 0 0.25rem", color: GOLD, fontSize: "1.15rem" }}>
              Account opening guide
            </h3>
            <p style={{ margin: "0 0 1rem", color: MUTED, fontSize: "0.88rem" }}>{guideBookie.name}</p>

            {[
              { title: "DAY 1 — ACCOUNT CREATION", items: CHECKLIST_DAY1 },
              { title: "DAY 2 — DEPOSIT", items: CHECKLIST_DAY2 },
              { title: "DAY 3 — QUALIFYING BET", items: CHECKLIST_DAY3 },
              { title: "DAY 4 — FREE BET", items: CHECKLIST_DAY4 },
            ].map((block) => (
              <div key={block.title} style={{ marginBottom: "1.1rem" }}>
                <h4
                  className="heading"
                  style={{
                    margin: "0 0 0.5rem",
                    color: GOLD,
                    fontSize: "0.78rem",
                    letterSpacing: "0.1em",
                  }}
                >
                  {block.title}
                </h4>
                <ul style={{ margin: 0, paddingLeft: "1.1rem", color: TEXT, lineHeight: 1.55, fontSize: "0.88rem" }}>
                  {block.items.map((line) => (
                    <li key={line} style={{ marginBottom: "0.35rem" }}>
                      ☐ {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div
              style={{
                marginTop: "1rem",
                padding: "0.85rem",
                background: BG,
                border: `0.5px solid ${BORDER}`,
                borderRadius: 10,
              }}
            >
              <h4 className="heading" style={{ margin: "0 0 0.5rem", color: GOLD, fontSize: "0.85rem" }}>
                Ongoing tips
              </h4>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", color: MUTED, lineHeight: 1.5, fontSize: "0.82rem" }}>
                {ONGOING_TIPS.map((t) => (
                  <li key={t} style={{ color: TEXT, marginBottom: "0.3rem" }}>
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <button type="button" className="secondary" style={{ marginTop: "1rem" }} onClick={() => setGuideBookie(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
