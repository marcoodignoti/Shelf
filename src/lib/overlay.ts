export const CLOSE_OPEN_OVERLAYS_EVENT = "opennotion:close-open-overlays";

export function closeOpenOverlays(): void {
  window.dispatchEvent(new Event(CLOSE_OPEN_OVERLAYS_EVENT));
}
