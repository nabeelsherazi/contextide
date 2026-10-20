# ContextIDE

A writing desk for context engineering: compose LLM prompts from reusable **blocks**, A/B test **versions**,
and run them against local or cloud OpenAI-compatible endpoints. Everything lives as plain text in a folder.
See [SPEC.md](SPEC.md) for the design.

It's a static PWA (Vite + React + TypeScript + ProseMirror) that works directly on a folder through the
File System Access API (Chromium browsers), or in browser storage (OPFS) for trying it out.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (vitest): core model, renderer, transforms, scoring, editor commands, runner
npm run test:e2e     # end-to-end (playwright, headless chromium, mocked LLM endpoints)
npm run build        # static PWA in dist/
```

### Layout

| Path | What |
|---|---|
| `src/core/` | Pure, DOM-free model: file format (`doc.ts`), expressions, data parsing + transforms, insertions, renderer, digest, request builder, scoring, run files, lint. Extractable as a package later. |
| `src/editor/` | ProseMirror schema, AST conversion, **pure commands** (headless-tested), plugins (markdown styling, analysis decorations, slash menu, drag/drop) and node views. |
| `src/run/` | Run orchestration (whole / fan-out / repeat / ablation) and comparison helpers. |
| `src/fs/` | Virtual filesystem over a directory handle (real folder or OPFS) + an in-memory one for tests. |
| `src/state/` | Zustand store, workspace actions, live analysis. |
| `src/ui/` | React shell: drawers, pages, panels, modals, palette. |
| `e2e/` | Playwright specs. `window.__contextide` exposes read-mostly hooks (files, editor text, rendered prompt, caret/selection helpers). |

### Testing notes

- Editor behaviour (make directive, group as section, move, mute, detach, insert) is covered headlessly in
  `src/editor/__tests__/commands.test.ts` — prefer adding cases there.
- E2E tests open a fresh OPFS workspace per test via `__contextide.openBrowserWorkspace()`, and mock LLM
  endpoints with `page.route`.
- Screenshots on demand: `SHOTS=/some/dir npx playwright test e2e/shots.spec.ts`.

### Endpoints & CORS

The page calls your endpoint directly from the browser, so the server must allow CORS. LM Studio: enable CORS in
the server settings. llama-server sends CORS headers by default. When the app is hosted on https and calls
`http://localhost`, Chrome asks for Local Network Access permission.
