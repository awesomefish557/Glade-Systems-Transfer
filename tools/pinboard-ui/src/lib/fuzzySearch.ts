/** Lightweight fuzzy match: substring, subsequence, or all query tokens present. Returns 0 if no match. */
export function fuzzyScore(query: string, haystack: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = haystack.toLowerCase();
  if (t.includes(q)) return 1;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  if (qi === q.length) return 0.72;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every((tok) => t.includes(tok))) return 0.55;
  return 0;
}

export function nodeSearchBlob(n: { title: string; body: string | null; tags: string[] }): string {
  return [n.title, n.body ?? "", ...n.tags].join(" ");
}
