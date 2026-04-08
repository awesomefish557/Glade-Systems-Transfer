import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  API_BASE,
  confirmAttachment,
  deleteAttachment,
  deleteConnection,
  deleteNode,
  fetchNodeDetail,
  putFileToPresignedUrl,
  signAttachmentUpload,
  updateConnection,
  updateNode,
} from "../api";
import { requestGraphRefresh } from "../graphRefresh";
import type { GraphConnection, GraphNode } from "../types";
import { WobblyPanel } from "./WobblyPanel";

const FILE_INPUT_ACCEPT =
  "image/jpeg,image/jpg,image/png,image/gif,image/webp,application/pdf,text/plain,text/*,image/*,application/octet-stream,*/*";

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function isPdfMime(mime: string, filename: string): boolean {
  return mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

function attachmentListIcon(mime: string, filename: string): string {
  if (isImageMime(mime)) return "🖼";
  if (isPdfMime(mime, filename)) return "📄";
  return "📎";
}

type UploadUiState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; index: number; total: number; percent: number | null }
  | { kind: "success" };

function metadataLines(type: string, meta: Record<string, unknown>): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  const str = (x: unknown) => (x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x));
  switch (type) {
    case "PRECEDENT":
      if (meta.architect) out.push({ k: "Architect", v: str(meta.architect) });
      if (meta.year) out.push({ k: "Year", v: str(meta.year) });
      if (meta.location) out.push({ k: "Location", v: str(meta.location) });
      break;
    case "PERSON":
      if (meta.role) out.push({ k: "Role", v: str(meta.role) });
      if (meta.born) out.push({ k: "Born", v: str(meta.born) });
      if (meta.died) out.push({ k: "Died", v: str(meta.died) });
      break;
    case "RESOURCE":
      if (meta.author) out.push({ k: "Author", v: str(meta.author) });
      if (meta.url) out.push({ k: "URL", v: str(meta.url) });
      if (meta.publicationYear) out.push({ k: "Publication year", v: str(meta.publicationYear) });
      break;
    case "QUOTE":
      if (meta.source) out.push({ k: "Source", v: str(meta.source) });
      if (meta.year) out.push({ k: "Year", v: str(meta.year) });
      break;
    case "PLACE":
      if (meta.country) out.push({ k: "Country", v: str(meta.country) });
      if (meta.coordinates) out.push({ k: "Coordinates", v: str(meta.coordinates) });
      break;
    default:
      break;
  }
  for (const [k, v] of Object.entries(meta)) {
    if (
      [
        "architect",
        "year",
        "location",
        "role",
        "born",
        "died",
        "author",
        "url",
        "publicationYear",
        "source",
        "country",
        "coordinates",
      ].includes(k)
    ) {
      continue;
    }
    out.push({ k, v: str(v) });
  }
  return out;
}

export function NodeDetailPanel({
  typeColor,
  nodeId,
  nodeIndex,
  onClose,
  onDeleted,
  onUpdated,
  onPanToNode,
}: {
  typeColor: (typeName: string) => string;
  nodeId: string;
  /** Latest position/title from canvas state */
  nodeIndex: Map<string, GraphNode>;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: (n: GraphNode) => void;
  onPanToNode: (id: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [node, setNode] = useState<GraphNode | null>(null);
  const [conns, setConns] = useState<GraphConnection[]>([]);
  const [attachments, setAttachments] = useState<
    { id: string; filename: string; mime_type: string; size_bytes: number | null }[]
  >([]);
  const [editing, setEditing] = useState(false);
  /** Draft label + strength per connection while sidebar edit mode is on */
  const [connEdits, setConnEdits] = useState<Record<string, { label: string; strength: number }>>({});
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [uploadUi, setUploadUi] = useState<UploadUiState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteHoverId, setDeleteHoverId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await fetchNodeDetail(nodeId);
      setNode(d.node);
      setConns(d.connections);
      setAttachments(d.attachments);
      setTitle(d.node.title);
      setBody(d.node.body ?? "");
      setTagsStr(d.node.tags.join(", "));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const otherId = (c: GraphConnection) => (c.source_id === nodeId ? c.target_id : c.source_id);

  const otherTitle = (c: GraphConnection) => {
    const oid = otherId(c);
    return nodeIndex.get(oid)?.title ?? oid.slice(0, 8);
  };

  const save = async () => {
    if (!node) return;
    setErr(null);
    try {
      const tags = tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const updated = await updateNode(node.id, {
        title: title.trim(),
        body: body.trim() || null,
        tags,
      });
      setNode(updated);
      onUpdated(updated);
      for (const c of conns) {
        const ed = connEdits[c.id];
        if (!ed) continue;
        const newLabel = ed.label.trim() || null;
        const oldLabel = c.label ?? null;
        if (newLabel !== oldLabel || ed.strength !== c.strength) {
          await updateConnection(c.id, { label: newLabel, strength: ed.strength });
        }
      }
      requestGraphRefresh();
      await load();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeConnectionRow = async (connectionId: string) => {
    if (!confirm("Remove this connection from the map?")) return;
    setErr(null);
    try {
      await deleteConnection(connectionId);
      requestGraphRefresh();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleEditing = () => {
    setEditing((prev) => {
      const next = !prev;
      if (next) {
        const m: Record<string, { label: string; strength: number }> = {};
        for (const c of conns) {
          m[c.id] = { label: c.label ?? "", strength: c.strength };
        }
        setConnEdits(m);
      }
      return next;
    });
  };

  const remove = async () => {
    if (!node || !confirm("Delete this node and its connections?")) return;
    try {
      await deleteNode(node.id);
      onDeleted();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const processUploadQueue = useCallback(
    async (files: File[]) => {
      if (!node || files.length === 0) return;
      setErr(null);
      const list = [...files];
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        setUploadUi({
          kind: "uploading",
          name: file.name,
          index: i + 1,
          total: list.length,
          percent: 0,
        });
        try {
          const { upload_url, attachment_id } = await signAttachmentUpload(node.id, file);
          await putFileToPresignedUrl(upload_url, file, (pct) => {
            setUploadUi((s) =>
              s.kind === "uploading" ? { ...s, percent: pct ?? s.percent } : s,
            );
          });
          await confirmAttachment(attachment_id);
        } catch (uploadErr) {
          setUploadUi({ kind: "idle" });
          setErr(uploadErr instanceof Error ? uploadErr.message : String(uploadErr));
          return;
        }
      }
      await load();
      setUploadUi({ kind: "success" });
      window.setTimeout(() => setUploadUi({ kind: "idle" }), 1200);
    },
    [node, load],
  );

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files;
    e.target.value = "";
    if (!fl?.length || !node) return;
    void processUploadQueue(Array.from(fl));
  };

  const onDropZoneDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const onDropZoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragOver(false);
    }
  };

  const onDropZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDropZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    if (!node || uploadUi.kind === "uploading") return;
    const fl = e.dataTransfer.files;
    if (fl.length) void processUploadQueue(Array.from(fl));
  };

  const onDeleteAttachment = async (id: string) => {
    setErr(null);
    setDeletingId(id);
    try {
      await deleteAttachment(id);
      await load();
    } catch (delErr) {
      setErr(delErr instanceof Error ? delErr.message : String(delErr));
    } finally {
      setDeletingId(null);
    }
  };

  const badgeColor = node ? typeColor(node.type) : "#d4a853";

  return createPortal(
    <>
      <div
        role="presentation"
        style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          left: "auto",
          bottom: "auto",
          width: "360px",
          height: "100vh",
          maxWidth: "100vw",
          zIndex: 130,
          margin: 0,
          padding: 0,
          transform: "none",
          overflowX: "hidden",
          overflowY: "auto",
          boxSizing: "border-box",
          WebkitOverflowScrolling: "touch",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <WobblyPanel padding="0" minHeight={0} style={{ overflow: "visible" }}>
          <div
            className="pinboard-panel-inner"
            style={{
              padding: "16px 20px 20px",
              boxSizing: "border-box",
              minHeight: "min-content",
            }}
          >
            <header
              style={{
                position: "relative",
                marginBottom: 4,
                minHeight: 36,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  display: "flex",
                  gap: 6,
                  flexShrink: 0,
                  zIndex: 1,
                }}
              >
                {node ? (
                  <>
                    <button type="button" className="pinboard-btn" style={{ padding: "6px 8px" }} onClick={toggleEditing}>
                      {editing ? "Cancel" : "Edit"}
                    </button>
                    <button type="button" className="pinboard-btn" style={{ padding: "6px 8px", borderColor: "#884444" }} onClick={() => void remove()}>
                      Delete
                    </button>
                  </>
                ) : null}
                <button type="button" className="pinboard-btn" style={{ padding: "6px 10px" }} onClick={onClose} aria-label="Close">
                  ✕
                </button>
              </div>

              <div style={{ paddingRight: 132, minWidth: 0, width: "100%" }}>
                {loading ? (
                  <p style={{ color: "#8aaa8a", fontSize: 14, margin: 0, paddingTop: 2 }}>Loading…</p>
                ) : node ? (
                  <>
                    <span
                      className="pinboard-ui-label"
                      style={{
                        display: "block",
                        fontSize: 8,
                        letterSpacing: "0.12em",
                        color: badgeColor,
                        textTransform: "uppercase",
                      }}
                    >
                      {node.type}
                    </span>
                    {editing ? (
                      <input
                        className="pinboard-input"
                        style={{
                          marginTop: 8,
                          width: "100%",
                          boxSizing: "border-box",
                          maxWidth: "100%",
                        }}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    ) : (
                      <h2
                        style={{
                          fontFamily: "Georgia, serif",
                          fontSize: node.type === "QUESTION" ? 15 : 18,
                          fontWeight: 400,
                          color: node.type === "QUESTION" ? "#e8a0a0" : "#e8f0e4",
                          fontStyle: node.type === "QUESTION" ? "italic" : "normal",
                          marginTop: 6,
                          marginBottom: 0,
                          lineHeight: 1.3,
                          wordBreak: "break-word",
                          overflowWrap: "break-word",
                          maxWidth: "100%",
                        }}
                      >
                        {node.title}
                      </h2>
                    )}
                  </>
                ) : (
                  <p style={{ color: "#c08080", margin: 0, paddingTop: 2, fontSize: 14 }}>{err ?? "Not found"}</p>
                )}
              </div>
            </header>

            {node && !loading ? (
              <>
                {editing ? (
                  <>
                    <label className="pinboard-ui-label" style={{ display: "block", fontSize: 10, color: "#6a9a6a", marginTop: 14 }}>
                      Body
                      <textarea className="pinboard-textarea" style={{ marginTop: 4 }} value={body} onChange={(e) => setBody(e.target.value)} />
                    </label>
                    <label className="pinboard-ui-label" style={{ display: "block", fontSize: 10, color: "#6a9a6a", marginTop: 10 }}>
                      Tags (comma-separated)
                      <input className="pinboard-input" style={{ marginTop: 4 }} value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} />
                    </label>
                    <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#4a7c59", marginTop: 16, marginBottom: 8 }}>
                      Connections
                    </p>
                    {conns.length === 0 ? (
                      <span style={{ color: "#5a7a5a", fontSize: 12 }}>None — create links on the map with Shift+drag</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
                        {conns.map((c) => {
                          const ed = connEdits[c.id] ?? { label: c.label ?? "", strength: c.strength };
                          return (
                            <div
                              key={c.id}
                              style={{
                                border: "1px solid rgba(74, 124, 89, 0.35)",
                                borderRadius: 6,
                                padding: "10px 10px 8px",
                                background: "rgba(0, 0, 0, 0.12)",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                                <span style={{ fontSize: 12, color: "#a8c8a0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                                  → {otherTitle(c)}
                                </span>
                                <button
                                  type="button"
                                  className="pinboard-btn"
                                  style={{ fontSize: 10, padding: "3px 8px", flexShrink: 0 }}
                                  onClick={() => onPanToNode(otherId(c))}
                                >
                                  Map
                                </button>
                              </div>
                              <label className="pinboard-ui-label" style={{ display: "block", fontSize: 9, color: "#6a9a6a" }}>
                                Label
                                <input
                                  className="pinboard-input"
                                  style={{ marginTop: 4 }}
                                  value={ed.label}
                                  onChange={(e) =>
                                    setConnEdits((prev) => ({
                                      ...prev,
                                      [c.id]: { ...ed, label: e.target.value },
                                    }))
                                  }
                                />
                              </label>
                              <label className="pinboard-ui-label" style={{ display: "block", fontSize: 9, color: "#6a9a6a", marginTop: 8 }}>
                                Strength (line weight)
                                <select
                                  className="pinboard-input"
                                  style={{ marginTop: 4, width: "100%", cursor: "pointer" }}
                                  value={ed.strength}
                                  onChange={(e) =>
                                    setConnEdits((prev) => ({
                                      ...prev,
                                      [c.id]: { ...ed, strength: Number(e.target.value) },
                                    }))
                                  }
                                >
                                  <option value={1}>1 — light</option>
                                  <option value={2}>2 — medium</option>
                                  <option value={3}>3 — strong</option>
                                </select>
                              </label>
                              <button
                                type="button"
                                className="pinboard-btn"
                                style={{ marginTop: 8, borderColor: "#884444", fontSize: 11, width: "100%" }}
                                onClick={() => void removeConnectionRow(c.id)}
                              >
                                Remove connection
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <button type="button" className="pinboard-btn pinboard-btn--active" style={{ marginTop: 12 }} onClick={() => void save()}>
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    {node.body ? (
                      <p
                        style={{
                          fontSize: 13,
                          color: "#a8c8a0",
                          marginTop: 14,
                          lineHeight: 1.55,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        {node.body}
                      </p>
                    ) : null}
                    {node.tags.length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                        {node.tags.map((t) => (
                          <span
                            key={t}
                            className="pinboard-ui-label"
                            style={{
                              fontSize: 10,
                              padding: "4px 8px",
                              background: "#d4a853",
                              color: "#1a1205",
                              borderRadius: 999,
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}

                <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#4a7c59", marginTop: 20, marginBottom: 8 }}>
                  Metadata
                </p>
                <ul style={{ listStyle: "none", fontSize: 13, color: "#b8d4b0" }}>
                  {metadataLines(node.type, node.metadata).map(({ k, v }) => (
                    <li key={k} style={{ marginBottom: 6 }}>
                      <span style={{ color: "#6a8a6a", fontFamily: "Arial, sans-serif", fontSize: 11 }}>{k}: </span>
                      {v}
                    </li>
                  ))}
                  {metadataLines(node.type, node.metadata).length === 0 ? <li style={{ color: "#5a7a5a" }}>—</li> : null}
                </ul>

                {!editing ? (
                  <>
                    <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#4a7c59", marginTop: 18, marginBottom: 8 }}>
                      Connections
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {conns.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="pinboard-btn"
                          style={{ fontSize: 11, textTransform: "none", letterSpacing: 0 }}
                          onClick={() => onPanToNode(otherId(c))}
                        >
                          {otherTitle(c)}
                          {c.label ? ` · ${c.label}` : ""}
                        </button>
                      ))}
                      {conns.length === 0 ? <span style={{ color: "#5a7a5a", fontSize: 13 }}>None</span> : null}
                    </div>
                  </>
                ) : null}

                <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#4a7c59", marginTop: 18, marginBottom: 8 }}>
                  Attachments
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={FILE_INPUT_ACCEPT}
                  style={{ display: "none" }}
                  onChange={onPickFile}
                />
                {uploadUi.kind === "idle" ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileRef.current?.click();
                      }
                    }}
                    onClick={() => fileRef.current?.click()}
                    onDragEnter={onDropZoneDragEnter}
                    onDragLeave={onDropZoneDragLeave}
                    onDragOver={onDropZoneDragOver}
                    onDrop={onDropZoneDrop}
                    style={{
                      width: "100%",
                      height: 80,
                      boxSizing: "border-box",
                      border: dragOver ? "1.5px dashed #d4a853" : "1.5px dashed rgba(212, 168, 83, 0.4)",
                      borderRadius: 4,
                      background: dragOver ? "rgba(15, 40, 20, 0.6)" : "rgba(5, 13, 6, 0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      marginBottom: 12,
                      transition: "border-color 0.15s ease, background 0.15s ease",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "Arial, sans-serif",
                        fontSize: 11,
                        color: "rgba(200, 220, 190, 0.5)",
                        textAlign: "center",
                        padding: "0 12px",
                        pointerEvents: "none",
                      }}
                    >
                      Drop files here or click to browse
                    </span>
                  </div>
                ) : uploadUi.kind === "uploading" ? (
                  <div
                    style={{
                      width: "100%",
                      minHeight: 80,
                      boxSizing: "border-box",
                      marginBottom: 12,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {uploadUi.total > 1 ? (
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "Arial, sans-serif",
                          fontSize: 10,
                          color: "#6a9a6a",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Uploading {uploadUi.index} of {uploadUi.total}…
                      </p>
                    ) : null}
                    <p
                      style={{
                        margin: 0,
                        fontFamily: "Arial, sans-serif",
                        fontSize: 11,
                        color: "rgba(200, 220, 190, 0.85)",
                      }}
                    >
                      {truncateStr(uploadUi.name, 30)} — {uploadUi.percent != null ? `${uploadUi.percent}%` : "…"}
                    </p>
                    <div
                      style={{
                        width: "100%",
                        height: 6,
                        borderRadius: 3,
                        background: "rgba(74, 106, 74, 0.3)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${uploadUi.percent != null ? Math.min(100, uploadUi.percent) : 0}%`,
                          background: "#6ab86a",
                          borderRadius: 3,
                          transition: "width 0.08s linear",
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: 80,
                      boxSizing: "border-box",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1.5px dashed rgba(212, 168, 83, 0.35)",
                      borderRadius: 4,
                      background: "rgba(5, 13, 6, 0.45)",
                    }}
                  >
                    <span style={{ fontFamily: "Georgia, serif", fontSize: 14, color: "#6ab86a" }}>✓ Uploaded</span>
                  </div>
                )}
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0 }}>
                  {attachments.map((a) => {
                    const dl = `${API_BASE}/api/attachments/${a.id}/download`;
                    const img = isImageMime(a.mime_type);
                    const icon = attachmentListIcon(a.mime_type, a.filename);
                    return (
                      <li
                        key={a.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          minWidth: 0,
                        }}
                      >
                        {img ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <span style={{ fontSize: 14, lineHeight: 1, opacity: 0.85 }} aria-hidden>
                              🖼
                            </span>
                            <img
                              src={dl}
                              alt=""
                              width={40}
                              height={40}
                              style={{
                                width: 40,
                                height: 40,
                                objectFit: "cover",
                                borderRadius: 3,
                                background: "rgba(0,0,0,0.2)",
                              }}
                            />
                          </div>
                        ) : (
                          <span
                            style={{
                              width: 40,
                              height: 40,
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 20,
                              lineHeight: 1,
                            }}
                            aria-hidden
                          >
                            {icon}
                          </span>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a
                            href={dl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#d4a853",
                              fontSize: 13,
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={a.filename}
                          >
                            {truncateStr(a.filename, 28)}
                          </a>
                          <span style={{ color: "#5a7a5a", fontSize: 11, fontFamily: "Arial, sans-serif" }}>
                            {formatFileSize(a.size_bytes)}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={deletingId === a.id}
                          aria-label={`Delete ${a.filename}`}
                          onClick={() => void onDeleteAttachment(a.id)}
                          onMouseEnter={() => setDeleteHoverId(a.id)}
                          onMouseLeave={() => setDeleteHoverId(null)}
                          style={{
                            flexShrink: 0,
                            border: "none",
                            background: "transparent",
                            color: deleteHoverId === a.id ? "#cc4444" : "#7a8a7a",
                            fontSize: 20,
                            lineHeight: 1,
                            padding: "4px 6px",
                            cursor: deletingId === a.id ? "wait" : "pointer",
                            opacity: deletingId === a.id ? 0.5 : 1,
                          }}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                  {attachments.length === 0 ? <li style={{ color: "#5a7a5a", fontSize: 13 }}>No files yet</li> : null}
                </ul>
              </>
            ) : null}

            {err && node ? (
              <p style={{ color: "#cc8888", fontSize: 12, marginTop: 12, fontFamily: "Arial, sans-serif" }}>{err}</p>
            ) : null}
          </div>
        </WobblyPanel>
      </aside>
    </>,
    document.body,
  );
}
