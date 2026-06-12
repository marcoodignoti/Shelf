# Settings Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rinnovare il modal Impostazioni: i18n IT/EN completo, font/larghezza/Enter editor reali, sezioni Aspetto/Scorciatoie/Info, profilo Account persistito in SQLite, polish UI.

**Architecture:** i18n fatto in casa con dizionari tipizzati (`en` fonte di verità dei tipi); preferenze dispositivo in localStorage via Zustand (pattern `setTheme`); profilo workspace in `app_metadata` via nuovi comandi backend; `SettingsModal` splittato in `src/components/settings/`.

**Tech Stack:** React 19 + TypeScript + Zustand + BlockNote 0.51 (locale `it` incluso), Electron + better-sqlite3, Vitest (`src/**` only), Playwright e2e (mock `window.openNotion` per-spec), `electron/smoke.cjs` per i test backend.

**Spec:** `docs/superpowers/specs/2026-06-10-settings-overhaul-design.md`

**Branch:** `settings-overhaul` (già creato).

---

## Fatti di codebase (verificati, non riscoprire)

- Tema: `src/store/useAppStore.ts:98` (`getStoredTheme`), `:776` (`setTheme` → localStorage `opennotion-theme`); applicato al DOM in `src/App.tsx:44-59` (`root.classList`).
- Optimistic update di riferimento: `useAppStore.ts:621-634` (`renamePageAction`: muta stato → wrapper → catch rollback).
- IPC: `src/lib/desktop.ts:76` `invoke<T>(command, args)`; preload `electron/preload.cjs:36-84`; dispatch `electron/main.cjs:598-607`; mappa comandi backend `electron/backend.cjs:662-705`.
- Wrapper tipizzati: `src/lib/db.ts:29-31` (`getPages`) come esempio; regola repo: mai `invoke` nei componenti.
- `app_metadata`: creazione `backend.cjs:70-73`; lettura/scrittura esempio `:191-200`, `:259-264`.
- Avatar riusa il validatore cover: `backend.cjs:1507-1517` (`importCoverImage`, `validatedCoverExtension`, `COVER_IMAGE_MAX_BYTES` = 10MB, riga 10).
- Backup: `backend.cjs:1068-1091`, formato `{ version: 1, exported_at, pages }`.
- Test backend: `electron/smoke.cjs` (`new ShelfBackend({ appConfigDir: tempRoot, updateManifestPublicKey })`, righe 5-10), eseguito da `npm run electron:smoke` e `electron:smoke:runtime`.
- BlockNote: creato in `src/components/PageEditor.tsx:986` (`BlockNoteEditor.create({...})`); locale it in `@blocknote/core` (export `locales`).
- Titolo, Enter: `PageEditor.tsx:1322` (`handleTitleKeyDown`): oggi Enter → blur+focus editor, Alt/Shift+Enter → newline.
- Larghezza contenuto editor: `PageEditor.tsx:2095` `max-w-3xl px-8 pt-8 mx-auto`.
- Settings modal: `src/components/SettingsModal.tsx` (320 righe, 3 sezioni); aperto da `Sidebar.tsx:1439`; nome "Marco" hardcoded a `SettingsModal.tsx:130`.
- Toast: `src/components/AppNotice.tsx`; `showSuccess`/`showError` in store `:227-228`.
- e2e: ogni spec costruisce il proprio mock `window.openNotion` in `addInitScript` (vedi `tests/e2e/no-ai.e2e.ts:3-29`); settings si apre con `page.getByRole("button", { name: "Settings" })`; Playwright senza locale custom → `en-US`.
- Vitest: `environment: "node"`, include solo `src/**/*.test.{ts,tsx}`.

## Mappa file

| File | Azione | Responsabilità |
|---|---|---|
| `src/lib/preferences.ts` (+test) | Create | Tipi preferenze dispositivo, parse con fallback, chiavi localStorage |
| `src/lib/locales/en.ts`, `it.ts` | Create | Dizionari (en = fonte dei tipi) |
| `src/lib/i18n.ts` (+test) | Create | `Locale`, `resolveLocale`, `t()`, `useT()` |
| `src/lib/shortcuts.ts` (+test) | Create | Costante tipizzata scorciatoie |
| `src/lib/profile.ts` | Create | Wrapper tipizzati comandi profilo |
| `src/store/useAppStore.ts` | Modify | Stato preferenze + profilo, azioni |
| `src/App.tsx` | Modify | `<html lang>`, già fa il tema |
| `src/index.css` | Modify | Classi font/size/width, polish settings |
| `electron/backend.cjs` | Modify | 3 comandi profilo, profilo nel backup |
| `electron/smoke.cjs` | Modify | Copertura comandi profilo |
| `src/components/settings/*.tsx` | Create | Un file per pannello (7 sezioni) |
| `src/components/SettingsModal.tsx` | Modify | Shell: nav + routing sezioni |
| `src/components/PageEditor.tsx` | Modify | Dictionary BlockNote, Enter titolo, classi font/width |
| `src/components/Sidebar.tsx` → vari | Modify | Rollout i18n (task 9-12) |
| `tests/e2e/settings.e2e.ts` | Create | e2e impostazioni |

---

### Task 1: Preferenze dispositivo — `src/lib/preferences.ts`

**Files:**
- Create: `src/lib/preferences.ts`
- Test: `src/lib/preferences.test.ts`

- [ ] **Step 1: Test fallente**

```ts
// src/lib/preferences.test.ts
import { describe, expect, it } from "vitest";
import {
  PREFERENCE_STORAGE_KEYS,
  parseEditorFont,
  parseEditorFontSize,
  parseLocalePreference,
  parsePageWidth,
  parseTitleEnterBehavior,
} from "./preferences";

describe("preferences parsing", () => {
  it("accepts valid values", () => {
    expect(parseEditorFont("serif")).toBe("serif");
    expect(parseEditorFontSize("large")).toBe("large");
    expect(parsePageWidth("full")).toBe("full");
    expect(parseTitleEnterBehavior("newline")).toBe("newline");
    expect(parseLocalePreference("it")).toBe("it");
  });

  it("falls back to defaults on unknown or null input", () => {
    expect(parseEditorFont("comic-sans")).toBe("sans");
    expect(parseEditorFont(null)).toBe("sans");
    expect(parseEditorFontSize("xl")).toBe("default");
    expect(parsePageWidth("")).toBe("centered");
    expect(parseTitleEnterBehavior(undefined)).toBe("body");
    expect(parseLocalePreference("fr")).toBe("system");
  });

  it("exposes stable storage keys", () => {
    expect(PREFERENCE_STORAGE_KEYS.locale).toBe("opennotion-locale");
    expect(PREFERENCE_STORAGE_KEYS.editorFont).toBe("shelf-editor-font");
    expect(PREFERENCE_STORAGE_KEYS.editorFontSize).toBe("shelf-editor-font-size");
    expect(PREFERENCE_STORAGE_KEYS.pageWidth).toBe("opennotion-page-width");
    expect(PREFERENCE_STORAGE_KEYS.titleEnter).toBe("opennotion-title-enter");
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `npx vitest run src/lib/preferences.test.ts`
Atteso: FAIL — modulo `./preferences` inesistente.

- [ ] **Step 3: Implementazione**

```ts
// src/lib/preferences.ts
export type LocalePreference = "system" | "en" | "it";
export type EditorFont = "sans" | "serif" | "mono";
export type EditorFontSize = "small" | "default" | "large";
export type PageWidth = "centered" | "full";
export type TitleEnterBehavior = "body" | "newline";

export const PREFERENCE_STORAGE_KEYS = {
  locale: "opennotion-locale",
  editorFont: "shelf-editor-font",
  editorFontSize: "shelf-editor-font-size",
  pageWidth: "opennotion-page-width",
  titleEnter: "opennotion-title-enter",
} as const;

function parseChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function parseLocalePreference(value: unknown): LocalePreference {
  return parseChoice(value, ["system", "en", "it"], "system");
}

export function parseEditorFont(value: unknown): EditorFont {
  return parseChoice(value, ["sans", "serif", "mono"], "sans");
}

export function parseEditorFontSize(value: unknown): EditorFontSize {
  return parseChoice(value, ["small", "default", "large"], "default");
}

export function parsePageWidth(value: unknown): PageWidth {
  return parseChoice(value, ["centered", "full"], "centered");
}

export function parseTitleEnterBehavior(value: unknown): TitleEnterBehavior {
  return parseChoice(value, ["body", "newline"], "body");
}
```

- [ ] **Step 4: Verifica pass**

Run: `npx vitest run src/lib/preferences.test.ts`
Atteso: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/preferences.ts src/lib/preferences.test.ts
git commit -m "feat: add typed device preference parsing"
```

---

### Task 2: i18n core — dizionari + `t()`

**Files:**
- Create: `src/lib/locales/en.ts`, `src/lib/locales/it.ts`, `src/lib/i18n.ts`
- Test: `src/lib/i18n.test.ts`

I dizionari partono con le chiavi comuni + settings; i task 8-12 aggiungono le restanti. Chiavi piatte `area.sottoarea.nome`.

- [ ] **Step 1: Test fallente**

```ts
// src/lib/i18n.test.ts
import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { it as itDict } from "./locales/it";
import { resolveLocale, translate } from "./i18n";

describe("translate", () => {
  it("returns the english string for en", () => {
    expect(translate("en", "settings.nav.preferences")).toBe("Preferences");
  });

  it("returns the italian string for it", () => {
    expect(translate("it", "settings.nav.preferences")).toBe("Preferenze");
  });

  it("interpolates {params}", () => {
    expect(translate("en", "settings.data.exported", { count: "3" })).toBe("Exported 3 pages.");
  });

  it("falls back to english when an it value is empty at runtime", () => {
    const broken = { ...itDict, "settings.nav.preferences": "" };
    expect(translate("it", "settings.nav.preferences", undefined, broken)).toBe("Preferences");
  });

  it("italian dictionary covers every english key", () => {
    for (const key of Object.keys(en)) {
      expect(itDict[key as keyof typeof en], `missing it key: ${key}`).toBeTruthy();
    }
  });
});

describe("resolveLocale", () => {
  it("passes through explicit locales", () => {
    expect(resolveLocale("en", "it-IT")).toBe("en");
    expect(resolveLocale("it", "en-US")).toBe("it");
  });

  it("resolves system from the navigator language", () => {
    expect(resolveLocale("system", "it-IT")).toBe("it");
    expect(resolveLocale("system", "it")).toBe("it");
    expect(resolveLocale("system", "en-US")).toBe("en");
    expect(resolveLocale("system", "de-DE")).toBe("en");
    expect(resolveLocale("system", undefined)).toBe("en");
  });
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `npx vitest run src/lib/i18n.test.ts`
Atteso: FAIL — moduli inesistenti.

- [ ] **Step 3: Implementazione**

```ts
// src/lib/locales/en.ts — fonte di verità dei tipi. Solo chiavi iniziali; i task successivi ne aggiungono.
export const en = {
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "settings.nav.account": "Account",
  "settings.nav.workspace": "Workspace",
  "settings.nav.profile": "Profile",
  "settings.nav.preferences": "Preferences",
  "settings.nav.appearance": "Appearance",
  "settings.nav.shortcuts": "Shortcuts",
  "settings.nav.updates": "Updates",
  "settings.nav.data": "Import / Export",
  "settings.nav.about": "About",
  "settings.data.exported": "Exported {count} pages.",
} as const;
```

```ts
// src/lib/locales/it.ts
import type { en } from "./en";

export const it: Record<keyof typeof en, string> = {
  "common.cancel": "Annulla",
  "common.save": "Salva",
  "common.close": "Chiudi",
  "settings.nav.account": "Account",
  "settings.nav.workspace": "Spazio di lavoro",
  "settings.nav.profile": "Profilo",
  "settings.nav.preferences": "Preferenze",
  "settings.nav.appearance": "Aspetto",
  "settings.nav.shortcuts": "Scorciatoie",
  "settings.nav.updates": "Aggiornamenti",
  "settings.nav.data": "Importa / Esporta",
  "settings.nav.about": "Informazioni",
  "settings.data.exported": "Esportate {count} pagine.",
};
```

```ts
// src/lib/i18n.ts
import { en } from "./locales/en";
import { it } from "./locales/it";
import type { LocalePreference } from "./preferences";

export type Locale = "en" | "it";
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string>;

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, it };

export function resolveLocale(preference: LocalePreference, navigatorLanguage: string | undefined): Locale {
  if (preference === "en" || preference === "it") return preference;
  return navigatorLanguage?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
  dictionaryOverride?: Record<TranslationKey, string>,
): string {
  const dictionary = dictionaryOverride ?? dictionaries[locale];
  const template = dictionary[key] || en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
}
```

(`useT()` arriva nel Task 3 insieme allo stato locale nello store: l'hook dipende da Zustand.)

- [ ] **Step 4: Verifica pass**

Run: `npx vitest run src/lib/i18n.test.ts`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/locales src/lib/i18n.ts src/lib/i18n.test.ts
git commit -m "feat: add typed homegrown i18n core (en/it)"
```

---

### Task 3: Stato preferenze nello store + `useT()`

**Files:**
- Modify: `src/store/useAppStore.ts` (interfaccia `AppState` righe 34-88, init riga ~159, azioni vicino a `setTheme` riga 776)
- Modify: `src/lib/i18n.ts` (aggiunge `useT`)

Pattern identico a `theme`/`setTheme` (lettura sincrona, setter scrive localStorage + state). Niente test unit dedicati per il wiring Zustand (coperto da e2e Task 13); le funzioni pure sono già testate nei Task 1-2.

- [ ] **Step 1: Stato + getter iniziali nello store**

In `useAppStore.ts`, accanto a `getStoredTheme` (riga 98):

```ts
import {
  PREFERENCE_STORAGE_KEYS,
  parseEditorFont,
  parseEditorFontSize,
  parseLocalePreference,
  parsePageWidth,
  parseTitleEnterBehavior,
  type EditorFont,
  type EditorFontSize,
  type LocalePreference,
  type PageWidth,
  type TitleEnterBehavior,
} from "../lib/preferences";

const getStoredPreference = <T>(key: string, parse: (value: unknown) => T): T =>
  parse(localStorage.getItem(key));
```

In `AppState` (dopo `theme`/`setTheme`):

```ts
localePreference: LocalePreference;
editorFont: EditorFont;
editorFontSize: EditorFontSize;
pageWidth: PageWidth;
titleEnterBehavior: TitleEnterBehavior;
setLocalePreference: (value: LocalePreference) => void;
setEditorFont: (value: EditorFont) => void;
setEditorFontSize: (value: EditorFontSize) => void;
setPageWidth: (value: PageWidth) => void;
setTitleEnterBehavior: (value: TitleEnterBehavior) => void;
```

Init (accanto a `theme: getStoredTheme()`):

```ts
localePreference: getStoredPreference(PREFERENCE_STORAGE_KEYS.locale, parseLocalePreference),
editorFont: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFont, parseEditorFont),
editorFontSize: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFontSize, parseEditorFontSize),
pageWidth: getStoredPreference(PREFERENCE_STORAGE_KEYS.pageWidth, parsePageWidth),
titleEnterBehavior: getStoredPreference(PREFERENCE_STORAGE_KEYS.titleEnter, parseTitleEnterBehavior),
```

Azioni (accanto a `setTheme`, stesso schema):

```ts
setLocalePreference: (value) => {
  localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, value);
  set({ localePreference: value });
},
setEditorFont: (value) => {
  localStorage.setItem(PREFERENCE_STORAGE_KEYS.editorFont, value);
  set({ editorFont: value });
},
setEditorFontSize: (value) => {
  localStorage.setItem(PREFERENCE_STORAGE_KEYS.editorFontSize, value);
  set({ editorFontSize: value });
},
setPageWidth: (value) => {
  localStorage.setItem(PREFERENCE_STORAGE_KEYS.pageWidth, value);
  set({ pageWidth: value });
},
setTitleEnterBehavior: (value) => {
  localStorage.setItem(PREFERENCE_STORAGE_KEYS.titleEnter, value);
  set({ titleEnterBehavior: value });
},
```

- [ ] **Step 2: `useT()` in `src/lib/i18n.ts`**

```ts
import { useAppStore } from "../store/useAppStore";

export function useLocale(): Locale {
  const preference = useAppStore((state) => state.localePreference);
  return resolveLocale(preference, typeof navigator !== "undefined" ? navigator.language : undefined);
}

export function useT(): (key: TranslationKey, params?: TranslationParams) => string {
  const locale = useLocale();
  return (key, params) => translate(locale, key, params);
}
```

Attenzione import circolare: `useAppStore.ts` importa solo da `preferences.ts`, mai da `i18n.ts`. `i18n.ts` importa lo store. Direzione unica, nessun ciclo.

- [ ] **Step 3: `<html lang>` in `src/App.tsx`**

Accanto all'effect del tema (righe 44-59):

```ts
const localePreference = useAppStore((state) => state.localePreference);

useEffect(() => {
  document.documentElement.lang = resolveLocale(localePreference, navigator.language);
}, [localePreference]);
```

(import `resolveLocale` da `./lib/i18n`.)

- [ ] **Step 4: Verifica**

Run: `npm test && npm run build`
Atteso: PASS, build pulita (lo store compila, nessun ciclo di import).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/lib/i18n.ts src/App.tsx
git commit -m "feat: wire device preferences and locale into the store"
```

---

### Task 4: Applicare font / dimensione / larghezza / Enter / dictionary all'editor

**Files:**
- Modify: `src/index.css` (nuove classi)
- Modify: `src/components/PageEditor.tsx` (riga 986 creazione editor, riga 1322 `handleTitleKeyDown`, riga 2095 contenitore larghezza, riga 2272 textarea titolo)

- [ ] **Step 1: Classi CSS in `src/index.css`**

```css
/* Editor typography preferences */
.on-editor-font-sans { --on-editor-font: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
.on-editor-font-serif { --on-editor-font: "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif; }
.on-editor-font-mono { --on-editor-font: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.on-editor-size-small { --on-editor-scale: 0.9; }
.on-editor-size-default { --on-editor-scale: 1; }
.on-editor-size-large { --on-editor-scale: 1.125; }

.on-editor-typography .bn-editor {
  font-family: var(--on-editor-font);
  font-size: calc(1em * var(--on-editor-scale));
}
.on-editor-typography .on-page-title-input {
  font-family: var(--on-editor-font);
}
```

Verifica il selettore del contenuto BlockNote prima di committare: ispeziona il DOM reso (atteso `.bn-editor` dentro il container BlockNote 0.51) e la classe effettiva della textarea del titolo a `PageEditor.tsx:2272` — se la textarea non ha una classe dedicata, aggiungi `on-page-title-input` alla sua `className`.

- [ ] **Step 2: Applicare classi in `PageEditor.tsx`**

Leggi dallo store: `const { editorFont, editorFontSize, pageWidth, titleEnterBehavior } = useAppStore();` (aggiungi ai selettori già presenti).

Contenitore riga 2095, da:

```tsx
<div className="max-w-3xl px-8 pt-8 mx-auto">
```

a:

```tsx
<div className={`${pageWidth === "full" ? "max-w-none" : "max-w-3xl"} px-8 pt-8 mx-auto on-editor-typography on-editor-font-${editorFont} on-editor-size-${editorFontSize}`}>
```

- [ ] **Step 3: Comportamento Enter titolo (riga 1322)**

Semantica: `body` (default) = comportamento attuale (Enter → corpo pagina, Alt/Shift+Enter → a capo); `newline` = invertito (Enter → a capo, Alt+Enter → corpo pagina). In `handleTitleKeyDown`, sostituisci la condizione attuale su `event.altKey || event.shiftKey` con:

```ts
const insertsNewline =
  titleEnterBehavior === "newline"
    ? !event.altKey
    : event.altKey || event.shiftKey;
```

e usa `insertsNewline` per scegliere tra inserimento `\n` e blur+focus editor (la logica dei due rami resta quella esistente).

- [ ] **Step 4: Dictionary BlockNote (riga 986)**

```ts
import { locales as blockNoteLocales } from "@blocknote/core";
import { useLocale } from "../lib/i18n";

const locale = useLocale();
```

Nel punto in cui l'editor viene creato (memo/effect attorno a riga 986), aggiungi `dictionary: locale === "it" ? blockNoteLocales.it : blockNoteLocales.en` alle opzioni di `BlockNoteEditor.create({...})` e includi `locale` nelle dipendenze della creazione, così il cambio lingua ricrea l'editor. Prima della ricreazione fai flush del salvataggio pendente con il meccanismo esistente (`queueSave`/`editorSaveState` — vedi come fa il cambio pagina nello stesso file) per non perdere modifiche in volo.

- [ ] **Step 5: Verifica manuale + unit**

Run: `npm test` → PASS.
Run: `npm run electron:dev` → cambia font/dimensione/larghezza da console (`localStorage.setItem("shelf-editor-font","serif"); location.reload()`): l'editor cambia. Titolo: Enter va al corpo; con `opennotion-title-enter=newline` Enter inserisce a capo.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/components/PageEditor.tsx
git commit -m "feat: apply font, width, title-enter and BlockNote locale preferences"
```

---

### Task 5: Scorciatoie — `src/lib/shortcuts.ts`

**Files:**
- Create: `src/lib/shortcuts.ts`
- Test: `src/lib/shortcuts.test.ts`

- [ ] **Step 1: Censire le scorciatoie reali**

Run: `grep -rn "metaKey\|ctrlKey\|altKey\|key ===" src/components src/App.tsx src/lib --include="*.tsx" --include="*.ts" | grep -v test | grep -v node_modules`

Costruisci l'elenco SOLO da ciò che esiste davvero (niente scorciatoie inventate). Note già accertate: Alt/Shift+Enter nel titolo, Escape per chiudere overlay, click "Search" apre la command palette.

- [ ] **Step 2: Test fallente**

```ts
// src/lib/shortcuts.test.ts
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "./shortcuts";

describe("SHORTCUT_GROUPS", () => {
  it("has at least one group with at least one shortcut each", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const group of SHORTCUT_GROUPS) {
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it("uses translation keys for every label", () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.titleKey.startsWith("shortcuts.")).toBe(true);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.labelKey.startsWith("shortcuts.")).toBe(true);
        expect(shortcut.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate key combos within a group", () => {
    for (const group of SHORTCUT_GROUPS) {
      const combos = group.shortcuts.map((s) => s.keys.join("+"));
      expect(new Set(combos).size).toBe(combos.length);
    }
  });
});
```

- [ ] **Step 3: Implementazione**

Struttura (le voci concrete vengono dal censimento dello Step 1; le chiavi `shortcuts.*` vanno aggiunte a `en.ts` e `it.ts`):

```ts
// src/lib/shortcuts.ts
import type { TranslationKey } from "./i18n";

export interface ShortcutEntry {
  labelKey: TranslationKey;
  keys: string[]; // es. ["⌥", "↵"]; su renderer si mostra ⌘/Ctrl in base a navigator.platform
}

export interface ShortcutGroup {
  titleKey: TranslationKey;
  shortcuts: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcuts.group.editing",
    shortcuts: [
      { labelKey: "shortcuts.titleNewline", keys: ["⌥", "↵"] },
      // ...voci dal censimento Step 1
    ],
  },
  // ...altri gruppi dal censimento (navigazione, overlay, Studio)
];
```

- [ ] **Step 4: Verifica pass**

Run: `npx vitest run src/lib/shortcuts.test.ts` → PASS. `npm test` → PASS (le nuove chiavi `shortcuts.*` esistono in entrambi i dizionari, il test di copertura di i18n lo garantisce).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shortcuts.ts src/lib/shortcuts.test.ts src/lib/locales
git commit -m "feat: add typed keyboard shortcut reference data"
```

---

### Task 6: Backend — comandi profilo + profilo nel backup

**Files:**
- Modify: `electron/backend.cjs` (mappa comandi riga 662-705; metodi vicino a `importCoverImage` riga 1507; `exportBackup`/`importBackup` righe 1068-1091)
- Modify: `electron/smoke.cjs` (nuovi assert)

- [ ] **Step 1: Test fallente in smoke**

In `electron/smoke.cjs`, dopo i blocchi backup esistenti (riga ~80):

```js
  const emptyProfile = await backend.invoke("get_workspace_profile");
  assert.deepStrictEqual(emptyProfile, { name: "", workspaceName: "Shelf", avatarPath: null });

  await backend.invoke("update_workspace_profile", { name: "Marco", workspaceName: "Studio Marco" });
  const updatedProfile = await backend.invoke("get_workspace_profile");
  assert.strictEqual(updatedProfile.name, "Marco");
  assert.strictEqual(updatedProfile.workspaceName, "Studio Marco");

  await assert.rejects(
    backend.invoke("update_workspace_profile", { name: "x".repeat(500) }),
    /name too long/,
  );

  const avatarSource = path.join(tempRoot, "avatar-source.png");
  fs.writeFileSync(avatarSource, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  const avatarPath = await backend.invoke("import_profile_avatar", { sourcePath: avatarSource });
  assert.ok(avatarPath.includes("avatars"));
  assert.ok(fs.existsSync(avatarPath));
  assert.strictEqual((await backend.invoke("get_workspace_profile")).avatarPath, avatarPath);

  await backend.invoke("update_workspace_profile", { avatarPath: null });
  assert.strictEqual((await backend.invoke("get_workspace_profile")).avatarPath, null);
```

E nel blocco export/import backup esistente, dopo il re-import, aggiungi:

```js
  const backupJson = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  assert.strictEqual(backupJson.profile.workspaceName, "Studio Marco");
```

Nota ordine: gli assert del profilo nel backup richiedono che l'update del profilo avvenga PRIMA della chiamata `export_backup` già presente — sposta il blocco profilo prima dell'export, oppure esegui un secondo export dedicato.

Run: `npm run electron:smoke`
Atteso: FAIL con `unknown command: get_workspace_profile`.

- [ ] **Step 2: Implementazione in `backend.cjs`**

Costanti vicino a `COVER_IMAGE_MAX_BYTES` (riga 10):

```js
const PROFILE_TEXT_MAX_LENGTH = 120;
const PROFILE_METADATA_KEYS = {
  name: "profile_name",
  workspaceName: "workspace_name",
  avatarPath: "profile_avatar_path",
};
```

Metodi (stesso stile dei vicini, vicino a `importCoverImage`):

```js
  readMetadataValue(key) {
    const row = this.db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(key);
    return row ? row.value : null;
  }

  writeMetadataValue(key, value) {
    if (value === null) {
      this.db.prepare("DELETE FROM app_metadata WHERE key = ?").run(key);
      return;
    }
    this.db
      .prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  getWorkspaceProfile() {
    return {
      name: this.readMetadataValue(PROFILE_METADATA_KEYS.name) || "",
      workspaceName: this.readMetadataValue(PROFILE_METADATA_KEYS.workspaceName) || "Shelf",
      avatarPath: this.readMetadataValue(PROFILE_METADATA_KEYS.avatarPath),
    };
  }

  updateWorkspaceProfile(args = {}) {
    if (args.name !== undefined) {
      if (typeof args.name !== "string" || args.name.length > PROFILE_TEXT_MAX_LENGTH) {
        throw new Error("profile name too long or invalid");
      }
      this.writeMetadataValue(PROFILE_METADATA_KEYS.name, args.name);
    }
    if (args.workspaceName !== undefined) {
      if (typeof args.workspaceName !== "string" || args.workspaceName.length > PROFILE_TEXT_MAX_LENGTH) {
        throw new Error("workspace name too long or invalid");
      }
      this.writeMetadataValue(PROFILE_METADATA_KEYS.workspaceName, args.workspaceName);
    }
    if (args.avatarPath === null) {
      this.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, null);
    }
    return this.getWorkspaceProfile();
  }

  importProfileAvatar(args = {}) {
    const source = args.sourcePath || args.source_path;
    // Riusa ESATTAMENTE il flusso di importCoverImage (riga 1507): stesso
    // validatore (estensione + magic bytes + COVER_IMAGE_MAX_BYTES), ma
    // destinazione `avatars/profile-${Date.now()}.${ext}` dentro appConfigDir.
    // Dopo la copia: this.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, destination);
    // return destination;
  }
```

Adatta `importProfileAvatar` al corpo reale di `importCoverImage` (riga 1507-1517): replica validazione e copia, cambia solo directory di destinazione e prefisso del filename, e persisti la chiave in `app_metadata`.

Registrazione nella mappa comandi (riga ~704, prima di `show_character_palette`):

```js
      get_workspace_profile: () => this.getWorkspaceProfile(),
      update_workspace_profile: (args) => this.updateWorkspaceProfile(args),
      import_profile_avatar: (args) => this.importProfileAvatar(args),
```

- [ ] **Step 3: Profilo nel backup**

In `exportBackup` (riga 1068-1085), aggiungi al JSON esportato (campo additivo, `version` resta `1`):

```js
      profile: (() => {
        const profile = this.getWorkspaceProfile();
        return { name: profile.name, workspaceName: profile.workspaceName };
      })(),
```

L'avatar (file binario, path locale) NON entra nel backup. In `importBackup`, dopo l'import pagine: applica `backup.profile` SOLO se il profilo corrente è ai default (`name === "" && workspaceName === "Shelf"`), così un import "as duplicates" non sovrascrive un profilo personalizzato; backup senza chiave `profile` → nessuna azione.

- [ ] **Step 4: Verifica pass**

Run: `npm run electron:smoke && npm run electron:smoke:runtime`
Atteso: PASS entrambi.

- [ ] **Step 5: Commit**

```bash
git add electron/backend.cjs electron/smoke.cjs
git commit -m "feat: add workspace profile commands and backup inclusion"
```

---

### Task 7: Wrapper profilo + stato nello store

**Files:**
- Create: `src/lib/profile.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Wrapper tipizzati**

```ts
// src/lib/profile.ts
import { invoke } from "./desktop";

export interface WorkspaceProfile {
  name: string;
  workspaceName: string;
  avatarPath: string | null;
}

export async function getWorkspaceProfile(): Promise<WorkspaceProfile> {
  return await invoke<WorkspaceProfile>("get_workspace_profile");
}

export async function updateWorkspaceProfile(
  patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null },
): Promise<WorkspaceProfile> {
  return await invoke<WorkspaceProfile>("update_workspace_profile", patch);
}

export async function importProfileAvatar(sourcePath: string): Promise<string> {
  return await invoke<string>("import_profile_avatar", { sourcePath });
}
```

- [ ] **Step 2: Stato + azioni nello store**

In `AppState`:

```ts
profile: WorkspaceProfile | null;
fetchProfile: () => Promise<void>;
updateProfileAction: (patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null }) => Promise<void>;
importProfileAvatarAction: (sourcePath: string) => Promise<void>;
```

Implementazione — `updateProfileAction` segue ESATTAMENTE il pattern optimistic di `renamePageAction` (riga 621-634):

```ts
profile: null,

fetchProfile: async () => {
  try {
    set({ profile: await getWorkspaceProfile() });
  } catch (error) {
    get().showError(error);
  }
},

updateProfileAction: async (patch) => {
  const previousProfile = get().profile;
  if (previousProfile) {
    set({ profile: { ...previousProfile, ...patch } as WorkspaceProfile });
  }
  try {
    set({ profile: await updateWorkspaceProfile(patch) });
  } catch (error) {
    set({ profile: previousProfile });
    get().showError(error);
  }
},

importProfileAvatarAction: async (sourcePath) => {
  try {
    const avatarPath = await importProfileAvatar(sourcePath);
    const current = get().profile;
    if (current) set({ profile: { ...current, avatarPath } });
  } catch (error) {
    get().showError(error);
  }
},
```

`fetchProfile()` va chiamata all'avvio: aggiungila dove lo store fa il bootstrap iniziale (accanto alla chiamata `fetchPages` in `App.tsx` o nell'init dello store — segui il punto esatto in cui `fetchPages` viene invocata al mount).

- [ ] **Step 3: Verifica**

Run: `npm test && npm run build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/profile.ts src/store/useAppStore.ts src/App.tsx
git commit -m "feat: add workspace profile state with optimistic updates"
```

---

### Task 8: Split settings in `src/components/settings/` + nuove sezioni + i18n del modal

**Files:**
- Create: `src/components/settings/ProfileSection.tsx`, `PreferencesSection.tsx`, `AppearanceSection.tsx`, `ShortcutsSection.tsx`, `UpdatesSection.tsx`, `DataSection.tsx`, `AboutSection.tsx`
- Modify: `src/components/SettingsModal.tsx` (diventa shell), `src/index.css` (polish), `src/lib/locales/en.ts` + `it.ts` (tutte le chiavi `settings.*`)

Il task più grosso. Suddivisione interna:

- [ ] **Step 1: Estrarre le sezioni esistenti senza cambiarle**

`UpdatesSection.tsx` e `DataSection.tsx`: sposta il JSX e gli handler delle attuali sezioni `updates` (righe 207-279) e `data` (righe 281-316) di `SettingsModal.tsx` in componenti dedicati con la stessa resa. Gli handler (`handleExport`, `handleImport`, `handleCheckUpdates`, `handleDownloadUpdate`) e i relativi `useState` si spostano dentro le rispettive sezioni. Firma comune: `export function UpdatesSection() { ... }` (zero props: tutto da store/lib).

Run: `npm run build && npx playwright test tests/e2e/no-ai.e2e.ts` → PASS (il modal si apre identico).

- [ ] **Step 2: Nuova nav nel guscio `SettingsModal.tsx`**

```ts
type SettingsSection = "profile" | "preferences" | "appearance" | "shortcuts" | "updates" | "data" | "about";
```

Nav (con `useT()`; gruppo Account + gruppo Workspace come da spec):

```tsx
const t = useT();
const SECTIONS: { id: SettingsSection; group: "account" | "workspace"; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { id: "profile", group: "account", labelKey: "settings.nav.profile", icon: UserCircle },
  { id: "preferences", group: "workspace", labelKey: "settings.nav.preferences", icon: SlidersHorizontal },
  { id: "appearance", group: "workspace", labelKey: "settings.nav.appearance", icon: Palette },
  { id: "shortcuts", group: "workspace", labelKey: "settings.nav.shortcuts", icon: Keyboard },
  { id: "updates", group: "workspace", labelKey: "settings.nav.updates", icon: RefreshCw },
  { id: "data", group: "workspace", labelKey: "settings.nav.data", icon: Download },
  { id: "about", group: "workspace", labelKey: "settings.nav.about", icon: Info },
];
```

Il body renderizza la sezione attiva via mappa `{profile: <ProfileSection/>, ...}[activeSection]`. La card account in cima alla sidebar legge `profile` dallo store: avatar = `<img src={fileSrc(profile.avatarPath)}>` se presente, altrimenti iniziale di `profile.name || profile.workspaceName`; titolo = `profile.workspaceName`; sottotitolo = `profile.name`. Rimuovi "Marco" hardcoded (riga 130) e la voce account finta.

- [ ] **Step 3: `ProfileSection.tsx`**

Campi: nome (input testo, commit su blur/Enter → `updateProfileAction({ name })`), nome workspace (idem), avatar (bottone "Upload" → `openDialog({ filters: [{ name: "Images", extensions: ["png","jpg","jpeg","webp","gif"] }] })` → `importProfileAvatarAction(path)`; bottone "Remove" visibile solo con avatar → `updateProfileAction({ avatarPath: null })`). Tutte le label via `t()`. Stile righe: riusa `on-settings-row` / `on-settings-group`.

- [ ] **Step 4: `AppearanceSection.tsx`**

Tre righe `on-settings-row`: tema (select esistente spostato qui da Preferences), famiglia font (select `sans/serif/mono`, ogni `<option>` con `style={{ fontFamily: ... }}` per l'anteprima dal vivo), dimensione testo (select `small/default/large`). Tutto legato alle azioni store del Task 3.

- [ ] **Step 5: `PreferencesSection.tsx`**

Tre righe: lingua (select `system/en/it` → `setLocalePreference`), Enter nei titoli (select `body/newline` → `setTitleEnterBehavior` — sostituisce la pill statica "Default"), larghezza pagina (select `centered/full` → `setPageWidth`).

- [ ] **Step 6: `ShortcutsSection.tsx`**

Renderizza `SHORTCUT_GROUPS`: per gruppo un `on-settings-group` con titolo `t(group.titleKey)` e righe label + kbd:

```tsx
{group.shortcuts.map((s) => (
  <div className="on-settings-row" key={s.labelKey}>
    <div className="on-settings-row-copy"><div>{t(s.labelKey)}</div></div>
    <span className="on-settings-kbd">{s.keys.join(" ")}</span>
  </div>
))}
```

Aggiungi `.on-settings-kbd` in `index.css` (monospace, bordo, raggio, padding 2px 6px, coerente con le variabili colore esistenti).

- [ ] **Step 7: `AboutSection.tsx`**

Righe: versione (`CURRENT_APP_VERSION` da `src/lib/betaUpdates.ts`), GitHub (bottone → `invoke` wrapper esistente per `open_external_url` — se manca un wrapper in `db.ts`/`desktop.ts`, aggiungilo in `src/lib/desktop.ts` come `openExternalUrl(url)`), percorso database (testo statico `~/Library/Application Support/org.opennotion.desktop/opennotion.db` + bottone copia), licenza (lettura statica: stringa "MIT License" + link al file su GitHub).

- [ ] **Step 8: i18n completo del modal**

Ogni stringa visibile delle 7 sezioni passa da `t()`. Aggiungi tutte le chiavi `settings.*` a `en.ts` e `it.ts` (il tipo `Record<TranslationKey, string>` di `it.ts` impedisce dimenticanze). Anche i messaggi `showSuccess`/`showError` originati dal modal (es. `settings.data.exported` con `{count}`).

- [ ] **Step 9: Verifica**

Run: `npm test && npm run build && npx playwright test tests/e2e/no-ai.e2e.ts`
Atteso: PASS. Manuale (`npm run electron:dev`): 7 sezioni navigabili, profilo editabile e persistente al riavvio, lingua IT traduce il modal all'istante.

- [ ] **Step 10: Commit**

```bash
git add src/components/settings src/components/SettingsModal.tsx src/index.css src/lib/locales src/lib/desktop.ts
git commit -m "feat: rebuild settings modal with profile, appearance, shortcuts and about sections"
```

---

### Task 9: Rollout i18n — Sidebar + HomeView

**Files:**
- Modify: `src/components/Sidebar.tsx`, `src/components/HomeView.tsx`, `src/lib/locales/en.ts`, `src/lib/locales/it.ts`

- [ ] **Step 1: Censimento stringhe dei due file**

Run: `grep -nE '>[A-Z][a-z]+|placeholder=|aria-label=|title=' src/components/Sidebar.tsx src/components/HomeView.tsx | grep -v className`

Esempi già noti in Sidebar: `Home` (riga 1241), `New page` (1252), `Search` (1301), `Templates` (1310), `Favorites` (1331).

- [ ] **Step 2: Sostituzione meccanica**

Pattern, identico per ogni stringa:

```tsx
// prima
<span>New page</span>
// dopo
<span>{t("sidebar.newPage")}</span>
```

con `const t = useT();` in cima al componente e coppia di chiavi nei due dizionari (`"sidebar.newPage": "New page"` / `"Nuova pagina"`). Vale anche per `placeholder`, `aria-label`, `title`. Date visibili (es. timestamp pagine): formattale con `new Intl.DateTimeFormat(locale).format(date)` usando `useLocale()`, non stringhe fisse. ATTENZIONE: `aria-label`/name usati dagli e2e (`"Settings"`, `"Search"`) — la stringa inglese DEVE restare identica in `en.ts`, così gli e2e (locale en-US) continuano a passare.

- [ ] **Step 3: Verifica**

Run: `npm test && npm run build && npx playwright test tests/e2e/no-ai.e2e.ts tests/e2e/subpage-order.e2e.ts`
Atteso: PASS. Poi: `grep -nE '"[A-Z][a-z]{2,}' src/components/Sidebar.tsx src/components/HomeView.tsx | grep -v className | grep -v from` → residui solo non-UI (nomi comandi, costanti).

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/components/HomeView.tsx src/lib/locales
git commit -m "feat: localize sidebar and home view"
```

---

### Task 10: Rollout i18n — chrome editor

**Files:**
- Modify: `src/components/PageEditor.tsx` (+ eventuali sotto-componenti menu/contextMenu importati), `src/lib/locales/*`

Stesso identico procedimento del Task 9 (censimento grep → sostituzione `t()` → chiavi doppie). Area chiavi: `editor.*`. NON toccare: stringhe interne BlockNote (già coperte dal dictionary del Task 4), regex/euristiche di `editorMath`, contenuto utente. Placeholder titolo, tooltip, voci menu contestuale, label dialog cover/media sì.

- [ ] **Verifica:** `npm test && npx playwright test tests/e2e/persistence.e2e.ts` → PASS (persistence asserisce contenuti, non chrome — se asserisce label del chrome in inglese, il default en-US li mantiene validi).
- [ ] **Commit:** `git commit -m "feat: localize editor chrome"`

---

### Task 11: Rollout i18n — Studio

**Files:**
- Modify: `src/components/StudioWorkspace.tsx` + componenti Studio correlati (censimento: `grep -rln "Studio" src/components --include="*.tsx"` poi grep stringhe come Task 9), `src/lib/locales/*`

Area chiavi `studio.*`. Stesso procedimento.

- [ ] **Verifica:** `npm test && npx playwright test tests/e2e/studio.e2e.ts` → PASS.
- [ ] **Commit:** `git commit -m "feat: localize studio workspace"`

---

### Task 12: Rollout i18n — toast/errori + sweep finale

**Files:**
- Modify: `src/store/useAppStore.ts` (messaggi notice), `src/lib/appFeedback.ts` (se contiene messaggi utente), `src/components/AppNotice.tsx`, `src/lib/locales/*`

- [ ] **Step 1:** I messaggi passati a `showSuccess`/`showError` diventano chiavi: lo store salva la CHIAVE (più params), `AppNotice.tsx` traduce al render con `useT()`. Tipo del notice: `{ kind, messageKey: TranslationKey, params?: TranslationParams }`. Gli errori di sistema (Error.message dal backend) restano raw: il tipo accetta anche `{ rawMessage: string }` in alternativa a `messageKey` — gli errori tecnici non si traducono.
- [ ] **Step 2: Sweep finale di copertura.**

Run: `grep -rnE '>[A-Z][a-z]+ |placeholder="[A-Z]|aria-label="[A-Z]|title="[A-Z]' src/components src/App.tsx --include="*.tsx" | grep -v node_modules | grep -vE 'className|locales/'`

Ogni hit residua: o si migra, o si annota nel commit perché non è UI (es. costanti tecniche). Obiettivo spec: zero stringhe UI hardcoded.

- [ ] **Verifica:** `npm test && npm run build` → PASS.
- [ ] **Commit:** `git commit -m "feat: localize notices and complete i18n sweep"`

---

### Task 13: e2e — `tests/e2e/settings.e2e.ts`

**Files:**
- Create: `tests/e2e/settings.e2e.ts`

- [ ] **Step 1: Spec (mock bridge con comandi profilo)**

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const profile = { name: "", workspaceName: "Shelf", avatarPath: null as string | null };

    window.openNotion = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_pages" || cmd === "list_all_pages" || cmd === "search_pages") return [];
        if (cmd === "list_studio_documents" || cmd === "list_studio_projects" || cmd === "list_all_studio_document_page_links") return [];
        if (cmd === "get_workspace_profile") return { ...profile };
        if (cmd === "update_workspace_profile") {
          if (typeof args?.name === "string") profile.name = args.name;
          if (typeof args?.workspaceName === "string") profile.workspaceName = args.workspaceName;
          if (args && "avatarPath" in args && args.avatarPath === null) profile.avatarPath = null;
          return { ...profile };
        }
        if (cmd === "show_character_palette") return null;
        throw new Error(`Unhandled settings e2e command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };

    window.localStorage.clear();
  });
});

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".on-settings-panel")).toBeVisible();
}

test("appearance preferences apply to the editor container", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Font").selectOption("serif");
  await page.getByLabel("Text size").selectOption("large");
  await expect(page.locator(".on-editor-font-serif")).toHaveCount(0); // settings aperto, editor non montato: verifica su localStorage
  expect(await page.evaluate(() => localStorage.getItem("shelf-editor-font"))).toBe("serif");
  expect(await page.evaluate(() => localStorage.getItem("shelf-editor-font-size"))).toBe("large");
});

test("switching language to Italian translates the modal instantly", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByLabel("Language").selectOption("it");
  await expect(page.getByRole("button", { name: "Preferenze" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aspetto" })).toBeVisible();
});

test("profile name edits reflect in the sidebar card and persist", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByLabel("Name").fill("Marco");
  await page.getByLabel("Name").blur();
  await expect(page.locator(".on-settings-account-card")).toContainText("Marco");
});

test("preferences persist across reload", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByLabel("Page width").selectOption("full");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => localStorage.getItem("opennotion-page-width"))).toBe("full");
});
```

I `getByLabel` richiedono `<label htmlFor>` o `aria-label` sulle select delle sezioni (aggiungili nel Task 8 se mancanti — gli `aria-label` inglesi restano stabili col locale en-US). Adatta i selettori alla resa reale delle sezioni; il contratto (cosa si asserisce) non cambia.

- [ ] **Step 2: Verifica**

Run: `npx playwright test tests/e2e/settings.e2e.ts`
Atteso: PASS (4 test). In caso di flake da carico, rilancia il singolo spec (nota repo).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/settings.e2e.ts
git commit -m "test: add settings e2e coverage"
```

---

### Task 14: Gate finale

- [ ] **Step 1:** `npm run e2e` → tutti gli spec PASS (re-run singoli in caso di flake `page.goto`, nota repo).
- [ ] **Step 2:** `npm run check` → build + unit + smoke/runtime/visual/parity + audit PASS. Se il visual smoke segnala diff per il polish del modal: verificare che il cambiamento sia intenzionale e aggiornare i riferimenti deliberatamente (regola repo sui baseline).
- [ ] **Step 3:** Commit eventuali baseline aggiornati: `git commit -m "chore: refresh visual baselines for settings overhaul"`.

---

## Note trasversali per l'esecutore

- **Mai `invoke` nei componenti** — sempre wrapper in `src/lib/` (regola CLAUDE.md).
- **Chiavi i18n**: ogni chiave nuova va in ENTRAMBI i dizionari nello stesso commit; `it.ts` è `Record<keyof typeof en, string>` quindi TypeScript fallisce la build se ne manca una.
- **e2e**: girano con locale `en-US` → `resolveLocale("system", "en-US") = "en"`; le stringhe inglesi esistenti NON vanno riformulate durante la migrazione (cambiarle romperebbe gli e2e esistenti).
- **Schema DB**: nessuna nuova tabella/colonna; solo chiavi in `app_metadata` (niente migration, coerente con l'approccio idempotente del backend).
- **Commit frequenti**: un commit per task minimo, formato Conventional Commits.
