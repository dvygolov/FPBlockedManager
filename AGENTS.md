# FPBlockedManager Agent Notes

## Architecture Rules

- `fpblocked-loader.js` is the only loader source of truth.
- `fpblocked-manager.js` is the payload only. Do not embed a second copy of the loader inside it.
- Loader and payload must remain separate scripts.
- The landing page bookmarklet must be generated from `fpblocked-loader.js`, not from inline loader code duplicated elsewhere.

## Release Rules

- Bump `Config.VERSION` in `fpblocked-manager.js` and `package.json` for every behavior change.
- After each production deploy, run Facebook Sharing Debugger scrape for:
  - `https://fpblocked.pages.dev/fpblocked/latest/manifest.html`
  - every `https://fpblocked.pages.dev/fpblocked/latest/og/chunk-*.html`
- Perform release scrape through the currently logged-in Google Chrome profile.

## Hygiene

- If loader behavior changes, verify there is only one implementation in the repo.
- If payload behavior changes, do not touch bookmarklet generation unless loader behavior truly changed.
