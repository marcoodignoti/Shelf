# Security Policy

## Supported Versions

Security fixes target the latest public release and the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for a vulnerability that could expose user
data or weaken local app isolation.

Report privately through GitHub's private vulnerability reporting if enabled on
the repository. If it is not enabled, contact the maintainer directly through
the GitHub profile listed on the repository.

Include:

- affected commit or release artifact
- platform and OS version
- reproduction steps
- expected impact
- whether local user data, imported PDFs, or files outside app data can be read,
  modified, or deleted

## Security Model

OpenNotion is local-first:

- no account system
- no hosted sync backend
- workspace data stored in local app data
- renderer access to local capabilities mediated through Electron IPC
- build artifacts must not include local user databases or imported documents

Default macOS app data path:

```text
~/Library/Application Support/org.opennotion.desktop/
```

## Current Distribution Caveats

- macOS builds are unsigned/ad-hoc and not notarized.
- Windows builds are unsigned portable zips.
- OS trust warnings are expected until Developer ID signing, notarization, and
  Windows code signing are implemented.
