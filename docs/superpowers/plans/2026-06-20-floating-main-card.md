# Main fluttuante a card solida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare il `<main>` di Shelf in una card fluttuante solida (8px di margine, angoli arrotondati, ombra sottile), staccandola dai bordi finestra in modo coerente con la sidebar glass già esistente, e spostare il toggle della sidebar dentro la card.

**Architecture:** Il cambiamento è quasi interamente layout/CSS, senza nuova logica. Il `<main>` in `Layout.tsx` prende `m-2` + una nuova classe `.on-main-surface` (border-radius + box-shadow + bg-background). Il toggle button passa da `fixed` alla finestra a `absolute` dentro `<main>`, con posizione costante. I due header full-bleed (breadcrumb in `PageEditor`, toolbar in `StudioWorkspace`) unificano il loro `pl-36` da condizionale a costante.

**Tech Stack:** React 19, TypeScript, Tailwind 4 (via `src/index.css` con `@layer components`), Playwright (e2e visual regression).

**Spec di riferimento:** `docs/superpowers/specs/2026-06-20-floating-main-card-design.md`

---

## File Structure

| File | Responsabilità | Modifica |
|---|---|---|
| `src/index.css` | Definire la superficie visiva della card `.on-main-surface`. | Crea regola. |
| `src/components/Layout.tsx` | Il container: `<main>` diventa card, toggle entra nella card, cleanup costanti. | Modifica. |
| `src/components/PageEditor.tsx` | Header breadcrumb: `pl-36` costante. | Modifica 1 riga. |
| `src/components/StudioWorkspace.tsx` | Floating toolbar: `pl-36` costante. | Modifica 1 riga. |
| `tests/e2e/visual.e2e.ts-snapshots/*.png` | Baseline visual da rigenerare (regressione intenzionale). | Rigenera 3 PNG. |

Nessun nuovo file sorgente. Nessuna nuova logica pura (il repo tiene la logica testabile in `src/lib/*`; qui si tocca solo layout di componenti, per cui non esiste unit test significativo).

---

## Task 1: Definire la superficie `.on-main-surface`

**Files:**
- Modify: `src/index.css` (dentro `@layer components`, vicino alle altre regole `.on-*`)

**Nota:** La classe `.on-main-surface` è già referenziata in `Layout.tsx:79` ma non ha regole CSS. La definiamoamo ora.

- [ ] **Step 1: Aggiungere la regola `.on-main-surface` in `index.css`**

Inserire dentro `@layer components { ... }` (subito dopo la regola `.on-sidebar-settings-fade` o in un punto sensato accanto alle altre regole `.on-*` di shell, es. prima di `.on-section-label`):

```css
.on-main-surface {
  border-radius: 0.75rem;
  background: hsl(var(--background));
  box-shadow: 0 1px 2px hsl(222 28% 12% / 0.05), 0 12px 40px hsl(222 28% 12% / 0.08);
}

.dark .on-main-surface {
  box-shadow: 0 1px 2px hsl(0 0% 0% / 0.18), 0 12px 44px hsl(0 0% 0% / 0.32);
}
```

Note:
- `border-radius: 0.75rem` = 12px, coerente col `--radius: 0.7rem` del tema e con la sidebar (`m-2` + angoli).
- `box-shadow` doppia: una 1px di definizione + una morbida lunga per il "sollevamento".
- `.dark` con ombra più forte (lo sfondo scuro richiede più contrasto per leggere il sollevamento).

- [ ] **Step 2: Verificare che il build CSS non si rompa**

Run: `npm run build`
Expected: build completato senza errori (tsc + vite build).

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(layout): add .on-main-surface card surface styles"
```

---

## Task 2: Trasformare il `<main>` in card + spostare il toggle dentro

Questo è il task centrale. Modifica `Layout.tsx`: il `<main>` prende il margine e il toggle diventa `absolute` dentro di esso.

**Files:**
- Modify: `src/components/Layout.tsx:15-82`

- [ ] **Step 1: Sostituire il blocco delle costanti toggle + il JSX del toggle/main**

Sostituire le righe da `const sidebarGap = 8;` (riga 15) fino alla fine del `<main>` (riga 81) con:

```tsx
  const sidebarGap = 8;
  const sidebarMargin = 8;
  const sidebarShellWidth = sidebarWidth + sidebarMargin * 2;
  const [shouldRenderSidebar, setShouldRenderSidebar] = React.useState(isSidebarOpen);
  const [isSidebarShellOpen, setIsSidebarShellOpen] = React.useState(isSidebarOpen);
```

(questa prima parte va sostituita solo nelle righe 15-22: le costanti `sidebarToggleRightInset`, `sidebarToggleTopInset`, `sidebarToggleSize`, `closedSidebarToggleLeft`, `closedSidebarToggleTop` vengono rimosse; restano `sidebarGap`, `sidebarMargin`, `sidebarShellWidth`). **Attenzione:** gli `useEffect`/`useState` delle righe 23-49 restano invariati.

Poi sostituire tutto il blocco JSX del return (righe 62-81, dal `<div className="fixed z-[90]...` del toggle fino alla chiusura di `<main>`) con:

```tsx
      <main className={`on-main-surface ${isSidebarShellOpen ? "on-main-surface-with-sidebar" : ""} m-2 flex-1 overflow-hidden relative transition-all duration-300 flex flex-col`}>
        <div
          className="absolute left-[84px] top-2 z-[90] flex items-center gap-2"
        >
          <button
            onClick={toggleSidebar}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            title={t("layout.toggleSidebar")}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </main>
```

Cambiamenti chiave rispetto al codice attuale:
1. `<main>`: tolto `bg-background` (ora gestito da `.on-main-surface` in CSS), aggiunto `m-2` (gutter 8px su tutti i lati).
2. Toggle: da `fixed` → `absolute`; posizionato dentro `<main>`; posizione **costante** `left-[84px] top-2` (sgombra i traffic lights macOS a `{x:16,y:14}` e si centra con l'header `h-11`). Rimossa la transizione `transition-[left,top]` (non si muove più).
3. Toggle PRIMA di `{children}`: così è il primo figlio del flusso, ma `absolute` non influenza il layout.

- [ ] **Step 2: Verificare che `PanelLeft` e `t` restino usati (no unused imports)**

`PanelLeft` è ancora usato nel bottone; `t` è ancora usato in `title`. Le import in cima al file (`PanelLeft`, `useT`) restano valide. Nessuna modifica alle import necessaria.

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: build OK. Se tsc segnala "sidebarToggleRightInset declared but never read" o simile, significa che Step 1 non ha rimosso tutte le vecchie costanti — tornare a Step 1 e verificare che rimangano solo `sidebarGap`, `sidebarMargin`, `sidebarShellWidth`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.tsx
git commit -m "feat(layout): make main a floating card and move toggle inside it"
```

---

## Task 3: Unificare `pl-36` nell'header breadcrumb (PageEditor)

**Files:**
- Modify: `src/components/PageEditor.tsx:1173`

- [ ] **Step 1: Rendere `pl-36` costante**

Sostituire la riga 1173:

```tsx
        <div className={`h-11 border-b border-border/40 flex items-center justify-between pr-6 shrink-0 bg-background/95 backdrop-blur z-40 select-none ${isSidebarOpen ? "pl-6" : "pl-36"}`}>
```

con:

```tsx
        <div className="h-11 border-b border-border/40 flex items-center justify-between pr-6 pl-36 shrink-0 bg-background/95 backdrop-blur z-40 select-none">
```

Cambiamento: rimosso il template literal condizionale, `pl-36` è ora fisso. La riserva di 144px accoglie sempre toggle (ora in card a `left:84px`) + respiro.

- [ ] **Step 2: Verificare se `isSidebarOpen` è ancora usato nel file**

Cercare `isSidebarOpen` nel file. Se non ha altri usi, rimuovere il lookup dallo store per evitare un warning unused. Se ha altri usi, lasciare.

Run (per controllo manuale): cercare `isSidebarOpen` in `src/components/PageEditor.tsx`.
- Se appare SOLO nella riga appena cambiata → rimuovere la sua lettura da `useUIStore`/`useAppStore`.
- Se appare altrove → lasciare tutto.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/PageEditor.tsx
git commit -m "feat(editor): unify breadcrumb left padding for floating card"
```

---

## Task 4: Unificare `pl-36` nella floating toolbar (StudioWorkspace)

**Files:**
- Modify: `src/components/StudioWorkspace.tsx:600`

- [ ] **Step 1: Rendere `pl-36` costante**

Sostituire la riga 600:

```tsx
      <div className={`on-studio-floating-toolbar pointer-events-none z-[80] flex items-center gap-3 px-4 py-2 ${isSidebarOpen ? "" : "pl-36"}`}>
```

con:

```tsx
      <div className="on-studio-floating-toolbar pointer-events-none z-[80] flex items-center gap-3 px-4 py-2 pl-36">
```

Cambiamento: rimosso template literal condizionale, `pl-36` fisso. (Nota: `px-4` resta, ma `pl-36` vince per specificità sul `pl` di `px-4` perché viene dopo nella stringa di classi Tailwind — verificare a runtime in Step 3; in Tailwind l'ordine nel class string non garantisce precedenza, ma `pl-36`=144px vs `px-4`=16px, e Tailwind genera entrambi; se `px-4` sovrascrive, cambiare `px-4` in `pr-4`.)

- [ ] **Step 2: Verificare uso di `isSidebarOpen` nel file**

Stesso procedimento di Task 3 Step 2: cercare `isSidebarOpen` in `src/components/StudioWorkspace.tsx`. Se resta inutilizzato, rimuoverne la lettura dallo store.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/StudioWorkspace.tsx
git commit -m "feat(studio): unify toolbar left padding for floating card"
```

---

## Task 5: Rigenerare i baseline degli snapshot visual

I 3 snapshot esistenti cambieranno perché la superficie è ora inset 8px con angoli arrotondati. È una regressione intenzionale (vedi `AGENTS.md`: "update them deliberately when a regression is intentional").

**Files:**
- Rigenera: `tests/e2e/visual.e2e.ts-snapshots/home-dashboard-chromium-darwin.png`
- Rigenera: `tests/e2e/visual.e2e.ts-snapshots/editor-page-chromium-darwin.png`
- Rigenera: `tests/e2e/visual.e2e.ts-snapshots/studio-split-view-chromium-darwin.png`

- [ ] **Step 1: Assicurarsi che i browser Playwright siano installati**

Run: `npx playwright install chromium`
(se già installato, è un no-op).

- [ ] **Step 2: Rigenerare gli snapshot**

Run: `npx playwright test tests/e2e/visual.e2e.ts --update`
Expected: 3 test eseguiti, 3 snapshot rigenerati, 3 passed. (Il flag `--update` sovrascrive i PNG esistenti.)

- [ ] **Step 3: Ispezionare manualmente i 3 nuovi PNG**

Aprire i 3 PNG e verificare visivamente:
- La card del main è inset ~8px dai bordi finestra con angoli arrotondati.
- La sidebar glass è a sinistra, staccata.
- Il toggle è nell'angolo in alto a sinistra della card (non più al bordo finestra).
- Header breadcrumb (editor) e toolbar (studio) partono coerenti a sinistra.

Se qualcosa non corrisponde al design, fermarsi e correggere il task responsabile prima di andare avanti.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/visual.e2e.ts-snapshots/*.png
git commit -m "test(visual): refresh snapshots for floating main card"
```

---

## Task 6: Verifica finale e gate

- [ ] **Step 1: Eseguire l'unit test suite (sanity, non dovrebbe essere toccata)**

Run: `npm test`
Expected: tutti i test passano (nessuno tocca `src/lib/*`).

- [ ] **Step 2: Eseguire l'e2e visual dopo rigenerazione (deve passare ora)**

Run: `npx playwright test tests/e2e/visual.e2e.ts`
Expected: 3 passed (gli snapshot ora matchano i nuovi baseline).

- [ ] **Step 3: Verifica manuale macOS (se ambiente disponibile)**

Run: `npm run electron:dev`
Verificare nel'app vera:
- [ ] I traffic lights macOS NON si sovrappongono al toggle nell'angolo della card. Se si sovrappongono, aumentare `left-[84px]` in `Layout.tsx` (Task 2) fino a sgombrarli.
- [ ] Il toggle è cliccabile e apre/chiude la sidebar.
- [ ] Il gutter mostra il vibrancy del desktop.
- [ ] Con sidebar aperta, l'header NON shifta (è il punto del `pl-36` costante).
- [ ] Studio split view: PDF e nota riempiono la card senza overflow.

- [ ] **Step 4: Gate completo (opzionale, se si vuole eseguire tutto)**

Run: `npm run check`
Expected: build + unit + smoke/runtime/visual/parity + audit tutti verdi.

- [ ] **Step 5: Commit finale se ci sono state correzioni dai passi manuali**

Se la verifica manuale ha richiesto ritocchi (es. `left-[84px]` → `left-[96px]`), committare:

```bash
git add -A
git commit -m "fix(layout): adjust toggle offset to clear traffic lights"
```

---

## Self-Review (post-scrittura)

**Spec coverage:**
- ✅ Scope "tutto il main" → Task 2 (Layout copre tutti i children: Home/Editor/Studio).
- ✅ Look solido opaco → Task 1 (`bg-background`, niente blur) + Task 2 (rimosso `bg-background` inline, delegato a CSS).
- ✅ Gap 8px / angoli ~12px → Task 1 (`border-radius: 0.75rem`) + Task 2 (`m-2`).
- ✅ Padding anche a sinistra → Task 2 (`m-2` su tutti i lati, gutter tra sidebar e main).
- ✅ Toggle dentro la card → Task 2 (`absolute` in `<main>`, posizione costante).
- ✅ `pl-36` unificato in entrambi gli header → Task 3 (PageEditor) + Task 4 (StudioWorkspace).
- ✅ HomeView nessuna modifica → confermato (nessun task la tocca).
- ✅ Snapshot visual rigenerati → Task 5.
- ✅ Cosa non si tocca (sidebar, finestra inattiva, reduced-transparency, electron/main.cjs) → nessun task li modifica.

**Placeholder scan:** nessun TBD/TODO. I valori numerici (`0.75rem`, `left-[84px]`, `top-2`) sono concreti; Task 6 Step 3 prevede esplicitamente la finalizzazione del toggle offset a runtime (caso d'uso reale macOS, non placeholder).

**Type consistency:** `m-2`, `pl-36`, `.on-main-surface` usati coerentemente tra Task 1-4. `sidebarGap`/`sidebarMargin`/`sidebarShellWidth` mantenuti (usati dalla sidebar); le costanti toggle rimosse non sono referenziate altrove (verificato in ispezione: solo in `Layout.tsx`).

**Ambiguità notata e risolta:** Task 4 Step 1 nota il potenziale conflitto `px-4` vs `pl-36` in Tailwind con istruzione esplicita di fallback (`pr-4`). Non è un placeholder, è una guida di risoluzione concreta.
