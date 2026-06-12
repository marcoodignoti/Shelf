# Rinnovo sezione Impostazioni — Design

Data: 2026-06-10
Stato: approvato in brainstorming, in attesa di review finale sul documento

## Obiettivo

Rinnovare il modal Impostazioni di Shelf: nuove impostazioni reali (lingua, font, comportamento editor), nuove sezioni (Aspetto, Scorciatoie, Info), profilo Account funzionante, polish UI. Vincolo trasversale: **nessun elemento decorativo — tutto ciò che è visibile deve funzionare**.

## Scope

### Incluso

1. **i18n completo IT/EN** con selettore lingua (default: `'system'`, risolto da `navigator.language`; qualunque lingua di sistema diversa dall'italiano risolve a inglese).
2. **Font editor**: famiglia (`sans` / `serif` / `mono`) e dimensione testo (`small` / `default` / `large`).
3. **Comportamento editor**: toggle reale per Enter nei titoli (`body` = Enter va al corpo pagina, `newline` = Enter inserisce a capo; oggi pill statica "Default") e larghezza pagina (`centered` / `full`).
4. **Sezioni nuove**: Aspetto (tema spostato qui + font), Scorciatoie tastiera (riferimento read-only), Info/About (versione, link GitHub, percorso DB, licenza).
5. **Account funzionante**: profilo locale con nome utente, avatar (immagine importata o iniziale del nome), nome workspace; persistito in SQLite e incluso nel backup.
6. **Redesign**: polish e riorganizzazione della nav, struttura modal+sidebar invariata.

### Escluso

- Ricerca dentro le impostazioni.
- Account cloud / sync / login.
- Lingue oltre IT/EN.
- Sezione impostazioni dedicata a Studio.

## Architettura

### i18n — `src/lib/i18n.ts` + `src/lib/locales/{en,it}.ts`

- Nessuna dipendenza esterna. `type Locale = 'en' | 'it'`.
- Il dizionario inglese è la fonte di verità dei tipi: `type TranslationKey = keyof typeof en`. Il dizionario italiano è dichiarato `Record<TranslationKey, string>`: una chiave mancante è un errore di compilazione.
- Chiavi piatte con prefisso di area (`settings.appearance.title`, `sidebar.newPage`, `studio.viewer.zoom`).
- Funzione pura `t(locale, key, params?)` con interpolazione `{name}`; fallback runtime su `en` per sicurezza. Hook `useT()` che legge la locale dallo store.
- BlockNote: si aggancia il suo dizionario `it` ufficiale al cambio lingua (slash menu e UI editor tradotti senza lavoro custom).
- Date formattate via `Intl.DateTimeFormat(locale)`.
- Non si traducono: contenuto utente, titoli pagina.

### Preferenze dispositivo — Zustand + localStorage

Stesso pattern di `theme` (lettura sincrona all'avvio, setter che scrive localStorage + state, zero flash al boot). Nuove chiavi:

| Chiave localStorage | Valori | Default |
|---|---|---|
| `opennotion-locale` | `'system' \| 'en' \| 'it'` | `'system'` |
| `shelf-editor-font` | `'sans' \| 'serif' \| 'mono'` | `'sans'` |
| `shelf-editor-font-size` | `'small' \| 'default' \| 'large'` | `'default'` |
| `opennotion-page-width` | `'centered' \| 'full'` | `'centered'` |
| `opennotion-title-enter` | `'body' \| 'newline'` | `'body'` |

Valori sconosciuti o corrotti: parse con fallback al default, mai crash. Font e larghezza applicati con classi/variabili CSS sul contenitore editor.

### Profilo workspace — SQLite `app_metadata`

- Nuovi comandi backend in `electron/backend.cjs`: `get_workspace_profile`, `update_workspace_profile`, `import_profile_avatar`.
- Chiavi in `app_metadata`: `profile_name`, `profile_avatar_path`, `workspace_name`.
- Avatar: immagine copiata nel config dir con lo stesso meccanismo di `import_cover_image`; validazione estensione/dimensione nel backend. Fallback: iniziale del nome.
- Wrapper tipizzati in `src/lib/db.ts` (nessun `invoke` diretto nei componenti, regola repo).
- Il profilo entra nel backup JSON versionato (export e import); i backup precedenti senza chiavi profilo si importano senza errori.

## Struttura UI

`SettingsModal.tsx` resta shell (nav + routing sezioni); i pannelli vengono estratti in `src/components/settings/`, un file per sezione.

```
Account
  └─ Profilo        — nome, avatar, nome workspace
Workspace
  ├─ Preferenze     — lingua, Enter nei titoli, larghezza pagina
  ├─ Aspetto        — tema, famiglia font, dimensione testo
  ├─ Scorciatoie    — tabella shortcut raggruppate per area
  ├─ Aggiornamenti  — invariato (canale beta)
  ├─ Import/Export  — invariato
  └─ Info           — versione, link GitHub, percorso DB, licenza
```

- Card account in cima alla sidebar del modal: avatar reale + nome profilo + nome workspace, aggiornata live alla modifica.
- Selettore font con anteprima dal vivo (ogni opzione renderizzata nel font che rappresenta).
- Scorciatoie: dati da costante tipizzata `src/lib/shortcuts.ts`, riusabile in futuro dalla command palette.
- Pattern visivo esistente (`on-settings-row`, `on-settings-group`) mantenuto; polish su spaziature e dettagli.

## Rollout i18n

Ordine di migrazione (incrementale ma completo — a fine lavoro zero stringhe hardcoded):

1. Modal impostazioni
2. Sidebar + HomeView
3. Chrome dell'editor (menu, tooltip, placeholder)
4. Studio
5. Toast / messaggi di errore

Stima ~200–300 chiavi. Cambio lingua istantaneo (re-render dallo store, nessun riavvio). Verifica finale di copertura: grep mirato sulle stringhe residue + review del diff.

## Gestione errori

- Update profilo: pattern optimistic-update dello store (mutazione locale → comando backend → rollback + `showError` su fallimento).
- Avatar import fallito: toast di errore, profilo invariato.
- localStorage corrotto: fallback silenzioso al default.
- Backup senza profilo: import tollerante, chiavi assenti ignorate.

## Testing

- **Unit** (`src/lib/`): `i18n.test.ts` (lookup, interpolazione, fallback, completezza di `it` garantita dal tipo), `shortcuts.test.ts`, parse preferenze, serializzazione profilo nel backup.
- **Backend**: estensione dei test esistenti per i tre comandi profilo.
- **e2e**: nuovo `tests/e2e/settings.e2e.ts` — tema/font/larghezza applicati al DOM, switch lingua IT cambia i testi del modal, modifica nome profilo riflessa nella card, persistenza dopo reload. Gli e2e esistenti restano in inglese (Playwright gira con locale `en-US`, quindi `'system'` risolve a `en`) e non cambiano.
- **Gate finale**: `npm run check`.

## Rischi

- **e2e esistenti** asseriscono testo inglese: mitigato dalla risoluzione di `'system'` a `en` nell'ambiente Playwright.
- **Ampiezza rollout i18n**: tocca quasi ogni componente; mitigato da migrazione per aree con verifica per area e tipi che impediscono chiavi mancanti.
- **Crescita SettingsModal**: mitigata dallo split in `src/components/settings/`.
