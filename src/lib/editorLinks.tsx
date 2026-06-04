import { BlockNoteEditor } from "@blocknote/core";
import { createReactInlineContentSpec } from "@blocknote/react";
import { ExternalLink, FileText } from "lucide-react";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { FloatingPopover } from "../components/FloatingPopover";
import type { Page } from "./db";

export const OPEN_PAGE_LINK_EVENT = "opennotion:open-page-link";

type PageLinkProps = {
  pageId: string;
  title: string;
  icon: string;
  kind: string;
  label: string;
};

function pageKindLabel(kind: string): string {
  return kind === "studio_note" ? "Studio note" : "Note";
}

function dispatchOpenPage(pageId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PAGE_LINK_EVENT, { detail: { pageId } }));
}

function clearTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

export const PageLinkInlineContent = createReactInlineContentSpec(
  {
    type: "pageLink",
    content: "none",
    propSchema: {
      pageId: {
        default: "",
      },
      title: {
        default: "Untitled",
      },
      icon: {
        default: "",
      },
      kind: {
        default: "note",
      },
      label: {
        default: "",
      },
    },
  },
  {
    render: ({ inlineContent, updateInlineContent, contentRef }) => {
      const props = inlineContent.props as PageLinkProps;
      const title = props.title || "Untitled";
      const label = props.label || title;
      const icon = props.icon || "";
      const [isOpen, setIsOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      const closeTimerRef = useRef<number | null>(null);

      useEffect(() => () => clearTimer(closeTimerRef), []);

      const openPreview = () => {
        clearTimer(closeTimerRef);
        setIsOpen(true);
      };

      const closePreviewSoon = () => {
        clearTimer(closeTimerRef);
        closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 140);
      };

      const updateProps = (updates: Partial<PageLinkProps>) => {
        updateInlineContent({
          type: "pageLink",
          props: {
            ...props,
            ...updates,
          },
        });
      };

      return (
        <span
          ref={contentRef}
          className="on-page-link-shell"
          onMouseEnter={openPreview}
          onMouseLeave={closePreviewSoon}
        >
          <button
            ref={triggerRef}
            type="button"
            className="on-page-link"
            title={title}
            aria-label={`Page link: ${label}`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openPreview();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                dispatchOpenPage(props.pageId);
                setIsOpen(false);
              }
            }}
          >
            {icon ? (
              <span className="on-page-link-icon-text">{icon}</span>
            ) : (
              <FileText className="on-page-link-icon" />
            )}
            <span className="on-page-link-label">{label}</span>
          </button>
          <FloatingPopover
            anchorElement={triggerRef.current}
            open={isOpen}
            width={280}
            zIndex={230}
            onOpenChange={setIsOpen}
            className="on-page-link-popover"
          >
            <div
              className="on-page-link-popover-panel"
              onMouseEnter={openPreview}
              onMouseLeave={closePreviewSoon}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="on-page-link-preview-row">
                <div className="on-page-link-preview-icon">
                  {icon ? <span>{icon}</span> : <FileText className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{label}</div>
                  <div className="truncate text-xs text-muted-foreground">{pageKindLabel(props.kind)}</div>
                </div>
                <button
                  type="button"
                  className="on-page-link-open"
                  title="Open page"
                  onClick={() => {
                    dispatchOpenPage(props.pageId);
                    setIsOpen(false);
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                className="on-page-link-input"
                value={props.label}
                placeholder={title}
                aria-label="Page link label"
                spellCheck={false}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") setIsOpen(false);
                }}
                onChange={(event) => updateProps({ label: event.currentTarget.value })}
              />
              <input
                className="on-page-link-input on-page-link-icon-input"
                value={props.icon}
                placeholder="Icon"
                aria-label="Page link icon"
                spellCheck={false}
                maxLength={4}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") setIsOpen(false);
                }}
                onChange={(event) => updateProps({ icon: event.currentTarget.value })}
              />
            </div>
          </FloatingPopover>
        </span>
      );
    },
    toExternalHTML: ({ inlineContent, contentRef }) => {
      const props = inlineContent.props as PageLinkProps;
      const label = props.label || props.title || "Untitled";

      return (
        <span
          ref={contentRef}
          className="on-page-link"
          data-page-id={props.pageId}
          data-page-title={props.title}
          data-page-icon={props.icon}
          data-page-kind={props.kind}
          data-page-label={props.label}
        >
          {label}
        </span>
      );
    },
    parse: (element) => {
      if (!(element instanceof HTMLElement)) return undefined;
      const pageId = element.dataset.pageId;
      if (!pageId) return undefined;

      return {
        pageId,
        title: element.dataset.pageTitle || element.textContent || "Untitled",
        icon: element.dataset.pageIcon || "",
        kind: element.dataset.pageKind || "note",
        label: element.dataset.pageLabel || "",
      };
    },
  }
);

export function insertPageLinkInlineContent(editor: BlockNoteEditor<any, any, any>, page: Page) {
  editor.insertInlineContent(
    [
      {
        type: "pageLink",
        props: {
          pageId: page.id,
          title: page.title || "Untitled",
          icon: page.icon || "",
          kind: page.page_kind,
          label: "",
        },
      },
      " ",
    ] as never,
    { updateSelection: true }
  );
}
