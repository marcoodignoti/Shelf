import type { ReactElement } from "react";
import type { BlockNoteEditor } from "@blocknote/core";

type Component = (props?: Record<string, unknown>) => ReactElement;
type ReactSpecImplementation = {
  render?: (props: any) => ReactElement;
  toExternalHTML?: (props: any) => ReactElement;
  parse?: (element: HTMLElement) => any;
  [key: string]: any;
};

export type DefaultReactSuggestionItem = {
  title: string;
  [key: string]: any;
};

export const AddBlockButton: Component;
export const FormattingToolbar: Component;
export const FormattingToolbarController: Component;
export const SideMenu: Component;
export const SideMenuController: Component;
export const SuggestionMenuController: Component;

export function blockTypeSelectItems(dictionary?: unknown): any[];

export function createReactBlockSpec(config: Record<string, any>, implementation: ReactSpecImplementation): any;
export function createReactInlineContentSpec(config: Record<string, any>, implementation: ReactSpecImplementation): any;
export function getDefaultReactSlashMenuItems(editor: unknown): DefaultReactSuggestionItem[];
export function getFormattingToolbarItems(items?: unknown[]): any[];
export function useBlockNoteEditor<
  BSchema = unknown,
  ISchema = unknown,
  SSchema = unknown,
>(): BlockNoteEditor<BSchema, ISchema, SSchema>;
export function useEditorState<T>(options: {
  editor: BlockNoteEditor;
  selector: (options: { editor: BlockNoteEditor }) => T;
  equalityFn?: (a: T, b: T | null) => boolean;
  on?: "all" | "mount" | "selection" | "change";
}): T;
export function useEditorState<T>(selector: (editor: BlockNoteEditor) => T): T;
export function useExtensionState<T = any>(
  extension: unknown,
  options?: {
    editor?: BlockNoteEditor;
    selector?: (state: any) => T;
  },
): T;
