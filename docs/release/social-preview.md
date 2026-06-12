# GitHub Social Preview

Use this image for the repository social preview:

```text
docs/assets/shelf-social-preview.png
```

It is generated from committed project assets with:

```sh
swift scripts/generate-social-preview.swift
```

GitHub upload path:

```text
Repository Settings -> General -> Social preview
```

The GitHub CLI repository settings command does not expose a social-preview
upload flag, so the final upload is a manual repository setting step.
