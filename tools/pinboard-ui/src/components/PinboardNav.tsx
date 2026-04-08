export type MainTab = "map" | "list" | "explore";

export function PinboardNav({ tab, onTab }: { tab: MainTab; onTab: (t: MainTab) => void }) {
  const items: { id: MainTab; label: string }[] = [
    { id: "map", label: "MAP" },
    { id: "list", label: "LIST" },
    { id: "explore", label: "EXPLORE NEXT" },
  ];
  return (
    <nav className="pinboard-nav" aria-label="Main views">
      <div className="pinboard-nav-inner">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`pinboard-nav-tab${tab === it.id ? " pinboard-nav-tab--active" : ""}`}
            onClick={() => onTab(it.id)}
          >
            {it.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
