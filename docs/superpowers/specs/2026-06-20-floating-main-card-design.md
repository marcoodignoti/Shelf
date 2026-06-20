# Main fluttuante a card solida — Design

Data: 2026-06-20
Stato: approvato in brainstorming, in attesa di review finale sul documento

## Obiettivo

Staccare dai bordi della finestra l'intera superficie del main (PageEditor, HomeView, StudioWorkspace), trasformandola in una **card fluttuante solida** coerente con la sidebar, che è già una card glass staccata. Risultato visivo: due oggetti fluttuanti simmetrici (sidebar glass a sinistra, main solido a destra) che galleggiano sul vibrancy del desktop.

## Decisioni di design (approvate in brainstorming)

1. **Scope**: tutto il main — PageEditor, HomeView e StudioWorkspace diventano tutti card.
2. **Look**: solido staccato. Il main resta **opaco** (`bg-background`), niente glass/blur. La sidebar rimane la card glass di accento.
3. **Gap**: coerente con la sidebar → **8px** di margine su tutti i latti, angoli **~12px** (`rounded-xl`).
4. **Lato sinistro**: padding anche a sinistra → c'è aria (gutter) tra sidebar e main.
5. **Toggle button**: entra **dentro** la card del main (ancorato al suo angolo in alto a sinistra), si muove con la card.

## Architettura

### Il cuore della modifica — `src/components/Layout.tsx`

Il `<main>` diventa la card. Due cambi sufficienti a creare tutto l'effetto:

1. **Gutter via margin**: il `<main>` prende `m-2` (8px su tutti i latti). Essendo un flex-child di un container `flex`, il margine lo stacca sia dai bordi finestra (top/right/bottom) sia dalla sidebar (left). Il gutter rivela il vibrancy del desktop su macOS (come già fa la sidebar) e il colore finestra `#f7f7f5` su Windows/Linux.
2. **Forma via CSS**: la classe `.on-main-surface` (oggi vuota) viene definita in `index.css` con `border-radius`, leggera `box-shadow` e `bg-background`. Lo `overflow-hidden` già presente sul `<main>` clipa i figli agli angoli arrotondati.

**Nessun padding sul main**: i figli restano **flush con i bordi interni della card**, così gli header full-width (breadcrumb, toolbar Studio) attraversano tutta la larghezza della card e la loro `bg-background/95` sigilla il contenuto scrollabile sotto. Solo la finestra è "dietro" l'8px di gutter.

### Gutter background

Il root di Layout (`Layout.tsx:52`) oggi è `bg-transparent`. Lasciato così, l'8px di gutter rivela correttamente il vibrancy del desktop su macOS e il `backgroundColor: "#f7f7f5"` della finestra su Windows (`electron/main.cjs:608`). Nessun cambiamento necessario: il comportamento è coerente con la sidebar esistente.

### Toggle button — da fisso a dentro-card

Stato attuale (`Layout.tsx:62-78`): il toggle è `fixed` alla finestra, con posizione ricalcolata a seconda di `isSidebarShellOpen` (math con `sidebarGap`, `sidebarToggleRightInset`, `closedSidebarToggleLeft`, `closedSidebarToggleTop`). I suoi valori:
- `sidebarGap = 8`, `sidebarMargin = 8`, `sidebarToggleRightInset = 8`, `sidebarToggleTopInset = 1`, `sidebarToggleSize = 24`
- `closedSidebarToggleLeft = 86`, `closedSidebarToggleTop = 9` (= 8 + 1)

Nuovo comportamento:
- Da `fixed` → `absolute`, renderizzato **dentro** `<main>` (che è `relative`).
- **Posizione costante** in alto a sinistra della card, indipendente dallo stato della sidebar: ~`left: 84px, top: 8px` (riserva spazio per i traffic lights macOS a `{x:16, y:14}` + respiro). Valore finalizzato in implementazione per centrarsi verticalmente con l'header `h-11` (44px) della card.
- `z-[90]` resta, sopra gli header (`z-40`/`z-[80]`).
- **Rimosso** tutto il branching open/closed del position math. Le costanti `sidebarToggleRightInset`, `sidebarToggleTopInset`, `closedSidebarToggleLeft`, `closedSidebarToggleTop` vengono eliminate; resta il calcolo di `sidebarGap`/`sidebarMargin` usato dalla sidebar.

### Punto critico macOS — traffic lights

I traffic lights sono a `{x:16, y:14}` rispetto alla finestra (`electron/main.cjs:613`). Con la card inset di 8px, cadono a ~`(8, 6)` rispetto alla card → ricadono sull'angolo superiore sinistro della card. Per questo la **riserva di spazio in alto a sinistra va mantenuta** in tutti gli header del main (vedi sezione header sotto).

### Riconciliazione header (i due `pl-36`)

Due header riservano oggi spazio al toggle con il pattern `isSidebarOpen ? pl-6 : pl-36`:
- `PageEditor.tsx:1173` — breadcrumb/action bar, full-bleed con `bg-background/95 backdrop-blur`, `h-11`, `z-40`.
- `StudioWorkspace.tsx:600` — floating toolbar, `pl-36` quando chiuso, `z-[80]`.

Con il toggle **sempre** in alto a sinistra della card (costante), si **unifica a un singolo `pl-36`** (144px) in entrambi gli stati. Vantaggi:
- Comportamento identico sidebar aperta/chiusa (niente shift dell'header quando si toggla).
- Spazio sempre riservato a traffic lights + toggle + respiro.
- Si può semplificare via via il `useUIStore` lookup di `isSidebarOpen` in quei due componenti se non serve più per altri usi (verificare in implementazione; `isSidebarOpen` resta usato altrove, es. sidebar rail).

Gli header restano full-width dentro la card con il loro sfondo; diventano lì la "testata" sigillata della card.

## Impatto per vista

### HomeView — NESSUNA modifica

Root (`HomeView.tsx:52`): `on-scroll-fade h-full overflow-y-auto`, contenuto `mx-auto max-w-3xl px-10 py-24`. Già centrata e paddata. Starà bene dentro la card senza toccare nulla.

### PageEditor — unificazione `pl-36`

- Header breadcrumb (`PageEditor.tsx:1173`): `isSidebarOpen ? pl-6 : pl-36` → `pl-36` costante.
- Loading fallback (`PageEditor.tsx:560`): `flex h-full items-center justify-center`, ok nella card.
- PageHeadingRail (`PageEditor.tsx:95`): `absolute` rispetto al root `relative` → si muove con la card. Sicuro.
- Context menu (`PageEditor.tsx:1680`): `fixed` via portal a coordinate click → transient. Sicuro.
- Delete modal (`PageEditor.tsx:1738`): overlay centrato. Sicuro.

### StudioWorkspace — unificazione `pl-36`

- Floating toolbar (`StudioWorkspace.tsx:600`): `isSidebarOpen ? "" : "pl-36"` → `pl-36` costante.
- Pannelli PDF/nota e split: riempiono il loro container (`h-full min-h-0`), si adattano alla card più piccola. Sicuro.
- Resize overlay splitter (`StudioWorkspace.tsx:783`): `fixed inset-0` transient durante drag. Sicuro.
- Delete modal (`StudioWorkspace.tsx:797`): overlay centrato. Sicuro.

## Cosa NON si tocca

- **Sidebar**: già card glass, non si cambia.
- **Comportamento finestra inattiva** (`app-window-inactive`): la sidebar si opacizza già; la card del main è già opaca, niente da fare.
- **`prefers-reduced-transparency`**: il main non ha glass da disabilitare (solo la sidebar, già coperta).
- **`electron/main.cjs`**: nessun cambiamento a vibrancy/backgroundColor/titleBar.

## File coinvolti

| File | Modifica |
|---|---|
| `src/components/Layout.tsx` | `<main>` → card (`m-2` + classe `.on-main-surface`); toggle `fixed`→`absolute` dentro main con posizione costante; cleanup costanti toggle non più usate. |
| `src/components/PageEditor.tsx` | header breadcrumb: `pl-36` costante. |
| `src/components/StudioWorkspace.tsx` | floating toolbar: `pl-36` costante. |
| `src/index.css` | definizione `.on-main-surface` (border-radius + box-shadow + bg-background). |

## Testing

- **Unit**: nessuna nuova logica pura; la modifica è layout/CSS. Gli unit test esistenti non sono toccati.
- **e2e/visual**: verificare gli snapshot visual esistenti di HomeView, editor e Studio — andranno **rigenerati** (la superficie è ora inset di 8px con angoli arrotondati). Aggiornare i baseline deliberatamente (è una regression intenzionale, come da `AGENTS.md`).
- **Manuale (macOS)**: verificare che i traffic lights non collidano col toggle nell'angolo della card; che il toggle sia cliccabile; che il gutter mostri il vibrancy; che sidebar aperta/chiusa non causi shift dell'header.
- **Manuale (Windows/Linux, se disponibile)**: verificare che il gutter mostri `#f7f7f5` e non bianco rotto.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Toggle si sovrappone ai traffic lights su macOS | Posizione `left: 84px` (oltre i ~16px dei traffic lights + respiro); verificare a runtime. |
| Header `pl-36` costante fa apparire l'header "troppo indentato" con sidebar aperta | È il trade-off scelto (consistenza > ottimizzazione per-stato); se fastidioso, si può ridurre a `pl-28` in un secondo momento. |
| Snapshot visual falliscono | Previsto: rigenerare i baseline (regression intenzionale documentata). |
| Il PDF viewer in Studio perde l'effetto "full-bleed" | Accettato: il pannello PDF riempie ancora il suo container, solo più piccolo per via dell'inset della card. |
