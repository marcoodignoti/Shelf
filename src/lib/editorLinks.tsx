import { BlockNoteEditor } from "@blocknote/core";
import { createReactInlineContentSpec } from "@blocknote/react";
import { FileText, Smile } from "lucide-react";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { FloatingPopover } from "../components/FloatingPopover";
import type { Page } from "./db";
import { invoke } from "./desktop";
import { useT, type TranslationKey } from "./i18n";
import { normalizePageIcon } from "./pageMetadata";

export const OPEN_PAGE_LINK_EVENT = "opennotion:open-page-link";

type PageLinkProps = {
  pageId: string;
  title: string;
  icon: string;
  iconOverride?: string;
  kind: string;
  label: string;
};

function pageKindLabel(kind: string, t: (key: TranslationKey) => string): string {
  return kind === "studio_note" ? t("editor.pageLinkKindStudio") : t("editor.pageLinkKindNote");
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
      iconOverride: {
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
    render: ({ inlineContent, updateInlineContent }) => {
      const t = useT();
      const props = inlineContent.props as PageLinkProps;
      const title = props.title || t("sidebar.untitled");
      const label = props.label || title;
      const icon = props.iconOverride || props.icon || "";
      const [isOpen, setIsOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      const iconInputRef = useRef<HTMLInputElement>(null);
      const closeTimerRef = useRef<number | null>(null);
      const suppressPreviewRef = useRef(false);

      useEffect(() => () => clearTimer(closeTimerRef), []);

      const openPreview = () => {
        if (suppressPreviewRef.current) return;
        clearTimer(closeTimerRef);
        setIsOpen(true);
      };

      const closePreviewSoon = () => {
        suppressPreviewRef.current = false;
        clearTimer(closeTimerRef);
        closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 140);
      };

      const openPage = () => {
        suppressPreviewRef.current = true;
        clearTimer(closeTimerRef);
        setIsOpen(false);
        dispatchOpenPage(props.pageId);
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

      const updateIconOverride = (value: string) => {
        updateProps({ iconOverride: normalizePageIcon(value) || "" });
      };

      const openNativeIconPicker = () => {
        const input = iconInputRef.current;
        input?.focus();
        input?.setSelectionRange(0, input.value.length);
        void invoke("show_character_palette").catch((error: unknown) => {
          console.error("Failed to open character palette:", error);
        });
      };

      return (
        // No contentRef: content "none" (leaf) spec. A content hole on a leaf
        // node makes ProseMirror's clipboard serializer throw on copy.
        <span
          className="on-page-link-shell"
          onMouseEnter={openPreview}
          onMouseLeave={closePreviewSoon}
        >
          <button
            ref={triggerRef}
            type="button"
            className="on-page-link"
            title={title}
            aria-label={t("editor.pageLinkAriaLabel", { label })}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openPage();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                openPage();
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
            width={260}
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
                <button
                  type="button"
                  className="on-page-link-preview-icon"
                  title={t("editor.changeLinkIcon")}
                  onClick={openNativeIconPicker}
                >
                  {icon ? <span>{icon}</span> : <FileText className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{label}</div>
                  <div className="truncate text-xs text-muted-foreground">{pageKindLabel(props.kind, t)}</div>
                </div>
              </div>
              <div className="on-page-link-fields">
                <input
                  className="on-page-link-input"
                  value={props.label}
                  placeholder={title}
                  aria-label={t("editor.pageLinkLabelAriaLabel")}
                  spellCheck={false}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") setIsOpen(false);
                  }}
                  onChange={(event) => updateProps({ label: event.currentTarget.value })}
                />
                <div className="on-page-link-icon-row">
                  <button
                    type="button"
                    className="on-page-link-picker-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={openNativeIconPicker}
                  >
                    <Smile className="h-3.5 w-3.5" />
                    <span>{t("editor.nativePicker")}</span>
                  </button>
                  <input
                    ref={iconInputRef}
                    className="on-page-link-input on-page-link-icon-input"
                    value={icon}
                    placeholder={t("editor.pageLinkIconPlaceholder")}
                    aria-label={t("editor.pageLinkIconAriaLabel")}
                    spellCheck={false}
                    maxLength={4}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape") setIsOpen(false);
                    }}
                    onChange={(event) => updateIconOverride(event.currentTarget.value)}
                  />
                </div>
              </div>
            </div>
          </FloatingPopover>
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => {
      const props = inlineContent.props as PageLinkProps;
      const label = props.label || props.title || "Untitled";

      return (
        // No contentRef: leaf spec, see the note in render above.
        <span
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
          iconOverride: "",
          kind: page.page_kind,
          label: "",
        },
      },
      " ",
    ] as never,
    { updateSelection: true }
  );
}

export function syncPageLinkInlineContentInEditor(editor: BlockNoteEditor<any, any, any>, pages: Page[]): boolean {
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  let changed = false;

  const syncBlocks = (blocks: Array<any>) => {
    for (const block of blocks) {
      if (Array.isArray(block.content)) {
        let contentChanged = false;
        const nextContent = block.content.map((item: unknown) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          const inline = item as { type?: string; props?: Record<string, unknown> };
          if (inline.type !== "pageLink" || !inline.props || typeof inline.props.pageId !== "string") return item;

          const page = pagesById.get(inline.props.pageId);
          if (!page) return item;

          const nextProps = {
            ...inline.props,
            title: page.title || "Untitled",
            icon: page.icon || "",
            kind: page.page_kind,
          };
          if (
            nextProps.title === inline.props.title &&
            nextProps.icon === inline.props.icon &&
            nextProps.kind === inline.props.kind
          ) {
            return item;
          }

          contentChanged = true;
          return { ...inline, props: nextProps };
        });

        if (contentChanged) {
          changed = true;
          editor.updateBlock(block, { content: nextContent } as never);
        }
      }
      if (Array.isArray(block.children)) syncBlocks(block.children);
    }
  };

  syncBlocks(editor.document as Array<any>);
  return changed;
}
