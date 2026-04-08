import { useMemo } from "react";

type Star = { left: string; top: string; duration: string; delay: string };

export function AmbientBackground() {
  const stars = useMemo(() => {
    const out: Star[] = [];
    for (let i = 0; i < 160; i++) {
      const left = `${Math.random() * 100}%`;
      const top = `${Math.random() * 100}%`;
      const duration = `${2 + Math.random() * 3}s`;
      const delay = `${Math.random() * 5}s`;
      out.push({ left, top, duration, delay });
    }
    return out;
  }, []);

  return (
    <div className="pinboard-ambient" aria-hidden>
      <div className="pinboard-blob pinboard-blob--1" />
      <div className="pinboard-blob pinboard-blob--2" />
      <div className="pinboard-blob pinboard-blob--3" />
      <div className="pinboard-stars">
        {stars.map((s, i) => (
          <span
            key={i}
            className="pinboard-star"
            style={{
              left: s.left,
              top: s.top,
              animationDuration: s.duration,
              animationDelay: s.delay,
            }}
          />
        ))}
      </div>
      <svg className="pinboard-moon" viewBox="0 0 40 40" aria-hidden>
        <circle cx="22" cy="20" r="14" fill="#e8e4dc" opacity="0.85" />
        <circle cx="14" cy="18" r="12" fill="#050d06" />
      </svg>
    </div>
  );
}
