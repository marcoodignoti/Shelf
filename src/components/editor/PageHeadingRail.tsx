import { ChevronDown, ChevronUp } from "lucide-react";
import type { HeadingRailItem } from "../../lib/editorDom";
import { useT } from "../../lib/i18n";

export function PageHeadingRail({
  items,
  activeId,
  onSelect,
}: {
  items: HeadingRailItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const previousItem = items[Math.max(0, activeIndex - 1)] ?? null;
  const nextItem = items[Math.min(items.length - 1, activeIndex + 1)] ?? null;

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t("editor.pageSections")}
      className="group/rail absolute bottom-16 right-3 top-20 z-[70] hidden w-14 flex-col items-center justify-center overflow-visible xl:flex"
    >
      <div className="flex h-full max-h-[34rem] flex-col items-center justify-between gap-2 rounded-full py-1 text-muted-foreground/70 opacity-45 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className="on-heading-rail-arrow"
          aria-label={t("editor.previousSection")}
          disabled={!previousItem || previousItem.id === activeId}
          onClick={() => previousItem && onSelect(previousItem.id)}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-visible py-1">
          {items.map((item) => {
            const isActive = item.id === activeId;
            const tickWidth = item.level <= 1 ? "w-8" : item.level === 2 ? "w-6" : "w-4";

            return (
              <button
                key={item.id}
                type="button"
                className="group/railitem relative flex h-3 w-10 items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={t("editor.goToSection", { title: item.title || t("editor.untitledSection") })}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span
                  className={`${tickWidth} h-px rounded-full transition-all ${isActive ? "h-0.5 bg-foreground" : "bg-muted-foreground/70 group-hover/railitem:bg-foreground"}`}
                />
                <span className={`on-heading-rail-preview pointer-events-none absolute right-12 top-1/2 z-10 max-w-80 -translate-y-1/2 translate-x-1 truncate px-4 py-2 text-sm font-semibold leading-tight text-popover-foreground opacity-0 transition-all duration-150 group-hover/railitem:pointer-events-auto group-hover/railitem:translate-x-0 group-hover/railitem:opacity-100 group-hover/railitem:text-foreground group-focus-visible/railitem:pointer-events-auto group-focus-visible/railitem:translate-x-0 group-focus-visible/railitem:opacity-100 ${isActive ? "text-foreground" : ""}`}>
                  {item.title || t("editor.untitledSection")}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="on-heading-rail-arrow"
          aria-label={t("editor.nextSection")}
          disabled={!nextItem || nextItem.id === activeId}
          onClick={() => nextItem && onSelect(nextItem.id)}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
