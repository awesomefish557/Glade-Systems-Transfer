import { useCallback, useEffect, useRef, useState } from "react";
import { createMapApi, deleteMapApi, fetchMaps, updateMapApi } from "../api";
import type { GraphNodeType, PinboardMap } from "../types";
import { MapTypesEditorModal } from "./MapTypesEditorModal";
import { WobblyPanel } from "./WobblyPanel";

const DEFAULT_GOLD = "#d4a853";

export const MAP_COLOR_PRESETS = [
  { label: "Gold", hex: "#d4a853" },
  { label: "Teal", hex: "#2a9d8f" },
  { label: "Purple", hex: "#7b68a8" },
  { label: "Sage", hex: "#87a878" },
  { label: "Terracotta", hex: "#c67b5c" },
  { label: "Red", hex: "#c94c4c" },
] as const;

function colorShowsDot(hex: string | null | undefined): boolean {
  return (hex ?? DEFAULT_GOLD).trim().toLowerCase() !== DEFAULT_GOLD.toLowerCase();
}

export function MapSelector({
  mapId,
  onMapIdChange,
  nodeTypes,
  onNodeTypesChange,
}: {
  mapId: string;
  onMapIdChange: (id: string) => void;
  nodeTypes: GraphNodeType[];
  onNodeTypesChange: (types: GraphNodeType[]) => void;
}) {
  const [maps, setMaps] = useState<PinboardMap[]>([]);
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PinboardMap | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_GOLD);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [renameColor, setRenameColor] = useState(DEFAULT_GOLD);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ map: PinboardMap; x: number; y: number } | null>(null);
  const [deleteConfirmMap, setDeleteConfirmMap] = useState<PinboardMap | null>(null);
  const [typesEditorOpen, setTypesEditorOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshMaps = useCallback(async () => {
    try {
      const list = await fetchMaps();
      setMaps(list);
    } catch {
      setMaps([]);
    }
  }, []);

  useEffect(() => {
    void refreshMaps();
  }, [refreshMaps]);

  useEffect(() => {
    if (!open && !menu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (shellRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      if (t.closest?.("[data-pinboard-delete-map-modal]")) return;
      setOpen(false);
      setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, menu]);

  const current = maps.find((m) => m.id === mapId);
  const displayName = current?.name ?? (mapId === "default" ? "Architecture Map" : mapId);

  const openNewModal = () => {
    setErr(null);
    setNewName("");
    setNewDesc("");
    setNewColor(DEFAULT_GOLD);
    setNewOpen(true);
    setOpen(false);
    setMenu(null);
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const m = await createMapApi({
        name,
        description: newDesc.trim() || undefined,
        color: newColor,
      });
      await refreshMaps();
      onMapIdChange(m.id);
      setNewOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openRename = (m: PinboardMap) => {
    setRenameTarget(m);
    setRenameName(m.name);
    setRenameDesc(m.description ?? "");
    setRenameColor(m.color?.trim() || DEFAULT_GOLD);
    setMenu(null);
    setOpen(false);
    setErr(null);
  };

  const submitRename = async () => {
    if (!renameTarget || busy) return;
    const name = renameName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      await updateMapApi(renameTarget.id, {
        name,
        description: renameDesc.trim() || null,
        color: renameColor,
      });
      await refreshMaps();
      setRenameTarget(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteMap = (m: PinboardMap) => {
    if (m.id === "default") return;
    setErr(null);
    setMenu(null);
    setOpen(false);
    setDeleteConfirmMap(m);
  };

  const confirmDeleteMap = async () => {
    const m = deleteConfirmMap;
    if (!m || m.id === "default" || busy) return;
    setBusy(true);
    try {
      await deleteMapApi(m.id);
      await refreshMaps();
      setErr(null);
      setDeleteConfirmMap(null);
      setOpen(false);
      if (mapId === m.id) onMapIdChange("default");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        ref={shellRef}
        style={{
          position: "fixed",
          top: 8,
          left: 14,
          zIndex: 200,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setMenu(null);
            void refreshMaps();
          }}
          disabled={busy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "rgba(8, 18, 10, 0.94)",
            border: "1px solid rgba(45, 74, 53, 0.65)",
            borderRadius: 0,
            cursor: "pointer",
            color: "#cce8c0",
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          }}
        >
          {colorShowsDot(current?.color) ? (
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: current?.color ?? DEFAULT_GOLD,
                flexShrink: 0,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              }}
            />
          ) : null}
          <span
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 16,
              color: "#e8f0e4",
              letterSpacing: "0.02em",
            }}
          >
            {displayName}
          </span>
          <span style={{ color: DEFAULT_GOLD, fontSize: 12, lineHeight: 1 }} aria-hidden>
            ▾
          </span>
        </button>

        {open ? (
          <div style={{ marginTop: 6, minWidth: 260, maxWidth: "min(92vw, 340px)" }}>
            <WobblyPanel padding="10px 12px" minHeight={0} panelFill="rgba(12, 22, 14, 0.96)">
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "min(55vh, 360px)", overflowY: "auto" }}>
                {maps.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (mapId !== m.id) onMapIdChange(m.id);
                        setOpen(false);
                        setMenu(null);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 10px",
                        marginBottom: 4,
                        border:
                          m.id === mapId ? `1px solid ${DEFAULT_GOLD}` : "1px solid rgba(45, 74, 53, 0.45)",
                        background:
                          m.id === mapId ? "rgba(212, 168, 83, 0.18)" : "rgba(6, 14, 8, 0.5)",
                        color: "#cce8c0",
                        cursor: "pointer",
                        fontFamily: "system-ui, sans-serif",
                        fontSize: 13,
                      }}
                    >
                      <div
                        role="presentation"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenu({ map: m, x: e.clientX, y: e.clientY });
                        }}
                        style={{
                          fontFamily: "Georgia, serif",
                          fontSize: 15,
                          color: m.id === mapId ? DEFAULT_GOLD : "#e0e8dc",
                          cursor: "context-menu",
                        }}
                        title="Right-click for rename or delete"
                      >
                        {m.name}
                      </div>
                      {m.description ? (
                        <div style={{ fontSize: 11, color: "#7a9a7a", marginTop: 4, lineHeight: 1.35 }}>{m.description}</div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="pinboard-btn"
                style={{ width: "100%", marginTop: 8 }}
                onClick={() => {
                  setTypesEditorOpen(true);
                  setOpen(false);
                  setMenu(null);
                }}
              >
                ⚙ Edit types
              </button>
              <button
                type="button"
                className="pinboard-btn pinboard-btn--active"
                style={{ width: "100%", marginTop: 8 }}
                onClick={openNewModal}
              >
                ＋ New Map
              </button>
            </WobblyPanel>
          </div>
        ) : null}
      </div>

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            zIndex: 210,
            background: "rgba(10, 20, 12, 0.98)",
            border: "1px solid rgba(212, 168, 83, 0.4)",
            minWidth: 140,
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
          }}
        >
          <button
            type="button"
            className="pinboard-btn"
            style={{ width: "100%", border: "none", borderRadius: 0 }}
            onClick={() => openRename(menu.map)}
          >
            Rename
          </button>
          <button
            type="button"
            className="pinboard-btn"
            style={{
              width: "100%",
              border: "none",
              borderRadius: 0,
              borderTop: "1px solid rgba(45,74,53,0.5)",
              color: menu.map.id === "default" ? "#666" : "#daa",
            }}
            disabled={menu.map.id === "default"}
            onClick={() => requestDeleteMap(menu.map)}
          >
            Delete
          </button>
        </div>
      ) : null}

      {menu ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenu(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 205,
            background: "transparent",
            border: "none",
            cursor: "default",
          }}
        />
      ) : null}

      {newOpen ? (
        <div
          className="pinboard-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 220,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewOpen(false);
          }}
        >
          <WobblyPanel padding="16px 18px" minHeight={0} panelFill="rgba(12, 22, 14, 0.97)" style={{ width: "min(100%, 360px)" }}>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: 17, color: DEFAULT_GOLD, margin: "0 0 12px" }}>New map</h2>
            {err ? <p style={{ color: "#c88", fontSize: 12, marginBottom: 8 }}>{err}</p> : null}
            <label className="pinboard-ui-label" style={{ display: "block", marginBottom: 8, fontSize: 11 }}>
              Name
              <input
                className="pinboard-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Required"
                style={{ width: "100%", marginTop: 4 }}
                autoFocus
              />
            </label>
            <label className="pinboard-ui-label" style={{ display: "block", marginBottom: 10, fontSize: 11 }}>
              Description
              <textarea
                className="pinboard-input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional"
                rows={2}
                style={{ width: "100%", marginTop: 4, resize: "vertical" }}
              />
            </label>
            <div className="pinboard-ui-label" style={{ fontSize: 11, marginBottom: 6 }}>
              Color
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {MAP_COLOR_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.label}
                  onClick={() => setNewColor(p.hex)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: p.hex,
                    border: newColor === p.hex ? `2px solid ${DEFAULT_GOLD}` : "2px solid rgba(0,0,0,0.35)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="pinboard-btn" onClick={() => setNewOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="pinboard-btn pinboard-btn--active" onClick={() => void submitNew()} disabled={busy || !newName.trim()}>
                Create
              </button>
            </div>
          </WobblyPanel>
        </div>
      ) : null}

      {deleteConfirmMap ? (
        <div
          data-pinboard-delete-map-modal
          className="pinboard-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 225,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDeleteConfirmMap(null);
          }}
        >
          <WobblyPanel padding="18px 20px" minHeight={0} panelFill="rgba(12, 22, 14, 0.98)" style={{ width: "min(100%, 400px)" }}>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: 18, color: DEFAULT_GOLD, margin: "0 0 10px" }}>Delete map?</h2>
            <p style={{ fontSize: 14, color: "#c8dcc8", lineHeight: 1.5, margin: "0 0 8px" }}>
              Delete <strong style={{ color: "#e8f0e4" }}>{deleteConfirmMap.name}</strong> and{" "}
              <strong style={{ color: "#e8a0a0" }}>all of its nodes</strong>? This cannot be undone.
            </p>
            {err ? <p style={{ color: "#c88", fontSize: 12, marginBottom: 8 }}>{err}</p> : null}
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="pinboard-btn"
                disabled={busy}
                onClick={() => {
                  setErr(null);
                  setDeleteConfirmMap(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pinboard-btn"
                style={{ borderColor: "#a04444", color: "#fcc" }}
                disabled={busy}
                onClick={() => void confirmDeleteMap()}
              >
                {busy ? "…" : "Delete map"}
              </button>
            </div>
          </WobblyPanel>
        </div>
      ) : null}

      <MapTypesEditorModal
        open={typesEditorOpen}
        mapId={mapId}
        nodeTypes={nodeTypes}
        onClose={() => setTypesEditorOpen(false)}
        onTypesUpdated={onNodeTypesChange}
      />

      {renameTarget ? (
        <div
          className="pinboard-modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 220,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameTarget(null);
          }}
        >
          <WobblyPanel padding="16px 18px" minHeight={0} panelFill="rgba(12, 22, 14, 0.97)" style={{ width: "min(100%, 360px)" }}>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: 17, color: DEFAULT_GOLD, margin: "0 0 12px" }}>Rename map</h2>
            {err ? <p style={{ color: "#c88", fontSize: 12, marginBottom: 8 }}>{err}</p> : null}
            <label className="pinboard-ui-label" style={{ display: "block", marginBottom: 8, fontSize: 11 }}>
              Name
              <input
                className="pinboard-input"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <label className="pinboard-ui-label" style={{ display: "block", marginBottom: 10, fontSize: 11 }}>
              Description
              <textarea
                className="pinboard-input"
                value={renameDesc}
                onChange={(e) => setRenameDesc(e.target.value)}
                rows={2}
                style={{ width: "100%", marginTop: 4, resize: "vertical" }}
              />
            </label>
            <div className="pinboard-ui-label" style={{ fontSize: 11, marginBottom: 6 }}>
              Color
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {MAP_COLOR_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.label}
                  onClick={() => setRenameColor(p.hex)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: p.hex,
                    border: renameColor === p.hex ? `2px solid ${DEFAULT_GOLD}` : "2px solid rgba(0,0,0,0.35)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="pinboard-btn" onClick={() => setRenameTarget(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="pinboard-btn pinboard-btn--active" onClick={() => void submitRename()} disabled={busy || !renameName.trim()}>
                Save
              </button>
            </div>
          </WobblyPanel>
        </div>
      ) : null}
    </>
  );
}
