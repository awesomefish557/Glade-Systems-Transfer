import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { TradeMode } from "./types";

const STORAGE = "seer-settings-v1";

export type SeerSettings = {
  bankroll: number;
  minAerPercent: number;
  maxDays: number;
  defaultBetMode: TradeMode;
  notifyMorning: string;
  notifyAfternoon: string;
};

export const defaultSeerSettings: SeerSettings = {
  bankroll: 200,
  minAerPercent: 5,
  maxDays: 365,
  defaultBetMode: "paper",
  notifyMorning: "08:30",
  notifyAfternoon: "16:45"
};

function loadSettings(): SeerSettings {
  if (typeof window === "undefined") return defaultSeerSettings;
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return defaultSeerSettings;
    const o = JSON.parse(raw) as Partial<SeerSettings>;
    return { ...defaultSeerSettings, ...o };
  } catch {
    return defaultSeerSettings;
  }
}

export function initialTradeModeFromStorage(): TradeMode {
  const s = loadSettings();
  return s.defaultBetMode === "live" ? "live" : "paper";
}

type Ctx = {
  settings: SeerSettings;
  setSettings: (patch: Partial<SeerSettings>) => void;
};

const SeerSettingsContext = createContext<Ctx | null>(null);

export function SeerSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setS] = useState<SeerSettings>(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const setSettings = useCallback((patch: Partial<SeerSettings>) => {
    setS((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ settings, setSettings }),
    [settings, setSettings]
  );

  return (
    <SeerSettingsContext.Provider value={value}>
      {children}
    </SeerSettingsContext.Provider>
  );
}

export function useSeerSettings(): Ctx {
  const c = useContext(SeerSettingsContext);
  if (!c) throw new Error("useSeerSettings must be used within SeerSettingsProvider");
  return c;
}
