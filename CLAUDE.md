# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## What this is

A local family-tree editor: React 19 + TypeScript + Vite front end, a dependency-free Node
server (`server.mjs`) that stores one JSON file per person in `persons/`. All domain and
layout logic is plain TypeScript with no DOM access, so it runs and is tested directly in
Node. `README.md` describes the product and the code map (ENG first, then RUS).

## Commands

```bash
npm install
npm start            # build + serve at http://127.0.0.1:5179
npm run serve        # serve the existing build
npm run dev          # Vite with hot reload on 5178, /api proxied to 5179 (run `serve` too)
npm run build        # dist/genealogy.html, a single self-contained page
npm test             # node --test "src/**/*.test.ts" (keep the quotes)
npm run typecheck    # tsc --noEmit
node tools/metrics.ts /path/to/data-copy   # layout quality metrics; `seed` = src/data/family.json
```

Rebuild `dist/` after changing anything under `src/`: `npm start` serves `dist/`, not the
sources. Changes to `server.mjs` need a server restart.

## Data safety (non-negotiable)

- `persons/` is the user's real family tree and is git-ignored. Never edit, rename, reorder
  or "fix" its files, and never run experiments against it. Folders named `persons_backup*`
  are the user's own backups: do not touch them either.
- To test with real data, copy `persons/` into the scratchpad and start the server with
  `node server.mjs --dir /path/to/copy --port 5181`.
- The user edits the data live while a session runs. Snapshot the folder before measuring
  and measure "before" and "after" on the same snapshot.
- Any bulk change to the data (for example renaming people to "Имя Отчество Фамилия") only
  after the user explicitly says so, after showing the exact list first.
- Do not commit or push unless asked. `dist/`, `node_modules/`, `.idea/` and `persons/`
  are ignored on purpose.

## Conventions

- Code comments, UI strings, tests and repository docs are in Russian; identifiers are
  English. Reply to the user in the language they are currently using.
- UI text goes through `src/i18n.ts` (`t(lang, key, vars)`); the model returns message keys
  (`Msg`), never rendered strings. Both dictionaries must have the same keys; a test checks it.
- No runtime dependencies beyond React in the app and none at all in `server.mjs`.
- `model/` and `layout/` must stay free of DOM access; they are imported by Node tests and
  by `tools/metrics.ts`.
- Names are entered first-name-first ("Имя Отчество Фамилия"); `names.ts` assumes the
  surname is the last word.
- Dates: a bare year is stored as `??.??.1995`; `197?` is an approximate year.

## Layout: how to work on it

Pipeline in `src/layout/`: `computeLevels` (generation rows) → `orderRows` (row order by
traversal) → `placeComponent` in `place.ts` (x positions: families as clusters packed by
contour, in-laws hung above their child) → `untangle` in `order.ts` (row reordering scored
by real line routing) → `edges.ts` / `route.ts` (lines) → `timeline.ts` (birth-year mode).

Invariants the tests enforce and the user expects:

- no card overlaps, no line through a card, arrows to children strictly vertical or stepped
  (never diagonal);
- an only child stands exactly under its parents; parents stand over the middle of their
  children; a spouse's parents stand above their own child;
- when families collide, the other family moves aside, never the child out from under its
  parents; couples stay adjacent (small gap, up to the normal gap only when that makes the
  children of both families vertical);
- siblings share a row; a parent is exactly one row above its children.

Before and after any layout change run `npm test` and `node tools/metrics.ts` on a data
snapshot. Nearly every improvement of one metric costs another; do not claim an
improvement without the numbers, and quote them to the user. Random-tree fuzzing (build
trees with `addPerson`/`link`/`addPair`, check overlaps and NaN in both modes) has caught
bugs that the real data did not.

## Documentation rules

- `README.md` is the only user-facing document: general information about the repository,
  two versions (ENG first, then RUS). Keep both versions in sync.
- No personal names from the user's data, no data statistics, no sections about what the
  project no longer does or what is still unfinished. Unfinished work is discussed in the
  conversation, not written into the repository.
