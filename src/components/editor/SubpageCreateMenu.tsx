import { Copy, FileText } from "lucide-react";
import { Page } from "../../lib/db";
import { useT } from "../../lib/i18n";
import { FloatingPopover } from "../FloatingPopover";

export function SubpageCreateMenu({
  anchorElement,
  open,
  align,
  templatePages,
  onCreateBlank,
  onCreateFromTemplate,
  onOpenChange,
}: {
  anchorElement: HTMLElement | null;
  open: boolean;
  align: "start" | "end";
  templatePages: Page[];
  onCreateBlank: () => void;
  onCreateFromTemplate: (templateId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <FloatingPopover
      anchorElement={anchorElement}
      open={open}
      width={224}
      placement={align === "end" ? "bottom-end" : "bottom-start"}
      onOpenChange={onOpenChange}
      className="on-popover"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
        onClick={onCreateBlank}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        {t("sidebar.blankPage")}
      </button>
      {templatePages.length > 0 && <div className="my-1 h-px bg-border" />}
      {templatePages.map((template) => (
        <button
          key={`subpage-template-${template.id}`}
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={() => onCreateFromTemplate(template.id)}
        >
          {template.icon ? (
            <span className="flex h-3.5 w-3.5 items-center justify-center text-xs">{template.icon}</span>
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="truncate">{template.title || t("sidebar.untitled")}</span>
        </button>
      ))}
    </FloatingPopover>
  );
}
