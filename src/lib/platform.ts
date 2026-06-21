export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = (navigator.userAgent || "").toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  return userAgent.includes("windows") || platform.startsWith("win");
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator.platform || "").toLowerCase().includes("mac");
}

export function platformClass(): string {
  if (isWindowsPlatform()) return "platform-win";
  if (isMacPlatform()) return "platform-mac";
  return "platform-other";
}
