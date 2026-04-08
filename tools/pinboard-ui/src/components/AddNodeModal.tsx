import { useLayoutEffect, useMemo, useState } from "react";
import type { AddNodeDraft, GraphNodeType } from "../types";
import { WobblyPanel } from "./WobblyPanel";

/** Uniform random point in a disk of given radius around (cx, cy). */
function randomPointInDisk(cx: number, cy: number, radius: number): { x: number; y: number } {
  const u = Math.random();
  const v = Math.random();
  const r = radius * Math.sqrt(u);
  const theta = 2 * Math.PI * v;
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
}

function buildMetadata(
  type: string,
  fields: Record<string, string>,
): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  switch (type) {
    case "PRECEDENT":
      if (fields.architect) m.architect = fields.architect;
      if (fields.year) m.year = fields.year;
      if (fields.location) m.location = fields.location;
      break;
    case "PERSON":
      if (fields.role) m.role = fields.role;
      if (fields.born) m.born = fields.born;
      if (fields.died) m.died = fields.died;
      break;
    case "RESOURCE":
      if (fields.author) m.author = fields.author;
      if (fields.url) m.url = fields.url;
      if (fields.publicationYear) m.publicationYear = fields.publicationYear;
      break;
    case "QUOTE":
      if (fields.source) m.source = fields.source;
      if (fields.quoteYear) m.year = fields.quoteYear;
      break;
    case "PLACE":
      if (fields.country) m.country = fields.country;
      if (fields.lat || fields.lng) {
        m.coordinates = {
          lat: fields.lat ? Number(fields.lat) : undefined,
          lng: fields.lng ? Number(fields.lng) : undefined,
        };
      }
      break;
    default:
      break;
  }
  return m;
}

function defaultTypeChoice(nodeTypes: GraphNodeType[]): string {
  const sorted = [...nodeTypes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const nonQ = sorted.find((t) => t.name !== "QUESTION");
  return nonQ?.name ?? sorted[0]?.name ?? "QUESTION";
}

function emptyFormState(defaultType: string) {
  return {
    type: defaultType,
    title: "",
    body: "",
    tags: "",
    architect: "",
    year: "",
    location: "",
    role: "",
    born: "",
    died: "",
    author: "",
    url: "",
    publicationYear: "",
    source: "",
    quoteYear: "",
    country: "",
    lat: "",
    lng: "",
  };
}

export function AddNodeModal({
  nodeTypes,
  worldX,
  worldY,
  initialDraft,
  onClose,
  onCreate,
}: {
  nodeTypes: GraphNodeType[];
  worldX: number;
  worldY: number;
  /** Pre-fill when opening from Explore Next (modal should use a changing `key` from parent when reopening). */
  initialDraft?: AddNodeDraft | null;
  onClose: () => void;
  onCreate: (payload: {
    type: string;
    title: string;
    body: string | null;
    tags: string[];
    x: number;
    y: number;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const [type, setType] = useState<string>(() => defaultTypeChoice(nodeTypes));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [architect, setArchitect] = useState("");
  const [year, setYear] = useState("");
  const [location, setLocation] = useState("");
  const [role, setRole] = useState("");
  const [born, setBorn] = useState("");
  const [died, setDied] = useState("");
  const [author, setAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [publicationYear, setPublicationYear] = useState("");
  const [source, setSource] = useState("");
  const [quoteYear, setQuoteYear] = useState("");
  const [country, setCountry] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useLayoutEffect(() => {
    const dt = defaultTypeChoice(nodeTypes);
    const e = emptyFormState(dt);
    if (initialDraft) {
      if (initialDraft.type && nodeTypes.some((t) => t.name === initialDraft.type)) {
        e.type = initialDraft.type;
      }
      if (initialDraft.title !== undefined) e.title = initialDraft.title;
      if (initialDraft.body !== undefined && initialDraft.body !== null) e.body = initialDraft.body;
      if (initialDraft.tags?.length) e.tags = initialDraft.tags.join(", ");
      const m = initialDraft.metadata ?? {};
      if (typeof m.url === "string") e.url = m.url;
      if (typeof m.author === "string") e.author = m.author;
      if (typeof m.country === "string") e.country = m.country;
    }
    setType(e.type);
    setTitle(e.title);
    setBody(e.body);
    setTags(e.tags);
    setArchitect(e.architect);
    setYear(e.year);
    setLocation(e.location);
    setRole(e.role);
    setBorn(e.born);
    setDied(e.died);
    setAuthor(e.author);
    setUrl(e.url);
    setPublicationYear(e.publicationYear);
    setSource(e.source);
    setQuoteYear(e.quoteYear);
    setCountry(e.country);
    setLat(e.lat);
    setLng(e.lng);
    setErr(null);
  }, [initialDraft, nodeTypes]);

  const fields = useMemo(
    () => ({
      architect,
      year,
      location,
      role,
      born,
      died,
      author,
      url,
      publicationYear,
      source,
      quoteYear,
      country,
      lat,
      lng,
    }),
    [
      architect,
      year,
      location,
      role,
      born,
      died,
      author,
      url,
      publicationYear,
      source,
      quoteYear,
      country,
      lat,
      lng,
    ],
  );

  const submit = async () => {
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const metadata = buildMetadata(type, fields);
      const { x, y } = randomPointInDisk(worldX, worldY, 300);
      await onCreate({
        type,
        title: title.trim(),
        body: body.trim() || null,
        tags: tagList,
        x,
        y,
        metadata,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        role="presentation"
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(2, 8, 4, 0.75)" }}
        onClick={onClose}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 310,
          width: "min(440px, 94vw)",
          maxHeight: "88vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <WobblyPanel padding="18px 20px" minHeight={0}>
          <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.14em", color: "#4a7c59", marginBottom: 10 }}>
            New node
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
              Type
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: nodeTypes.find((x) => x.name === type)?.color ?? "#888",
                    flexShrink: 0,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
                  }}
                />
                <select
                  className="pinboard-select"
                  style={{ flex: 1 }}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {[...nodeTypes]
                    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                    .map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
            </label>
            <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
              Title *
              <input className="pinboard-input" style={{ marginTop: 4 }} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
              Body
              <textarea className="pinboard-textarea" style={{ marginTop: 4 }} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
              Tags (comma-separated)
              <input className="pinboard-input" style={{ marginTop: 4 }} value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>

            {type === "PRECEDENT" ? (
              <>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Architect
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={architect} onChange={(e) => setArchitect(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Year
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={year} onChange={(e) => setYear(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Location
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={location} onChange={(e) => setLocation(e.target.value)} />
                </label>
              </>
            ) : null}
            {type === "PERSON" ? (
              <>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Role
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={role} onChange={(e) => setRole(e.target.value)} placeholder="architect / theorist / artist" />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Born
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={born} onChange={(e) => setBorn(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Died
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={died} onChange={(e) => setDied(e.target.value)} />
                </label>
              </>
            ) : null}
            {type === "RESOURCE" ? (
              <>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Author
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={author} onChange={(e) => setAuthor(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  URL
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Publication year
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={publicationYear} onChange={(e) => setPublicationYear(e.target.value)} />
                </label>
              </>
            ) : null}
            {type === "QUOTE" ? (
              <>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Source (person)
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={source} onChange={(e) => setSource(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Year
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={quoteYear} onChange={(e) => setQuoteYear(e.target.value)} />
                </label>
              </>
            ) : null}
            {type === "PLACE" ? (
              <>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Country
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={country} onChange={(e) => setCountry(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Lat (optional)
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={lat} onChange={(e) => setLat(e.target.value)} />
                </label>
                <label className="pinboard-ui-label" style={{ fontSize: 10, color: "#6a9a6a" }}>
                  Lng (optional)
                  <input className="pinboard-input" style={{ marginTop: 4 }} value={lng} onChange={(e) => setLng(e.target.value)} />
                </label>
              </>
            ) : null}
          </div>
          {err ? (
            <p style={{ color: "#cc8888", fontSize: 12, marginTop: 10, fontFamily: "Arial, sans-serif" }}>{err}</p>
          ) : null}
          <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
            <button type="button" className="pinboard-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="pinboard-btn pinboard-btn--active" onClick={() => void submit()} disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </button>
          </div>
        </WobblyPanel>
      </div>
    </>
  );
}
