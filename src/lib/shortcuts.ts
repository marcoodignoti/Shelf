import type { TranslationKey } from "./i18n";

type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export function isNewPageShortcut(event: ShortcutEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "n";
}

export interface ShortcutEntry {
  labelKey: TranslationKey;
  keys: string[]; // display strings, e.g. ["⌥", "↵"]
}

export interface ShortcutGroup {
  titleKey: TranslationKey;
  shortcuts: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcuts.group.general",
    shortcuts: [
      {
        labelKey: "shortcuts.openCommandPalette",
        keys: ["⌘", "K"],
      },
      {
        labelKey: "shortcuts.newPage",
        keys: ["⌘", "N"],
      },
      {
        labelKey: "shortcuts.closeOverlay",
        keys: ["Esc"],
      },
    ],
  },
  {
    titleKey: "shortcuts.group.editing",
    shortcuts: [
      {
        labelKey: "shortcuts.titleMoveToBody",
        keys: ["↵"],
      },
      {
        labelKey: "shortcuts.titleInsertLineBreak",
        keys: ["⌥", "↵"],
      },
      {
        labelKey: "shortcuts.selectAllBlocks",
        keys: ["⌘", "A"],
      },
      {
        labelKey: "shortcuts.forceSave",
        keys: ["⌘", "S"],
      },
    ],
  },
  {
    titleKey: "shortcuts.group.navigation",
    shortcuts: [
      {
        labelKey: "shortcuts.sidebarNavUp",
        keys: ["↑"],
      },
      {
        labelKey: "shortcuts.sidebarNavDown",
        keys: ["↓"],
      },
      {
        labelKey: "shortcuts.sidebarExpandOrEnter",
        keys: ["→"],
      },
      {
        labelKey: "shortcuts.sidebarCollapseOrParent",
        keys: ["←"],
      },
      {
        labelKey: "shortcuts.sidebarRename",
        keys: ["↵"],
      },
      {
        labelKey: "shortcuts.sidebarDeletePage",
        keys: ["⌘", "⌫"],
      },
    ],
  },
  {
    titleKey: "shortcuts.group.studio",
    shortcuts: [
      {
        labelKey: "shortcuts.pdfPreviousPage",
        keys: ["←"],
      },
      {
        labelKey: "shortcuts.pdfNextPage",
        keys: ["→"],
      },
      {
        labelKey: "shortcuts.pdfContinuousScroll",
        keys: ["⌘", "1"],
      },
      {
        labelKey: "shortcuts.pdfSinglePage",
        keys: ["⌘", "2"],
      },
      {
        labelKey: "shortcuts.pdfTwoPages",
        keys: ["⌘", "3"],
      },
    ],
  },
];
