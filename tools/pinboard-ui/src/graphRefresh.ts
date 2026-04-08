/** Dispatched after loading-bay approve so the map refetches if mounted. */
export const GRAPH_REFRESH_EVENT = "pinboard:refresh-graph";

export function requestGraphRefresh(): void {
  window.dispatchEvent(new Event(GRAPH_REFRESH_EVENT));
}
