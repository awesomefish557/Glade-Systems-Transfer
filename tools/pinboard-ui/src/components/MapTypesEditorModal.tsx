import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMapNodeType,
  deleteMapNodeType,
  fetchMapNodeTypes,
  updateMapNodeType,
} from "../api";
import { QUESTION_TYPE_COLOR } from "../constants";
import type { GraphNodeType } from "../types";
import { WobblyPanel } from "./WobblyPanel";

export const NODE_TYPE_EDITOR_PRESETS = [
  "#d4a853",
  "#2a9d8f",
  "#7b68a8",
  "#87a878",
  "#c67b5c",
  "#c94c4c",
  "#c49a3c",
  "#4a9b8e",
  "#5a8a5a",
  "#8a6a5a",
  "#a89a7a",
  "#6ab86a",
] as const;

const QUESTION = "QUESTION";

type EditorRow = GraphNodeType & { isNew?: boolean };

function randomPresetColor(): string {
  const i = Math.floor(Math.random() * NODE_TYPE_EDITOR_PRESETS.length);
  return NODE_TYPE_EDITOR_PRESETS[i]!;
}

export function MapTypesEditorModal({
  open,
  mapId,
  nodeTypes,
  onClose,
  onTypesUpdated,
}: {
  open: boolean;
  mapId: string;
  nodeTypes: GraphNodeType[];
  onClose: () => void;
  onTypesUpdated: (types: GraphNodeType[]) => void;
}) {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [pickerForId, setPickerForId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const baselineRef = useRef<Map<string, { name: string; color: string }>>(new Map());

  const syncFromProps = useCallback(() => {
    const sorted = [...nodeTypes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    setRows(sorted.map((r) => ({ ...r, isNew: false })));
    const m = new Map<string, { name: string; color: string }>();
    for (const r of sorted) {
      m.set(r.id, { name: r.name, color: r.color });
    }
    baselineRef.current = m;
  }, [nodeTypes]);

  useEffect(() => {
    if (open) {
      syncFromProps();
      setErr(null);
      setPickerForId(null);
    }
  }, [open, syncFromProps]);

  const pushUpdatedList = useCallback(async () => {
    const fresh = await fetchMapNodeTypes(mapId);
    onTypesUpdated(fresh);
    const sorted = [...fresh].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    setRows(sorted.map((r) => ({ ...r, isNew: false })));
    const m = new Map<string, { name: string; color: string }>();
    for (const r of sorted) {
      m.set(r.id, { name: r.name, color: r.color });
    }
    baselineRef.current = m;
  }, [mapId, onTypesUpdated]);

  const addRow = () => {
    const id = `new-${crypto.randomUUID()}`;
    setRows((prev) => [
      ...prev,
      {
        id,
        map_id: mapId,
        name: "NEW TYPE",
        color: randomPresetColor(),
        sort_order: prev.length,
        node_count: 0,
        isNew: true,
      },
    ]);
  };

  const onDeleteRow = async (row: EditorRow) => {
    if (row.name === QUESTION) return;
    if ((row.node_count ?? 0) > 0) return;
    setErr(null);
    if (row.isNew) {
      setRows((prev) => prev.filter((x) => x.id !== row.id));
      return;
    }
    setBusy(true);
    try {
      await deleteMapNodeType(mapId, row.id);
      await pushUpdatedList();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const baseline = baselineRef.current;
      for (const row of rows) {
        if (row.isNew) {
          const nm = row.name.trim().toUpperCase();
          if (!nm) {
            throw new Error("Each new type needs a name");
          }
          const created = await createMapNodeType(mapId, {
            name: nm,
            color: nm === QUESTION ? QUESTION_TYPE_COLOR : row.color.trim() || "#888888",
          });
          baseline.set(created.id, { name: created.name, color: created.color });
        } else {
          const b = baseline.get(row.id);
          const nameNext = row.name.trim().toUpperCase() || row.name.trim();
          const colorNext = row.name === QUESTION ? QUESTION_TYPE_COLOR : row.color.trim() || "#888888";
          if (!b || b.name !== nameNext || b.color !== colorNext) {
            await updateMapNodeType(mapId, row.id, {
              name: nameNext,
              color: colorNext,
            });
            baseline.set(row.id, { name: nameNext, color: colorNext });
          }
        }
      }
      await pushUpdatedList();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.55)" }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            setPickerForId(null);
            onClose();
          }
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 330,
          width: "min(480px, 94vw)",
          maxHeight: "88vh",
          overflow: "auto",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WobblyPanel padding="16px 18px" minHeight={0} panelFill="rgba(10, 22, 12, 0.97)">
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 17, color: "#d4a853", margin: "0 0 12px" }}>
            Edit node types
          </h2>
          {err ? <p style={{ color: "#c88", fontSize: 12, marginBottom: 8 }}>{err}</p> : null}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <li
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    title="Colour"
                    onClick={() => setPickerForId((p) => (p === row.id ? null : row.id))}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: row.name === QUESTION ? QUESTION_TYPE_COLOR : row.color,
                      border: "2px solid rgba(212,168,83,0.45)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  />
                  {pickerForId === row.id ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: 6,
                        zIndex: 340,
                        padding: 10,
                        background: "rgba(6,14,8,0.98)",
                        border: "1px solid #2d4a35",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                        minWidth: 200,
                      }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {NODE_TYPE_EDITOR_PRESETS.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => {
                              if (row.name !== QUESTION) {
                                setRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, color: hex } : r)),
                                );
                              }
                              setPickerForId(null);
                            }}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 4,
                              background: hex,
                              border:
                                (row.name === QUESTION ? QUESTION_TYPE_COLOR : row.color) === hex
                                  ? "2px solid #d4a853"
                                  : "1px solid #333",
                              cursor: row.name === QUESTION ? "not-allowed" : "pointer",
                            }}
                            disabled={row.name === QUESTION}
                          />
                        ))}
                      </div>
                      <label className="pinboard-ui-label" style={{ fontSize: 10, display: "block" }}>
                        Hex
                        <input
                          className="pinboard-input"
                          style={{ marginTop: 4, width: "100%" }}
                          value={row.name === QUESTION ? QUESTION_TYPE_COLOR : row.color}
                          onChange={(e) => {
                            if (row.name === QUESTION) return;
                            setRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, color: e.target.value } : r)),
                            );
                          }}
                          disabled={row.name === QUESTION}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
                <input
                  className="pinboard-input"
                  style={{ flex: "1 1 140px", minWidth: 120 }}
                  value={row.name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((prev) =>
                      prev.map((r) =>
                        r.id === row.id
                          ? {
                              ...r,
                              name: v,
                              color: v.trim().toUpperCase() === QUESTION ? QUESTION_TYPE_COLOR : r.color,
                            }
                          : r,
                      ),
                    );
                  }}
                  disabled={row.name === QUESTION && !row.isNew}
                />
                {row.name === QUESTION ? null : (
                  <button
                    type="button"
                    className="pinboard-btn"
                    title="Delete type"
                    disabled={busy || (row.node_count ?? 0) > 0}
                    style={{
                      padding: "6px 10px",
                      opacity: (row.node_count ?? 0) > 0 ? 0.35 : 1,
                      cursor: (row.node_count ?? 0) > 0 ? "not-allowed" : "pointer",
                    }}
                    onClick={() => void onDeleteRow(row)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="pinboard-btn" style={{ width: "100%", marginTop: 6 }} onClick={addRow} disabled={busy}>
            ＋ Add type
          </button>
          <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
            <button type="button" className="pinboard-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="pinboard-btn pinboard-btn--active" onClick={() => void save()} disabled={busy}>
              Save
            </button>
          </div>
        </WobblyPanel>
      </div>
    </>
  );
}
