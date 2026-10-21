# ContextIDE

A writing desk for context engineering: compose LLM prompts from reusable **blocks**, A/B test
**versions**, and run them against OpenAI-compatible endpoints. Everything lives as plain text in a folder.

- **What it does, and the file formats:** [SPEC.md](SPEC.md). That is the single reference for behavior; this README is for working on the code.
- **Stack:** Vite + React 19 + TypeScript, ProseMirror for the editor, zustand for state, Tailwind v4 + shadcn/ui (Radix) for the UI chrome. It's a static PWA (vite-plugin-pwa).

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest: core, editor commands + layout, runner (fast, no browser)
npm run test:e2e     # playwright: headless chromium, fresh browser-storage workspace per test, mocked LLMs
npm run build        # typecheck + static PWA in dist/
```

## Where things live

| Path | What |
|---|---|
| `src/core/` | Pure, DOM-free model: file format (`doc.ts`), expressions (`expr.ts`), data + transforms (`data.ts`, `pipeline.ts`), insertions, renderer (`render.ts`), schema digest, request builder, scoring, run files, lint, workspace model (`workspace.ts`), render env (`env.ts`). |
| `src/editor/` | ProseMirror: `schema.ts`, AST ↔ doc (`convert.ts`), **pure commands** (`commands.ts`), plugins (`plugins.ts`: keymap, slash menu, drop/paste, `{{ }}` input rule, analysis decorations), card layout (`layout.ts`), markdown styling (`markdown.ts`), node views (`views.ts`), the active-editor registry (`active.ts`). |
| `src/run/` | Run orchestration (`runner.ts`) and diff, variance and ablation helpers (`compare.ts`). |
| `src/fs/` | A small virtual filesystem over a directory handle (a real folder or OPFS), the saved-handle store, and an in-memory vfs. |
| `src/state/` | zustand store (`store.ts`), workspace actions (`actions.ts`), live analysis (`analysis.ts`). |
| `src/ui/` | React shell. `widgets.tsx` holds the thin app wrappers over shadcn (`Field`, `NumField`, `Choice`, `Seg`, `FieldRow`, `CheckRow`, `KeyValues`, `JsonField`). `items.ts` lists everything insertable, shared by the slash menu, palette and drawer. |
| `src/components/ui/` | shadcn/ui components, restyled to the night/day look. Add one with `npx shadcn@latest add <name>`; check its imports and restyle it. |
| `src/app.css` | Tailwind entry. Maps shadcn tokens onto the palette and imports the two custom layers. |
| `src/theme.css` | The custom look: night/day tokens, the painted backdrops, the rope, welcome, tour, variable bubbles, rendered view, surfaces. |
| `public/sky/` | The night and day backdrops, rendered by `scripts/sky.py` (numpy + Pillow): smooth gradients, soft clouds, stars, no texture. Re-run it only to change the look; the output is committed. |
| `src/editor.css` | The editor: cards, bridges, chips, markdown, stable-prefix and rope decorations. |
| `src/seed.ts` | Starter workspace contents (library, variables, endpoints, sample project). |
| `src/testHooks.ts` | `window.__contextide`: hooks for e2e tests and devtools. |

### How a keystroke flows

The editor dispatches a transaction. After about 120 ms, `docFromPM` produces the AST, then `analyze()`
runs `render` + `stablePrefix` + `lint` + token counts. The result goes to `store.analysis`, which drives
the status bar, rendered view and gutter decorations. After about 350 ms, `fmtDoc` serializes the version
and `writeFile` saves it to the vfs. The 2-second poll (`pollDisk`) and `rebuild` turn external file
changes into a new `Workspace`.

## Working on this codebase

**Testing**

- Most behavior is testable without a browser:
  - core logic: `src/core/__tests__`;
  - editor commands: `src/editor/__tests__/commands.test.ts` (build a state from a template string, apply a command, compare serialized output);
  - card layout: `layout.test.ts`;
  - runs against a fake fetch: `src/run/runner.test.ts`.

  Prefer adding cases there before writing an e2e test.
- E2E helpers are in `e2e/helpers.ts`:
  - `boot()` opens a seeded workspace, skips the tutorial and expands the library;
  - `caretAfter` and `select` place the caret or selection through the editor state (clicking is flaky while fonts load);
  - `choose()` picks Radix Select options (Playwright's `selectOption` only works on native `<select>`);
  - `mouseDrag()` does stepwise drags (`dragTo` doesn't fire `dragstart` on hover-revealed handles);
  - `expectFile()` polls the vfs.

  Mock LLMs with `page.route`.
- **Look at the UI after visual changes.** `SHOTS=/tmp/shots [THEME=light] npx playwright test e2e/shots.spec.ts e2e/shots2.spec.ts` screenshots about 20 screens. Check both themes.
- `e2e/layout.spec.ts` guards against horizontal overflow. `e2e/tutorial.spec.ts` checks that every tour step spotlights a real element.

**Type**

- Two voices only: EB Garamond for anything a person would say (titles, labels, menus, buttons, prose) and the mono for anything a machine would (numbers, ids, URLs, token counts, keys, transforms). Tailwind's `font-sans` is mapped to Garamond, so there is no sans to fall back to by accident.
- Headings in drawers and panels are tracked Garamond capitals (`Eyebrow`); labels above fields are italic (`FieldRow`). This Garamond build has no true small caps, so don't reach for `font-variant: small-caps`.
- In day mode anything sitting straight on the painted sky is cream with a soft shadow; pages other than the version page sit on a glass `.cx-sheet`.

**Gotchas**

- **CSS layers.** `theme.css` and `editor.css` are imported into Tailwind's `components` layer. Unlayered CSS beats layered Tailwind utilities, so keep custom CSS inside a layer, or shadcn classes will silently lose.
- **Two "accent"s.** shadcn's `--accent` is a hover background. ContextIDE's gold is `--gold` (`text-gold`, `bg-gold-soft`). Day-mode-only utilities use the `day:` variant (`app.css`).
- **Radix Select can't hold `""`.** `Choice` maps `""` to a sentinel, and shows its placeholder when `""` isn't one of the options.
- **Node views are vanilla DOM** inside ProseMirror, so they don't use React or shadcn (`views.ts`). Their `stopEvent` must let `dragover`/`drop` through and claim events that start on a `.cx-handle`, otherwise card dragging breaks.
- **Trailing line.** Every message ends with an empty trailing line. `docToPM` adds it, `docFromPM` drops it, and a plugin keeps it. Card layout classes come from decorations (`layout.ts`), so React never touches card DOM.
- **Slash menu.** The **+** button opens it with `auto: true`; dismissing it removes the `/` it typed. The query is always derived from the document, so fast typing can't race the menu.
- **Flavor resolution** is only in `workspace.ts` (`resolveBlock`, `variantsOf`). Rendering goes through `envFor` (`env.ts`).
- **Keep the repo free of personal data.** The workspace README and seed content in `src/seed.ts` ship to every user.
