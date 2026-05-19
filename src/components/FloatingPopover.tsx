import { CSSProperties, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeFloatingPosition, FloatingPlacement } from "../lib/floatingPosition";

type FloatingPopoverProps = {
  anchorElement: HTMLElement | null;
  open: boolean;
  children: ReactNode;
  className?: string;
  width?: number;
  placement?: FloatingPlacement;
  zIndex?: number;
};

export function FloatingPopover({
  anchorElement,
  open,
  children,
  className,
  width = 240,
  placement = "bottom-start",
  zIndex = 160,
}: FloatingPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  const setPositionStyle = (position: ReturnType<typeof computeFloatingPosition>) => {
    const nextStyle: CSSProperties = {
      left: position.left,
      top: position.top,
      width: Math.min(width, position.maxWidth),
      maxHeight: position.maxHeight,
      maxWidth: position.maxWidth,
      zIndex,
    };

    setStyle((current) => {
      if (!current) return nextStyle;

      if (
        current.left === nextStyle.left &&
        current.top === nextStyle.top &&
        current.width === nextStyle.width &&
        current.maxHeight === nextStyle.maxHeight &&
        current.maxWidth === nextStyle.maxWidth &&
        current.zIndex === nextStyle.zIndex
      ) {
        return current;
      }

      return nextStyle;
    });
  };

  const updatePosition = () => {
    if (!open || !anchorElement) return;

    const anchorRect = anchorElement.getBoundingClientRect();
    const popoverRect = popoverRef.current?.getBoundingClientRect();
    const position = computeFloatingPosition(
      anchorRect,
      { width: popoverRect?.width ?? width, height: popoverRect?.height ?? 220 },
      { width: window.innerWidth, height: window.innerHeight },
      { placement }
    );

    setPositionStyle(position);
  };

  useLayoutEffect(() => {
    updatePosition();
  });

  useLayoutEffect(() => {
    if (!open || !anchorElement) return;

    const handleViewportChange = () => {
      const anchorRect = anchorElement.getBoundingClientRect();
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      const position = computeFloatingPosition(
        anchorRect,
        { width: popoverRect?.width ?? width, height: popoverRect?.height ?? 220 },
        { width: window.innerWidth, height: window.innerHeight },
        { placement }
      );

      setPositionStyle(position);
    };

    handleViewportChange();
    const frame = window.requestAnimationFrame(handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [anchorElement, open, placement, width, zIndex]);

  if (!open || !anchorElement) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className={className}
      style={{
        position: "fixed",
        overflowY: "auto",
        visibility: style ? "visible" : "hidden",
        ...style,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
