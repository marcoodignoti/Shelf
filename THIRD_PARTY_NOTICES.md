# Third-Party Notices

Shelf depends on open-source packages. This file summarizes the direct
runtime and development dependencies declared in `package.json`.

For exact resolved versions, see `package-lock.json`. When building or
redistributing binaries, keep dependency license files available from the
corresponding packages and review transitive dependency obligations.

## Runtime Dependencies

| Package | Version | License |
| --- | ---: | --- |
| `@blocknote/core` | 0.51.0 | MPL-2.0 |
| `@blocknote/mantine` | 0.51.0 | MPL-2.0 |
| `@blocknote/react` | 0.51.0 | MPL-2.0 |
| `@mantine/core` | 9.2.1 | MIT |
| `@mantine/hooks` | 9.2.1 | MIT |
| `clsx` | 2.1.1 | MIT |
| `katex` | 0.17.0 | MIT |
| `lucide-react` | 1.16.0 | ISC |
| `pdfjs-dist` | 5.7.284 | Apache-2.0 |
| `react` | 19.2.6 | MIT |
| `react-dom` | 19.2.6 | MIT |
| `tailwind-merge` | 3.6.0 | MIT |
| `zustand` | 5.0.13 | MIT |

## Development and Packaging Dependencies

| Package | Version | License |
| --- | ---: | --- |
| `@playwright/test` | 1.60.0 | Apache-2.0 |
| `@tailwindcss/postcss` | 4.3.0 | MIT |
| `@tailwindcss/vite` | 4.3.0 | MIT |
| `@types/react` | 19.2.14 | MIT |
| `@types/react-dom` | 19.2.3 | MIT |
| `@types/use-sync-external-store` | 1.5.0 | MIT |
| `@vitejs/plugin-react` | 4.7.0 | MIT |
| `autoprefixer` | 10.5.0 | MIT |
| `concurrently` | 10.0.3 | MIT |
| `cross-env` | 10.1.0 | MIT |
| `electron` | 40.10.2 | MIT |
| `postcss` | 8.5.14 | MIT |
| `rcedit` | 5.0.2 | MIT |
| `tailwindcss` | 4.3.0 | MIT |
| `typescript` | 5.8.3 | Apache-2.0 |
| `vite` | 7.3.3 | MIT |
| `vitest` | 4.1.6 | MIT |
| `wait-on` | 9.0.10 | MIT |

## License Notes

- Shelf project code is MIT licensed.
- BlockNote packages are MPL-2.0. Keep upstream notices and source-availability
  obligations in mind when modifying those packages themselves.
- `pdfjs-dist`, Playwright, and TypeScript use Apache-2.0; preserve copyright,
  license, and notice terms when redistributing.
- Electron includes Chromium and other components with their own notices. The
  packaged Electron runtime contains upstream license files from Electron's
  distribution.
- Windows packaging uses `rcedit` to set executable metadata and the application
  icon.
- The generated Shelf app icon and repository screenshots are project
  assets and are included for use with Shelf.

This notice is not legal advice. Re-check dependency licenses before a public
binary release or app-store distribution.
