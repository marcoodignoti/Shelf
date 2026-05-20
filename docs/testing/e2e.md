# E2E Testing

OpenNotion has a Playwright smoke test for the most important user path:

- create a page
- edit title and body
- wait for autosave
- reload the app
- verify title and body survive
- search persisted content

Run it locally:

```sh
npm run e2e:install
npm run e2e
```

The test runs the Vite app with a deterministic mock of Tauri commands. It does not touch the real local SQLite database.

## Native Tauri Driver Status

`tauri-driver` was checked on macOS during setup, but it currently exits with:

```text
tauri-driver is not supported on this platform
```

Because of that, this pass adds browser-level E2E coverage for the app workflow and keeps real packaged-app automation as a remaining production task. Real packaged-app E2E should be added when a supported macOS driver path is available, for example an embedded WebDriver plugin or another maintained Tauri automation route.
