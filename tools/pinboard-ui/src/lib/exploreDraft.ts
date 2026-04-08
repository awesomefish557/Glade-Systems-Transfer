import type { AddNodeDraft, ExploreRecommendation } from "../types";

function pickFirstMatch(candidates: string[], available: string[]): string | null {
  for (const c of candidates) {
    const u = c.toUpperCase();
    const hit = available.find((a) => a.toUpperCase() === u);
    if (hit) return hit;
  }
  return null;
}

export function exploreKindToNodeType(kind: string, available: string[]): string {
  if (available.length === 0) return "QUESTION";
  const k = kind.toLowerCase();
  let guess: string | null = null;
  switch (k) {
    case "book":
    case "talk":
      guess = pickFirstMatch(["RESOURCE", "RECIPE", "CONCEPT"], available);
      break;
    case "place":
      guess = pickFirstMatch(["PLACE", "RESTAURANT"], available);
      break;
    case "person":
      guess = pickFirstMatch(["PERSON", "CHEF"], available);
      break;
    case "website":
      guess = pickFirstMatch(["RESOURCE"], available);
      break;
    case "concept":
    default:
      guess = pickFirstMatch(["CONCEPT", "CUISINE", "DISH"], available);
      break;
  }
  if (guess) return guess;
  const nonQ = available.filter((t) => t !== "QUESTION");
  return nonQ[0] ?? available[0]!;
}

export function draftFromRecommendation(r: ExploreRecommendation, availableTypeNames: string[]): AddNodeDraft {
  const type = exploreKindToNodeType(String(r.type), availableTypeNames);
  const metadata: Record<string, unknown> = {};
  if (r.url) metadata.url = r.url;
  return {
    type,
    title: r.title,
    body: r.reason,
    tags: ["explore-next", String(r.type)].filter(Boolean),
    metadata,
  };
}
