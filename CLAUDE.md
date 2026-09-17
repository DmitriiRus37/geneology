# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## What this is

A local family-tree editor: React 19 + TypeScript + Vite front end, a dependency-free Node
server (`server.mjs`) that stores one JSON file per person in `persons/`. All domain and
layout logic is plain TypeScript with no DOM access, so it runs and is tested directly in
Node. `README.md` describes the product and the code map (ENG first, then RUS).

`server.mjs` has two stores behind one tree parser. **disk** (default) is the `persons/`
folder. **memory** (`--store memory`, what the container runs) keeps everything in RAM:
the tree arrives as a zip on `POST /api/upload`, leaves on `GET /api/download`, and a
restart wipes it. Zip reading and writing are hand-rolled on `node:zlib` — the server
still has no dependencies. `GENEALOGY_USER`/`GENEALOGY_PASS` turn on the guard: browsers log in at `/login` and carry
a session cookie that dies with the process, tools keep using HTTP Basic;
`--host`/`HOST` sets the bind address, still `127.0.0.1` by default. `/api/health` is the
only route outside the guard. `LOG_DIR` turns on the request log (one line per request,
no headers and no bodies); it rotates itself at `LOG_MAX` (10 MB) keeping `LOG_KEEP` (3)
gzipped files. Without `LOG_DIR` nothing is written, so local runs stay quiet. Deployment lives in `Dockerfile`, `docker-compose-prod.yml`,
`Makefile` and the `deploy` / `backup-tree` skills in `.claude/skills/`.

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
node tools/smoke.mjs <base-url> [user] [pass]   # smoke-check a running instance
```

```bash
make check                                  # typecheck + tests
make build_docker                           # image for linux/amd64
make run_local                              # run that image here (needs GENEALOGY_USER/PASS)
make smoke BASE=<url>                        # check a running instance
make backup                                 # pull the remote tree into backups/
make applog N=50                            # tail the remote request log
make applog_grep PATTERN=<text>             # search it, gzipped history included
PROD_HOST=<ip> SSHPASS=<pw> GENEALOGY_USER=<u> GENEALOGY_PASS=<p> make deploy
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
- Do not commit or push unless asked. `dist/`, `node_modules/`, `.idea/`, `persons/`,
  `.env` and `backups/` are ignored on purpose.
- The remote instance is a separate copy and holds only what was uploaded to it. Never
  push `persons/` to a server unless the user explicitly asks for exactly that.

## Conventions

- Code comments, test names, assertion messages and the strings the server logs and
  returns are in English, as are identifiers. Russian stays only where it is data: the
  sample tree in `src/data/`, the person-name fixtures in the tests, the morphology
  regexes and word lists in `names.ts` / `dates.ts`, the expected RU strings the i18n
  tests assert on, and both dictionaries in `src/i18n.ts`. `README.md` stays bilingual
  (ENG first, then RUS). Reply to the user in the language they are currently using.
- UI text goes through `src/i18n.ts` (`t(lang, key, vars)`); the model returns message keys
  (`Msg`), never rendered strings. Both dictionaries must have the same keys; a test checks it.
  The server is the exception: it returns plain English error strings, and the UI shows them
  verbatim as the detail of a message.
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
