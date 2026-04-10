import { useSeerSettings } from "../settingsContext";
import type { PreferredPlatform } from "../settingsContext";

const PLATFORMS: PreferredPlatform[] = ["betfair", "matchbook", "smarkets"];

export default function SettingsPanel({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { settings, setSettings } = useSeerSettings();

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal modal--settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="settings-title">Settings</h3>
        <p className="settings-intro muted">
          Stored in this browser only (localStorage). Used for stake sizing, filters, and defaults.
        </p>
        <div className="settings-grid">
          <label className="settings-field">
            Bankroll (£)
            <input
              type="number"
              min={1}
              step={1}
              value={settings.bankroll}
              onChange={(e) =>
                setSettings({ bankroll: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label className="settings-field">
            Default stake (£)
            <input
              type="number"
              min={1}
              step={1}
              value={settings.defaultStake}
              onChange={(e) =>
                setSettings({ defaultStake: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label className="settings-field">
            Preferred platform
            <select
              value={settings.preferredPlatform}
              onChange={(e) =>
                setSettings({ preferredPlatform: e.target.value as PreferredPlatform })
              }
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field settings-field--row">
            <input
              type="checkbox"
              checked={settings.showPolitics}
              onChange={(e) => setSettings({ showPolitics: e.target.checked })}
            />
            <span>Show politics markets in opportunities</span>
          </label>
          <label className="settings-field">
            Min AER filter (%)
            <input
              type="number"
              min={0}
              max={200}
              step={1}
              value={settings.minAerPercent}
              onChange={(e) =>
                setSettings({ minAerPercent: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label className="settings-field">
            Max days filter
            <input
              type="number"
              min={1}
              max={9999}
              step={1}
              value={settings.maxDays}
              onChange={(e) =>
                setSettings({ maxDays: Math.max(1, Number(e.target.value) || 90) })
              }
            />
            <span className="settings-hint">Use 9999 for no cap</span>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
