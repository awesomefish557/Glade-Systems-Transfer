import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

const checklist = [
  { id: 'training', label: 'Training completed', icon: '🏋️' },
  { id: 'movement', label: 'Movement — 8k steps / skate / active', icon: '🚶' },
  { id: 'ate_well', label: 'Ate well — protein + stopped at 80%', icon: '🍽️' },
  { id: 'hydration', label: 'Hydration — 4 × 750ml bottles', icon: '💧' },
  { id: 'recovery', label: 'Recovery — 7+ hrs sleep', icon: '🌙' },
  { id: 'mobility', label: 'Mobility / stretch — 5–10 min', icon: '🧘' },
  { id: 'meditation', label: 'Meditated today', icon: '🪷' },
] as const;

type ChecklistId = (typeof checklist)[number]['id'];

const feelQuestions = [
  'Do I feel stronger?',
  'Am I standing straighter?',
  'Do my clothes fit better?',
  'Is my energy stable?',
  'Am I not obsessing over food?',
] as const;

const FEEL_KEYS = ['stronger', 'straighter', 'clothes', 'energy', 'food'] as const;
type FeelKey = (typeof FEEL_KEYS)[number];

type DowId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type GuideRow = { id: DowId; label: string; focus: string };

const GUIDE_SCHEDULE_KEY = 'fitness_guide_schedule';
const GUIDE_RULES_KEY = 'fitness_guide_rules';

/** Monday = former Day 1 … Sunday = rest. Order is display order (Mon → Sun). */
const DEFAULT_GUIDE_SCHEDULE: GuideRow[] = [
  { id: 'mon', label: 'Monday', focus: 'Lower — Strength' },
  { id: 'tue', label: 'Tuesday', focus: 'Upper Push + optional skate' },
  { id: 'wed', label: 'Wednesday', focus: 'Yoga / Mobility' },
  { id: 'thu', label: 'Thursday', focus: 'Lower — Glutes' },
  { id: 'fri', label: 'Friday', focus: 'Upper Pull' },
  { id: 'sat', label: 'Saturday', focus: 'Run + Skate' },
  { id: 'sun', label: 'Sunday', focus: 'Rest' },
];

const DOW_ID_BY_JS_DAY: DowId[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type GuideRules = { food: string; recovery: string; movement: string };

const DEFAULT_GUIDE_RULES: GuideRules = {
  food: 'Protein every meal, stop at ~80% full, whole foods first, don\'t over-restrict.',
  recovery: '7–9 hrs sleep, light stretch most days, don\'t skip the rest day.',
  movement: '8k–12k steps, or skate, or another active recovery you enjoy.',
};

function loadGuideSchedule(): GuideRow[] {
  try {
    const raw = localStorage.getItem(GUIDE_SCHEDULE_KEY);
    if (!raw) return DEFAULT_GUIDE_SCHEDULE.map((r) => ({ ...r }));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_GUIDE_SCHEDULE.map((r) => ({ ...r }));
    const byId = new Map<DowId, GuideRow>();
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const id = o.id;
      if (
        typeof id === 'string' &&
        DEFAULT_GUIDE_SCHEDULE.some((d) => d.id === id) &&
        typeof o.label === 'string' &&
        typeof o.focus === 'string'
      ) {
        byId.set(id as DowId, { id: id as DowId, label: o.label, focus: o.focus });
      }
    }
    return DEFAULT_GUIDE_SCHEDULE.map((d) => byId.get(d.id) ?? { ...d });
  } catch {
    return DEFAULT_GUIDE_SCHEDULE.map((r) => ({ ...r }));
  }
}

function loadGuideRules(): GuideRules {
  try {
    const raw = localStorage.getItem(GUIDE_RULES_KEY);
    if (!raw) return { ...DEFAULT_GUIDE_RULES };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      food: typeof o.food === 'string' ? o.food : DEFAULT_GUIDE_RULES.food,
      recovery: typeof o.recovery === 'string' ? o.recovery : DEFAULT_GUIDE_RULES.recovery,
      movement: typeof o.movement === 'string' ? o.movement : DEFAULT_GUIDE_RULES.movement,
    };
  } catch {
    return { ...DEFAULT_GUIDE_RULES };
  }
}

function dowIdFromDate(d: Date): DowId {
  return DOW_ID_BY_JS_DAY[d.getDay()];
}

function guideRowForDate(rows: GuideRow[], d: Date): GuideRow | undefined {
  return rows.find((r) => r.id === dowIdFromDate(d));
}

type TabId = 'today' | 'week' | 'guide' | 'progress';

type DailyEntry = {
  checklist: Record<ChecklistId, boolean>;
  feel: Record<FeelKey, -1 | 0 | 1 | null>;
  notes: string;
  score: number;
  feelScore: number;
  timestamp: number;
};

type BodyByDate = Record<string, { weight?: number; waist?: number }>;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysKey(key: string, delta: number): string {
  const [yy, mm, dd] = key.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() + delta);
  return localDateKey(d);
}

function emptyFeel(): Record<FeelKey, -1 | 0 | 1 | null> {
  return {
    stronger: null,
    straighter: null,
    clothes: null,
    energy: null,
    food: null,
  };
}

function defaultEntry(): DailyEntry {
  const c = {} as Record<ChecklistId, boolean>;
  for (const row of checklist) c[row.id] = false;
  return {
    checklist: c,
    feel: emptyFeel(),
    notes: '',
    score: 0,
    feelScore: 0,
    timestamp: Date.now(),
  };
}

function parseEntry(raw: string | null): DailyEntry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<DailyEntry>;
    const base = defaultEntry();
    if (o.checklist && typeof o.checklist === 'object') {
      for (const row of checklist) {
        if (typeof o.checklist[row.id] === 'boolean') base.checklist[row.id] = o.checklist[row.id];
      }
    }
    if (o.feel && typeof o.feel === 'object') {
      for (const k of FEEL_KEYS) {
        const v = o.feel[k];
        if (v === -1 || v === 0 || v === 1 || v === null) base.feel[k] = v;
      }
    }
    if (typeof o.notes === 'string') base.notes = o.notes;
    if (typeof o.timestamp === 'number') base.timestamp = o.timestamp;
    return recomputeScores(base);
  } catch {
    return null;
  }
}

function recomputeScores(e: DailyEntry): DailyEntry {
  const score = checklist.reduce((n, row) => n + (e.checklist[row.id] ? 1 : 0), 0);
  let feelScore = 0;
  for (const k of FEEL_KEYS) {
    const v = e.feel[k];
    if (v !== null) feelScore += v;
  }
  return { ...e, score, feelScore };
}

function playTick() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  const buf = ac.createBuffer(1, ac.sampleRate * 0.12, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / ac.sampleRate;
    const env = Math.exp(-t * 35);
    d[i] =
      env *
      (Math.sin(2 * Math.PI * 120 * t) * 0.5 +
        Math.sin(2 * Math.PI * 80 * t) * 0.3 +
        (Math.random() * 2 - 1) * 0.15);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  const gain = ac.createGain();
  gain.gain.value = 0.3;
  src.connect(lp);
  lp.connect(gain);
  gain.connect(ac.destination);
  src.start();
  src.onended = () => void ac.close();
}

function playPageTurn() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  const v = Math.floor(Math.random() * 3);
  const dur = 0.18 + v * 0.03;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / ac.sampleRate;
    const env = Math.pow(1 - t / dur, 2.5) * Math.min(t * 80, 1);
    const swish = Math.sin(2 * Math.PI * (400 - t * 800) * t) * 0.3;
    d[i] = env * ((Math.random() * 2 - 1) * 0.7 + swish);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 6000;
  const gain = ac.createGain();
  gain.gain.value = 0.22;
  src.connect(hp);
  hp.connect(lp);
  lp.connect(gain);
  gain.connect(ac.destination);
  src.start();
  src.onended = () => void ac.close();
}

/** Landing page night sky — blobs, moon, stars (no title canvas). */
function NightSkyLandingCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    type BlobState = {
      x: number;
      y: number;
      r: number;
      dx: number;
      dy: number;
      hue: number;
      op: number;
      pulse: number;
      pulseSpeed: number;
    };
    type StarState = {
      x: number;
      y: number;
      r: number;
      b: number;
      ph: number;
      sp: number;
      sh: number;
    };

    let blobs: BlobState[] = [];
    let stars: StarState[] = [];

    const rebuildBlobs = () => {
      blobs = Array.from({ length: 5 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 200 + Math.random() * 300,
        dx: (Math.random() - 0.5) * 0.15,
        dy: (Math.random() - 0.5) * 0.15,
        hue: 128 + Math.random() * 20,
        op: 0.04 + Math.random() * 0.06,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.002 + Math.random() * 0.004,
      }));
    };

    const rebuildStars = () => {
      stars = Array.from({ length: 180 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.2,
        b: Math.random() * 0.5 + 0.2,
        ph: Math.random() * Math.PI * 2,
        sp: Math.random() < 0.1 ? 0.015 + Math.random() * 0.02 : 0.003 + Math.random() * 0.006,
        sh: Math.random() < 0.1 ? 0.2 + Math.random() * 0.3 : 0.05 + Math.random() * 0.1,
      }));
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      rebuildBlobs();
      rebuildStars();
    };
    resize();
    window.addEventListener('resize', resize);

    let t = 0;
    let raf = 0;
    const draw = () => {
      t += 0.016;
      ctx.fillStyle = '#050d06';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      blobs.forEach((b) => {
        b.pulse += b.pulseSpeed;
        b.x += b.dx;
        b.y += b.dy;
        if (b.x < -b.r) b.x = canvas.width + b.r;
        if (b.x > canvas.width + b.r) b.x = -b.r;
        if (b.y < -b.r) b.y = canvas.height + b.r;
        if (b.y > canvas.height + b.r) b.y = -b.r;
        const r = b.r + Math.sin(b.pulse) * 30;
        const op = b.op + Math.sin(b.pulse) * 0.02;
        const g2 = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        g2.addColorStop(0, `hsla(${b.hue},50%,12%,${op})`);
        g2.addColorStop(0.5, `hsla(${b.hue + 8},40%,8%,${op * 0.5})`);
        g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalAlpha = 0.45;
      const mg = ctx.createRadialGradient(canvas.width - 80, 55, 0, canvas.width - 80, 55, 60);
      mg.addColorStop(0, 'rgba(190,220,180,0.7)');
      mg.addColorStop(0.4, 'rgba(150,200,140,0.15)');
      mg.addColorStop(1, 'transparent');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(canvas.width - 80, 55, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = 'rgba(200,225,190,0.55)';
      ctx.beginPath();
      ctx.arc(canvas.width - 80, 55, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(5,13,6,0.9)';
      ctx.beginPath();
      ctx.arc(canvas.width - 88, 51, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      stars.forEach((s) => {
        const sh = s.b * (1 - s.sh + s.sh * (0.5 + 0.5 * Math.sin(t * s.sp * 60 + s.ph)));
        const spike = Math.sin(t * s.sp * 60 + s.ph) > 0.94;
        ctx.globalAlpha = sh;
        if (spike) {
          ctx.strokeStyle = 'rgba(200,230,195,0.3)';
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(s.x - s.r * 3, s.y);
          ctx.lineTo(s.x + s.r * 3, s.y);
          ctx.moveTo(s.x, s.y - s.r * 3);
          ctx.lineTo(s.x, s.y + s.r * 3);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(200,230,195,1)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, spike ? s.r * 1.4 : s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="fitness-night-canvas" aria-hidden />;
}

function GrassFooter() {
  const blades = useMemo(() => {
    const out: { d: string; thick: number; col: string }[] = [];
    for (let x = 0; x < 1400; x += 2 + Math.random() * 4) {
      const h = 8 + Math.random() * 22;
      const bend = (Math.random() - 0.5) * 14;
      const thick = 0.6 + Math.random() * 2.4;
      const col = Math.random() > 0.4 ? '#0a1a0d' : '#081508';
      const d = `M${x} 55 C${x + bend * 0.3} ${55 - h * 0.4} ${x + bend * 0.7} ${55 - h * 0.7} ${x + bend} ${55 - h}`;
      out.push({ d, thick, col });
    }
    return out;
  }, []);

  return (
    <svg
      className="fitness-grass"
      viewBox="0 0 1400 55"
      preserveAspectRatio="xMidYMax meet"
      style={{ height: 'min(64px, 12vh)' }}
      aria-hidden
    >
      <g strokeLinecap="round" fill="none">
        {blades.map((b, i) => (
          <path key={i} d={b.d} stroke={b.col} strokeWidth={b.thick} />
        ))}
      </g>
    </svg>
  );
}

function SvgRoughDefs() {
  return (
    <div style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
      <svg width="0" height="0">
        <defs>
          <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}

function WobblyCard({
  children,
  padding = '12px 14px',
  minHeight = 48,
  style,
}: {
  children: ReactNode;
  padding?: string;
  minHeight?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="wobbly-panel-shell"
      style={{
        position: 'relative',
        border: 'none',
        borderRadius: 0,
        boxShadow: 'none',
        minHeight,
        ...style,
      }}
    >
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        filter="url(#rough)"
        aria-hidden
      >
        <rect
          x="1"
          y="1"
          width="198"
          height="98"
          rx="1"
          ry="1"
          fill="rgba(18,35,22,0.75)"
          stroke="#2d4a35"
          strokeWidth="0.8"
          vectorEffect="nonScalingStroke"
        />
      </svg>
      <div style={{ position: 'relative', padding, zIndex: 1 }}>{children}</div>
    </div>
  );
}

function loadBodyMap(): BodyByDate {
  try {
    const r = localStorage.getItem('fitness_body');
    if (!r) return {};
    const o = JSON.parse(r) as BodyByDate;
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

function saveBodyMap(m: BodyByDate) {
  localStorage.setItem('fitness_body', JSON.stringify(m));
}

function getDayEntry(key: string): DailyEntry | null {
  return parseEntry(localStorage.getItem(`fitness_${key}`));
}

function lastNDaysKeys(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(x.getDate() - i);
    out.push(localDateKey(x));
  }
  return out;
}

function computeStreak(todayKey: string): number {
  let streak = 0;
  let k = todayKey;
  for (let i = 0; i < 400; i++) {
    const e = getDayEntry(k);
    if (!e || e.score < 4) break;
    streak++;
    k = addDaysKey(k, -1);
  }
  return streak;
}

function feelDotColor(feelScore: number): string {
  if (feelScore >= 2) return '#6dd4a0';
  if (feelScore <= -2) return '#a85c5c';
  return '#c9a227';
}

export default function App() {
  const todayKey = localDateKey(new Date());
  const [tab, setTab] = useState<TabId>('today');
  const [entry, setEntry] = useState<DailyEntry>(() => {
    const loaded = parseEntry(localStorage.getItem(`fitness_${todayKey}`));
    return loaded ?? defaultEntry();
  });
  const [bodyMap, setBodyMap] = useState<BodyByDate>(() => loadBodyMap());
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [guideSchedule, setGuideSchedule] = useState<GuideRow[]>(() => loadGuideSchedule());
  const [guideRules, setGuideRules] = useState<GuideRules>(() => loadGuideRules());

  useEffect(() => {
    localStorage.setItem(GUIDE_SCHEDULE_KEY, JSON.stringify(guideSchedule));
  }, [guideSchedule]);

  useEffect(() => {
    localStorage.setItem(GUIDE_RULES_KEY, JSON.stringify(guideRules));
  }, [guideRules]);

  const todaySession = useMemo(
    () => guideRowForDate(guideSchedule, new Date()),
    [guideSchedule, todayKey],
  );

  const patchGuideRow = (id: DowId, patch: Partial<Pick<GuideRow, 'label' | 'focus'>>) => {
    setGuideSchedule((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const resetGuideDefaults = () => {
    setGuideSchedule(DEFAULT_GUIDE_SCHEDULE.map((r) => ({ ...r })));
    setGuideRules({ ...DEFAULT_GUIDE_RULES });
  };

  const persist = useCallback(
    (e: DailyEntry) => {
      const next = recomputeScores({ ...e, timestamp: Date.now() });
      setEntry(next);
      localStorage.setItem(`fitness_${todayKey}`, JSON.stringify(next));
    },
    [todayKey],
  );

  useEffect(() => {
    const loaded = parseEntry(localStorage.getItem(`fitness_${todayKey}`));
    setEntry(loaded ? recomputeScores(loaded) : defaultEntry());
  }, [todayKey]);

  const streak = useMemo(() => computeStreak(todayKey), [todayKey, entry]);

  const yesterdayEntry = useMemo(() => getDayEntry(addDaysKey(todayKey, -1)), [todayKey, entry]);

  const feelDeclining =
    yesterdayEntry != null && entry.feelScore < yesterdayEntry.feelScore - 1;

  const statusCard = useMemo(() => {
    const s = entry.score;
    const f = entry.feelScore;
    if (s < 4 && f < 0) {
      return { emoji: '😞', label: 'Reset + Simplify', color: '#8b6b6b', sub: 'muted red' };
    }
    if (s < 4 || feelDeclining) {
      return { emoji: '😐', label: 'Adjust Habits', color: '#c9a227', sub: 'amber' };
    }
    if (s >= 4 && f >= 0) {
      return { emoji: '😄', label: 'On Track', color: '#6dd4a0', sub: 'green' };
    }
    return { emoji: '😐', label: 'Adjust Habits', color: '#c9a227', sub: 'amber' };
  }, [entry.score, entry.feelScore, feelDeclining]);

  const toggleCheck = (id: ChecklistId) => {
    const next = !entry.checklist[id];
    if (next) playTick();
    persist({ ...entry, checklist: { ...entry.checklist, [id]: next } });
  };

  const setFeel = (k: FeelKey, v: -1 | 0 | 1) => {
    persist({ ...entry, feel: { ...entry.feel, [k]: v } });
  };

  const weekKeys = useMemo(() => lastNDaysKeys(7), []);
  const prevWeekKeys = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setHours(12, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(d);
      x.setDate(x.getDate() - (6 - i));
      return localDateKey(x);
    });
  }, []);

  const weekStats = useMemo(() => {
    let sum = 0;
    let n = 0;
    let ge4 = 0;
    let feelSum = 0;
    for (const k of weekKeys) {
      const e = getDayEntry(k);
      if (e) {
        sum += e.score;
        feelSum += e.feelScore;
        n++;
        if (e.score >= 4) ge4++;
      }
    }
    const avgScore = n ? sum / n : 0;
    const pct = n ? Math.round((ge4 / n) * 100) : 0;
    const avgFeel = n ? feelSum / n : 0;

    let prevSum = 0;
    let prevN = 0;
    let prevFeel = 0;
    for (const k of prevWeekKeys) {
      const e = getDayEntry(k);
      if (e) {
        prevSum += e.score;
        prevFeel += e.feelScore;
        prevN++;
      }
    }
    const prevAvg = prevN ? prevSum / prevN : 0;
    const prevAvgFeel = prevN ? prevFeel / prevN : 0;
    let trend: 'improving' | 'flat' | 'declining' = 'flat';
    const delta = avgScore - prevAvg;
    const deltaF = avgFeel - prevAvgFeel;
    if (delta > 0.35 || deltaF > 0.4) trend = 'improving';
    else if (delta < -0.35 || deltaF < -0.4) trend = 'declining';

    return { avgScore, pct, avgFeel, trend, n };
  }, [weekKeys, prevWeekKeys, entry]);

  const todayWeight = bodyMap[todayKey]?.weight;
  const todayWaist = bodyMap[todayKey]?.waist;

  const setBodyField = (field: 'weight' | 'waist', raw: string) => {
    const num = parseFloat(raw);
    const next = { ...bodyMap };
    const cur = { ...next[todayKey] };
    if (raw === '' || Number.isNaN(num)) {
      delete cur[field];
    } else {
      cur[field] = num;
    }
    if (Object.keys(cur).length === 0) delete next[todayKey];
    else next[todayKey] = cur;
    setBodyMap(next);
    saveBodyMap(next);
  };

  const sparkWeeks = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    const points: { x: number; y: number | null }[] = [];
    for (let wi = 0; wi < 4; wi++) {
      const vals: number[] = [];
      for (let di = 0; di < 7; di++) {
        const off = wi * 7 + (6 - di);
        const x = new Date(d);
        x.setDate(x.getDate() - off);
        const k = localDateKey(x);
        const wv = bodyMap[k]?.weight;
        if (typeof wv === 'number') vals.push(wv);
      }
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      points.push({ x: wi, y: avg });
    }
    return points;
  }, [bodyMap]);

  const days30 = useMemo(() => lastNDaysKeys(30), []);

  const chartSeries = useMemo(() => {
    const scorePts: { x: number; y: number | null }[] = [];
    const feelPts: { x: number; y: number | null }[] = [];
    const wPts: { x: number; y: number | null }[] = [];
    const waistPts: { x: number; y: number | null }[] = [];
    days30.forEach((k, i) => {
      const e = getDayEntry(k);
      scorePts.push({ x: i, y: e?.score ?? null });
      feelPts.push({ x: i, y: e?.feelScore ?? null });
      wPts.push({ x: i, y: bodyMap[k]?.weight ?? null });
      waistPts.push({ x: i, y: bodyMap[k]?.waist ?? null });
    });
    return { scorePts, feelPts, wPts, waistPts };
  }, [days30, bodyMap, entry]);

  const changeTab = (t: TabId) => {
    if (t !== tab) playPageTurn();
    setTab(t);
  };

  return (
    <>
      <SvgRoughDefs />
      <NightSkyLandingCanvas />
      <GrassFooter />

      <div className="fitness-shell">
        <div
          style={{
            textAlign: 'center',
            padding: '16px 0 8px',
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(74,124,89,0.6)',
              fontFamily: 'Arial,sans-serif',
            }}
          >
            GLADE SYSTEMS
          </div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 600,
              color: 'rgba(180,210,170,0.7)',
              fontFamily: 'Georgia,serif',
              fontStyle: 'italic',
              letterSpacing: '0.05em',
            }}
          >
            Fitness
          </div>
        </div>

        <nav className="fitness-tab-row" aria-label="Fitness sections">
          {(
            [
              ['today', 'Today'],
              ['week', 'Week'],
              ['guide', 'Guide'],
              ['progress', 'Progress'],
            ] as const
          ).map(([id, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                className={`fitness-tab-btn ${active ? 'fitness-tab-btn--active' : ''}`}
                onClick={() => changeTab(id)}
              >
                {label}
                {active && (
                  <svg className="fitness-tab-underline" viewBox="0 0 72 10" aria-hidden>
                    <path
                      d="M4 7 Q20 3 36 7 T68 5"
                      fill="none"
                      stroke="#6dd4a0"
                      strokeWidth="0.75"
                      filter="url(#rough)"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </nav>

        <div className="fitness-scroll">
          {tab === 'today' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  marginBottom: 6,
                }}
              >
                <div className="fitness-section-label" style={{ margin: 0 }}>
                  Today&apos;s session
                </div>
                <span
                  style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: 14,
                    color: '#d4a853',
                    flexShrink: 0,
                  }}
                >
                  🔥 {streak} days
                </span>
              </div>
              <WobblyCard
                minHeight={64}
                style={{
                  marginBottom: 18,
                  boxShadow: '0 0 0 1px rgba(109, 212, 160, 0.28), 0 0 16px rgba(109, 212, 160, 0.1)',
                }}
              >
                {todaySession ? (
                  <>
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: '#5a9e6f',
                        fontFamily: 'Arial, sans-serif',
                        marginBottom: 6,
                      }}
                    >
                      {todaySession.label}
                    </div>
                    <div style={{ fontStyle: 'italic', color: '#cce8c0', fontSize: 16, lineHeight: 1.45 }}>
                      {todaySession.focus}
                    </div>
                  </>
                ) : (
                  <div style={{ fontStyle: 'italic', color: '#5a9e6f', fontSize: 13 }}>
                    Add this weekday in the Guide tab.
                  </div>
                )}
              </WobblyCard>

              <div className="fitness-section-label">Daily checklist</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {checklist.map((row) => (
                  <WobblyCard key={row.id} minHeight={56}>
                    <label className="fitness-check-row">
                      <input
                        type="checkbox"
                        checked={entry.checklist[row.id]}
                        onChange={() => toggleCheck(row.id)}
                      />
                      <span className={entry.checklist[row.id] ? 'fitness-check-done' : ''}>
                        <span style={{ marginRight: 8 }}>{row.icon}</span>
                        {row.label}
                      </span>
                    </label>
                  </WobblyCard>
                ))}
              </div>

              <div className="fitness-section-label">Progress</div>
              <WobblyCard minHeight={52}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, height: 14, background: 'rgba(5,12,6,0.6)', position: 'relative' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${(entry.score / checklist.length) * 100}%`,
                        background: 'linear-gradient(90deg, #4a7c59, #88c896)',
                        transition: 'width 0.25s ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'Georgia, serif',
                      fontWeight: 600,
                      color: '#d4a853',
                      fontSize: 15,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.score}/{checklist.length}
                  </span>
                </div>
              </WobblyCard>

              <div className="fitness-section-label">Feel check</div>
              {feelQuestions.map((q, idx) => {
                const fk = FEEL_KEYS[idx];
                const cur = entry.feel[fk];
                return (
                  <WobblyCard key={fk} minHeight={72} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, color: '#9abfa0', marginBottom: 8 }}>{q}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {([-1, 0, 1] as const).map((v) => {
                        const emoji = v === -1 ? '😞' : v === 0 ? '😐' : '😄';
                        const on = cur === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            className={`fitness-emoji-btn ${on ? 'fitness-emoji-btn--on' : ''}`}
                            onClick={() => setFeel(fk, v)}
                            aria-pressed={on}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>
                  </WobblyCard>
                );
              })}

              <div className="fitness-section-label">Today&apos;s status</div>
              <WobblyCard minHeight={64}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 17 }}>
                  <span style={{ fontSize: 28 }}>{statusCard.emoji}</span>
                  <span style={{ color: statusCard.color, fontFamily: 'Georgia, serif', fontWeight: 600 }}>
                    {statusCard.label}
                  </span>
                </div>
              </WobblyCard>

              <div className="fitness-section-label">Notes</div>
              <WobblyCard minHeight={100}>
                <textarea
                  className="fitness-notes"
                  placeholder="daily reflection..."
                  value={entry.notes}
                  onChange={(e) => persist({ ...entry, notes: e.target.value })}
                />
              </WobblyCard>
            </div>
          )}

          {tab === 'week' && (
            <>
              <div className="fitness-section-label">Last 7 days</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {weekKeys.map((k) => {
                  const e = getDayEntry(k);
                  const d = new Date(k + 'T12:00:00');
                  const label = d.toLocaleDateString(undefined, { weekday: 'short' });
                  const score = e?.score ?? 0;
                  const fs = e?.feelScore ?? 0;
                  return (
                    <WobblyCard key={k} minHeight={56}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 40, fontSize: 12, color: '#5a9e6f' }}>{label}</span>
                        <div style={{ flex: 1, height: 8, background: 'rgba(5,12,6,0.6)' }}>
                          <div
                            style={{
                              width: `${(score / checklist.length) * 100}%`,
                              height: '100%',
                              background: '#6dd4a0',
                              opacity: e ? 1 : 0.25,
                            }}
                          />
                        </div>
                        <span
                          title="feel"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: e ? feelDotColor(fs) : '#2d4a35',
                            flexShrink: 0,
                          }}
                        />
                      </div>
                    </WobblyCard>
                  );
                })}
              </div>

              <div className="fitness-section-label">Summary</div>
              <WobblyCard minHeight={52}>
                <div style={{ fontSize: 13, fontStyle: 'italic', color: '#9abfa0', lineHeight: 1.6 }}>
                  <div>
                    Avg checklist score: {weekStats.n ? weekStats.avgScore.toFixed(1) : '—'} / {checklist.length}
                  </div>
                  <div>Consistency (score ≥ 4): {weekStats.n ? `${weekStats.pct}%` : '—'}</div>
                  <div>Avg feel score: {weekStats.n ? weekStats.avgFeel.toFixed(1) : '—'}</div>
                  <div style={{ marginTop: 6, color: '#88c896' }}>
                    Trend vs last week:{' '}
                    {weekStats.trend === 'improving' ? 'improving' : weekStats.trend === 'declining' ? 'declining' : 'flat'}
                  </div>
                </div>
              </WobblyCard>

              <button type="button" className="fitness-collapsible-h" onClick={() => setMetricsOpen((o) => !o)}>
                {metricsOpen ? '▼' : '▶'} Optional metrics
              </button>
              {metricsOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <WobblyCard minHeight={72}>
                    <div style={{ fontSize: 11, color: '#4a7c59', fontFamily: 'Arial,sans-serif', letterSpacing: '0.1em' }}>
                      WEIGHT (KG)
                    </div>
                    <input
                      className="fitness-metric-input"
                      type="number"
                      inputMode="decimal"
                      placeholder="—"
                      value={todayWeight ?? ''}
                      onChange={(e) => setBodyField('weight', e.target.value)}
                    />
                  </WobblyCard>
                  <WobblyCard minHeight={72}>
                    <div style={{ fontSize: 11, color: '#4a7c59', fontFamily: 'Arial,sans-serif', letterSpacing: '0.1em' }}>
                      WAIST (CM)
                    </div>
                    <input
                      className="fitness-metric-input"
                      type="number"
                      inputMode="decimal"
                      placeholder="—"
                      value={todayWaist ?? ''}
                      onChange={(e) => setBodyField('waist', e.target.value)}
                    />
                  </WobblyCard>
                  <WobblyCard minHeight={100}>
                    <div style={{ fontSize: 12, color: '#5a9e6f', fontStyle: 'italic', marginBottom: 8 }}>
                      Weight trend — last 4 weeks (weekly avg)
                    </div>
                    <MiniSparkline points={sparkWeeks} />
                  </WobblyCard>
                </div>
              )}
            </>
          )}

          {tab === 'guide' && (
            <>
              <div className="fitness-section-label">Weekly schedule</div>
              <p
                style={{
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: '#5a9e6f',
                  marginBottom: 10,
                  lineHeight: 1.45,
                }}
              >
                Edit any text below — it saves in this browser and powers the Today tab session line-up (by weekday).
                Your daily checklist is still separate each calendar day.
              </p>
              {guideSchedule.map((row) => {
                const isToday = row.id === dowIdFromDate(new Date());
                return (
                  <WobblyCard
                    key={row.id}
                    minHeight={120}
                    style={{
                      marginBottom: 10,
                      ...(isToday
                        ? {
                            boxShadow: '0 0 0 1px rgba(109, 212, 160, 0.35), 0 0 18px rgba(109, 212, 160, 0.12)',
                          }
                        : {}),
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 10,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: '#4a7c59',
                          fontFamily: 'Arial, sans-serif',
                          display: 'block',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        Day heading
                        <input
                          className="guide-edit-input"
                          value={row.label}
                          onChange={(e) => patchGuideRow(row.id, { label: e.target.value })}
                          aria-label={`${row.id} heading`}
                        />
                      </label>
                      {isToday ? (
                        <span
                          style={{
                            fontSize: 9,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: '#6dd4a0',
                            fontFamily: 'Arial, sans-serif',
                            flexShrink: 0,
                          }}
                        >
                          Today
                        </span>
                      ) : null}
                    </div>
                    <label
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: '#4a7c59',
                        fontFamily: 'Arial, sans-serif',
                        display: 'block',
                      }}
                    >
                      Focus / session notes
                      <textarea
                        className="guide-edit-textarea"
                        value={row.focus}
                        onChange={(e) => patchGuideRow(row.id, { focus: e.target.value })}
                        rows={3}
                        aria-label={`${row.label} focus`}
                      />
                    </label>
                  </WobblyCard>
                );
              })}
              <div className="fitness-section-label">Rules</div>
              <WobblyCard minHeight={100} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 15, marginBottom: 6 }}>🍽️ Food rules</div>
                <textarea
                  className="guide-edit-textarea"
                  style={{ minHeight: 72 }}
                  value={guideRules.food}
                  onChange={(e) => setGuideRules((r) => ({ ...r, food: e.target.value }))}
                  rows={4}
                  aria-label="Food rules"
                />
              </WobblyCard>
              <WobblyCard minHeight={100} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 15, marginBottom: 6 }}>🌙 Recovery rules</div>
                <textarea
                  className="guide-edit-textarea"
                  style={{ minHeight: 72 }}
                  value={guideRules.recovery}
                  onChange={(e) => setGuideRules((r) => ({ ...r, recovery: e.target.value }))}
                  rows={4}
                  aria-label="Recovery rules"
                />
              </WobblyCard>
              <WobblyCard minHeight={100} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 15, marginBottom: 6 }}>🚶 Movement rule</div>
                <textarea
                  className="guide-edit-textarea"
                  style={{ minHeight: 72 }}
                  value={guideRules.movement}
                  onChange={(e) => setGuideRules((r) => ({ ...r, movement: e.target.value }))}
                  rows={4}
                  aria-label="Movement rule"
                />
              </WobblyCard>
              <button type="button" className="guide-reset-btn" onClick={resetGuideDefaults}>
                Reset guide to defaults
              </button>
            </>
          )}

          {tab === 'progress' && (
            <>
              <div className="fitness-section-label">Checklist score (30 days)</div>
              <WobblyCard minHeight={140}>
                <SvgLineChart points={chartSeries.scorePts} yLabel={`0–${checklist.length}`} color="#88c896" />
              </WobblyCard>
              <div className="fitness-section-label">Feel score (30 days)</div>
              <WobblyCard minHeight={140}>
                <SvgLineChart points={chartSeries.feelPts} yLabel="sum" color="#7eb88a" />
              </WobblyCard>
              <div className="fitness-section-label">Weight (30 days)</div>
              <WobblyCard minHeight={140}>
                <SvgLineChart points={chartSeries.wPts} yLabel="kg" color="#9bc9a8" />
              </WobblyCard>
              <div className="fitness-section-label">Waist (30 days)</div>
              <WobblyCard minHeight={140}>
                <SvgLineChart points={chartSeries.waistPts} yLabel="cm" color="#8ab89a" />
              </WobblyCard>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MiniSparkline({ points }: { points: { x: number; y: number | null }[] }) {
  const valid = points.filter((p): p is { x: number; y: number } => p.y !== null);
  if (valid.length < 2) {
    return <div style={{ fontSize: 12, color: '#4a7c59', fontStyle: 'italic' }}>Log weight on more days to see a trend.</div>;
  }
  const ys = valid.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = 280;
  const h = 48;
  const pad = 6;
  const toX = (x: number) => pad + (x / Math.max(1, points.length - 1)) * (w - pad * 2);
  const toY = (y: number) =>
    pad + (h - pad * 2) - ((y - minY) / (maxY - minY || 1)) * (h - pad * 2);
  let d = '';
  let prev: { x: number; y: number } | null = null;
  for (const p of points) {
    if (p.y === null) {
      prev = null;
      continue;
    }
    const x = toX(p.x);
    const y = toY(p.y);
    d += prev ? ` L ${x} ${y}` : `M ${x} ${y}`;
    prev = { x: p.x, y: p.y };
  }
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke="#88c896" strokeWidth="1.2" opacity="0.9" />
      {valid.map((p) => (
        <circle key={p.x} cx={toX(p.x)} cy={toY(p.y)} r="2.5" fill="#cce8c0" opacity="0.85" />
      ))}
    </svg>
  );
}

function SvgLineChart({
  points,
  yLabel,
  color,
}: {
  points: { x: number; y: number | null }[];
  yLabel: string;
  color: string;
}) {
  const valid = points.filter((p): p is { x: number; y: number } => p.y !== null);
  if (valid.length < 2) {
    return (
      <div style={{ fontSize: 12, color: '#4a7c59', fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>Not enough data yet.</div>
    );
  }
  const ys = valid.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = 320;
  const h = 110;
  const padL = 28;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const toX = (i: number) => padL + (i / (points.length - 1 || 1)) * innerW;
  const toY = (y: number) => padT + innerH - ((y - minY) / (maxY - minY || 1)) * innerH;
  let d = '';
  let prevPt: { x: number; y: number } | null = null;
  for (const p of points) {
    if (p.y === null) {
      prevPt = null;
      continue;
    }
    const x = toX(p.x);
    const y = toY(p.y);
    d += prevPt ? ` L ${x} ${y}` : `M ${x} ${y}`;
    prevPt = { x: p.x, y: p.y };
  }
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <line
        x1={padL}
        y1={padT + innerH}
        x2={w - padR}
        y2={padT + innerH}
        stroke="rgba(74,124,89,0.35)"
        strokeWidth="0.6"
      />
      <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="rgba(74,124,89,0.25)" strokeWidth="0.6" />
      <text x={4} y={padT + innerH / 2} fill="rgba(90,130,100,0.65)" fontSize="9" fontFamily="Georgia, serif">
        {yLabel}
      </text>
      <text x={padL} y={h - 4} fill="rgba(90,130,100,0.55)" fontSize="8" fontFamily="Georgia, serif">
        older
      </text>
      <text x={w - 36} y={h - 4} fill="rgba(90,130,100,0.55)" fontSize="8" fontFamily="Georgia, serif">
        today
      </text>
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" opacity="0.92" />
    </svg>
  );
}
