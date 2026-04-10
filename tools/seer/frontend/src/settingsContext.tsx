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

export type PreferredPlatform = "betfair" | "matchbook" | "smarkets";

export type SeerSettings = {
  bankroll: number;
  minAerPercent: number;
  maxDays: number;
  defaultBetMode: TradeMode;
  notifyMorning: string;
  notifyAfternoon: string;
  defaultStake: number;
  preferredPlatform: PreferredPlatform;
  /** When false, politics-style markets are hidden in opportunities (default). */
  showPolitics: boolean;
};

export const defaultSeerSettings: SeerSettings = {
  bankroll: 1000,
  minAerPercent: 15,
  maxDays: 90,
  defaultBetMode: "paper",
  notifyMorning: "08:30",
  notifyAfternoon: "16:45",
  defaultStake: 10,
  preferredPlatform: "betfair",
  showPolitics: false
};

function loadSettings(): SeerSettings {
  if (typeof window === "undefined") return defaultSeerSettings;
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return defaultSeerSettings;
    const o = JSON.parse(raw) as Partial<SeerSettings>;
    const merged = { ...defaultSeerSettings, ...o };
    if (
      merged.preferredPlatform !== "betfair" &&
      merged.preferredPlatform !== "matchbook" &&
      merged.preferredPlatform !== "smarkets"
    ) {
      merged.preferredPlatform = defaultSeerSettings.preferredPlatform;
    }
    return merged;
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
