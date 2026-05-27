export type FloatingRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export type FloatingSize = {
  width: number;
  height: number;
};

export type FloatingViewport = {
  width: number;
  height: number;
};

export type FloatingPlacement = "bottom-start" | "bottom-end";

export type FloatingPosition = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
};

export function computeFloatingPosition(
  anchor: FloatingRect,
  floating: FloatingSize,
  viewport: FloatingViewport,
  options: { placement?: FloatingPlacement; offset?: number; margin?: number } = {}
): FloatingPosition {
  const placement = options.placement ?? "bottom-start";
  const offset = options.offset ?? 6;
  const margin = options.margin ?? 12;
  const viewportMaxWidth = Math.max(0, viewport.width - margin * 2);
  const viewportMaxHeight = Math.max(0, viewport.height - margin * 2);
  const effectiveWidth = Math.min(floating.width, viewportMaxWidth);
  const effectiveHeight = Math.min(floating.height, viewportMaxHeight);
  const preferredLeft = placement === "bottom-end" ? anchor.right - effectiveWidth : anchor.left;
  const bottomTop = anchor.bottom + offset;
  const topTop = anchor.top - effectiveHeight - offset;
  const fitsBelow = bottomTop + effectiveHeight <= viewport.height - margin;
  const preferredTop = fitsBelow ? bottomTop : topTop;
  const left = Math.max(margin, Math.min(preferredLeft, viewport.width - effectiveWidth - margin));
  const top = Math.max(margin, Math.min(preferredTop, viewport.height - effectiveHeight - margin));

  return {
    left,
    top,
    maxWidth: Math.max(0, viewport.width - left - margin),
    maxHeight: Math.max(0, viewport.height - top - margin),
  };
}
