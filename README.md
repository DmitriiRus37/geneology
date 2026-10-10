# Genealogy

## ENG version

A local family-tree editor. React 19 + TypeScript + Vite on the front, a dependency-free
Node server behind it. The tree is built with the mouse: select a person and the card grows
arrows for "parent", "child", "spouse" and "sibling". Every edit is written to disk at once,
one JSON file per person.

### Requirements

- **Node.js 22.12 or newer** (24 LTS recommended). It comes with `npm`; nothing else is
  needed. `npm test` needs Node 24 or newer.
- A modern browser: Chrome, Safari, Firefox or Edge.
- `git` is optional: the code can be downloaded as a ZIP archive.

### Install and run from scratch

1. **Install Node.js** if `node -v` in a terminal prints nothing or an error.
   - macOS: download the LTS installer from https://nodejs.org and run it, or
     `brew install node` if Homebrew is installed.
   - Windows: download the LTS installer from https://nodejs.org and run it, or
     `winget install OpenJS.NodeJS.LTS`. Then open a new terminal window (PowerShell or
     Command Prompt): the one opened before the installation does not see `npm`.
   - Linux: distribution packages are often old; take the LTS build from https://nodejs.org
     or install it through `nvm`.
   - Check: `node -v` prints `v22.12.0` or higher, `npm -v` prints a version.
2. **Get the code.**
   - With git: `git clone https://github.com/DmitriiRus37/geneology.git`, then
     `cd geneology`.
   - Without git: open https://github.com/DmitriiRus37/geneology, press **Code → Download
     ZIP**, unpack it and open a terminal in the unpacked folder (macOS: right-click the
     folder in Finder → Services → New Terminal at Folder; Windows: Shift + right-click
     inside the folder → Open PowerShell window here).
3. **Install the dependencies** once, with internet access: `npm install`.
4. **Start**: `npm start`. The first start builds the app (a few seconds) and prints
   `http://127.0.0.1:5179`. Open that address in the browser.
5. On the first start the `persons/` folder is created next to the code and filled with a
   small sample tree. Delete the sample people in the app to start your own tree, or keep
   them to look around first.
6. **Stop** the server with `Ctrl+C` in the terminal. Your data stays in `persons/`.
7. **Run again later**: `npm start` (rebuilds and serves), or `npm run serve` when nothing
   changed since the last build.
8. **Update to a newer version**: `git pull`, then `npm install` and `npm start`. Without
   git: unpack the new ZIP and move your `persons/` folder into it; the folder is not part
   of the repository, so nothing overwrites it.

The server listens on `127.0.0.1` only: it writes to your file system and must not be
reachable from the network.

```bash
npm run serve                          # serve an already built app, no rebuild
node server.mjs --dir /path/to/folder  # keep the data somewhere else
node server.mjs --port 8080            # another port
```

### If something goes wrong

- `npm: command not found` or `'npm' is not recognized` — Node.js is not installed, or the
  terminal was opened before the installation. Install Node and open a new terminal.
- Windows PowerShell says `running scripts is disabled on this system` — use `npm.cmd`
  instead of `npm` (`npm.cmd install`, `npm.cmd start`), or allow scripts once with
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- `EADDRINUSE`: port 5179 is busy — `npm run build`, then `node server.mjs --port 8080`.
- The page opens but looks old — reload it bypassing the cache (⌘⇧R on macOS, Ctrl+F5
  elsewhere) after `npm start`.
- `npm install` fails with a network error — the machine has no internet access or a
  proxy blocks https://registry.npmjs.org; the installation needs it once.

### Where the data lives

`persons/` holds one JSON file per person; the file name is the person's id:

```json
{
  "id": "p6-3cn1",
  "name": "Иван Петрович Иванов",
  "maiden": "",
  "alt": [],
  "born": "28.02.1932",
  "died": "17.10.2005",
  "sex": "m",
  "n": 6,
  "parents": ["p2-i832", "p3-2hqu"],
  "spouses": [],
  "siblings": []
}
```

Kinship lives in the cards themselves: `parents` lists whose child the person is,
`spouses` records a marriage without common children (stored on both sides), `siblings`
records brothers and sisters whose shared parents are not in the tree (also on both sides,
drawn as a dashed line). Two people with a common child are a couple already and need no
extra record. Canvas settings live in `persons/_view.json`: the mode, the spacing and
`hidden`, the people removed from view with "Hide ancestors".

- adding a person creates a file;
- changing a date, a name, the sex or dragging a card rewrites only that person's file;
- deleting a person deletes the file.

The server writes through a temporary file and a rename, so an interrupted write never
damages what is already on disk.

### Protection against overwriting

Every server response carries a fingerprint of the folder state. The tab sends it back
with each write, and if anything on disk changed since the tab last read it, the server
rejects the write and touches no file. The tab then stops saving and offers "Re-read from
disk". A forgotten tab with an old tree can no longer erase fresh edits, and a tab refuses
to write to an old server version that does not understand fingerprints. Editing the files
by hand while the server runs is fine: the tab notices the difference and offers to re-read.
A tree read from the server starts the undo history afresh, so undo can never bring back
the tree from before it and write it over someone else's edits. A save deletes only the
cards of people removed in the tab: a file the server cannot read as a card is left alone.

A save that fails for any other reason — the network, a server error — is not lost: it is
retried every few seconds until it goes through, and the app says when saving fails and when
it works again. If a server that keeps the tree in memory restarts empty, the open tab
writes its tree back and says so. When the page is hidden, a pending save goes out at once;
closing a tab whose unsaved tree is too large for the browser's closing request makes the
browser ask first. A slow server is asked three times before the app falls back to keeping
edits in the browser, and it says so when it does.

### Works without the server too

```bash
npm run build
open dist/genealogy.html
```

`dist/genealogy.html` is a self-contained page with React, styles and data inside. It
opens with a double click and works offline, but it does not write to disk: the tree lives
in browser memory. The file is enough on its own: copy it to any computer, even one without
Node.js, and open it in a browser. The bottom of the side panel always says where edits go: a green dot
means `persons/`, a yellow one means the browser. Move a tree between the two modes with
"Save to file" and "Open file".

### On a remote machine

The same app can run on a server, in Docker. There it works differently on purpose: the
tree lives **in the container's memory** and never touches the server's disk. You bring it
in as a zip archive with **Upload archive**, edit it, take it away with **Download archive**
and wipe it with **Clear**. A restart, a reboot or a deploy leaves a clean slate, so nothing
of your family stays on a machine you do not own. A fresh instance comes up genuinely empty:
the sample tree is stripped out of the image, so the page carries nobody's names.

The server holds one tree, not one per visitor: everyone who logs in with the same password
sees the same people, and **Clear** empties it for all of them at once. **Log out** drops the
session.

There can be a second account, the administrator, set through `GENEALOGY_ADMIN_USER` and
`GENEALOGY_ADMIN_PASS`. It is the only one that may open `/admin`, where every sign-in and
every attempt at one is listed — when, what login was typed, from which address, whether it
was let through, and which browser. The newest 10 000 (`GENEALOGY_ATTEMPTS` changes that)
are kept as `logs/logins.jsonl` next to the request log — one JSON object per line,
`{"when":…,"login":…,"address":…,"result":…,"browser":…}` — so a restart or a redeploy does
not lose them, and the page links to the raw file. JSON does the escaping, so nothing the
login field can carry will forge a record or break a line. Both logs record the address of
the connection itself: `X-Forwarded-For` is anybody's to write, so it is ignored unless
`GENEALOGY_TRUST_PROXY=1` is set — only for a reverse proxy of your own in front of the
container, whose entry (the last one) is then used.

Each row also shows where the address is, roughly — `Warsaw, PL`. That comes from
ipinfo.io, with get.geojs.io and ipwho.is behind it: the first to answer wins, so one being
down or rate-limiting costs nothing. Answers are remembered for as long as the server runs.
Nothing is looked up until an administrator opens the page, and only for the rows on it — a
stranger signing in does not send their address anywhere. Private and loopback addresses are
never looked up at all. The table draws the newest 500; the file holds the rest.

The administrator lands on `/admin` straight after signing in and can still open the tree.
Without those two variables the page exists for nobody.

```bash
make check                                   # typecheck, build and tests; make deploy will not ship while it is red
GENEALOGY_USER=fam GENEALOGY_PASS='secret' make run_local   # try the image here first
make smoke                                   # check the running instance
```

Rolling out to the server:

```bash
PROD_HOST=1.2.3.4 SSHPASS='<root password>' \
GENEALOGY_USER=fam GENEALOGY_PASS='<tree password>' make deploy
```

The image is built here and shipped as a tarball; the server only loads it and starts the
container — it compiles nothing and keeps no toolchain. `GENEALOGY_USER` and
`GENEALOGY_PASS` guard the service, and compose refuses to start without them, so the tree
cannot end up on the open internet unprotected by accident. A browser is sent to a login
page at `/login` and gets a session cookie that lasts until the server restarts; `/logout`
drops it. Tools keep using HTTP Basic, so `curl -u`, `make backup` and `make smoke` work
unchanged.

Because the tree is in memory, **a deploy wipes it**. Take the archive first and put it
back afterwards:

```bash
make backup                                  # writes backups/persons_<date>.zip, keeps five
```

The server writes one line per request into `logs/access.log` next to the compose file —
timestamp, client address, method, path, status, whether credentials were offered
(`auth` or `-`, never the password itself), duration and user agent. At 10 MB it
rotates itself: the file is gzipped into `access.log.1.gz`, the older ones shift up and
anything past the third is dropped, so the log can never fill the disk. Headers and bodies
never reach it, so neither the password nor the tree is in there.

```bash
make applog                                  # the last lines, and what rotation kept
make applog_grep PATTERN=192.0.2.7           # search the gzipped history too
```

Two things worth knowing. Basic auth over plain HTTP sends the password in clear text — on
an untrusted network put TLS in front or reach the service through an SSH tunnel. And the
local `persons/` folder is never touched by any of this: the remote instance only ever
holds what has been uploaded to it.

### Development

```bash
npm run serve       # terminal 1: data server on 5179
npm run dev         # terminal 2: Vite with hot reload on 5178, /api is proxied to 5179
```

```bash
npm test                        # all tests (Node 24+): dates, names, layout, row order, bus stacking, tree actions, dictionary,
                                #   the server's HTTP API, layout snapshots, random trees, interface markup
npm run test:update             # after a deliberate change: rewrite the snapshots, then read their diff
npm run typecheck
node tools/metrics.ts           # layout quality metrics on persons/
node tools/metrics.ts /path/to/copy   # the same on a copy of the data
```

Tests run directly in Node, which strips the types from `.ts` itself; no browser or DOM
shims are needed because all logic lives in plain modules. Text width measurement in Node
falls back to a character-count estimate, see `src/layout/measure.ts`. Run the metrics
before and after any change to the layout: nearly every improvement of one number costs
another.

### Project structure

```
server.mjs    starts the local server: serves the app, reads and writes persons/. No dependencies
server/       the server itself, TypeScript that Node runs as it is
  main.ts       settings in, parts built, port opened
  routes.ts     every route in the order it is tried
  tree.ts       the tree over a store, the write queue and the version check
  stores.ts     disk and memory stores behind one interface
  auth.ts       passwords, the login ticket, who is asking
  attempts.ts   the sign-in log; pages.ts, geo.ts: the admin page and where addresses are
  accesslog.ts  the request log and its rotation; zip.ts, http.ts, config.ts
persons/      your data, one file per person
src/
  util.ts     small shared helpers: lists by key, mean, extent, merging into components
  i18n.ts     RU/EN dictionary, t(lang, key, vars); the model returns message keys
  model/      data logic, no DOM
    types.ts    Person, Link, Pair, TreeState
    cards.ts    the file format: cards <-> tree, shared with the server
    dates.ts    date parsing: 01.12.1995, 12.1995, "autumn 1938", "1880s", "197?"
    names.ts    name forms, search, sex detection
    tree.ts     links, cycle checks, normalisation of files, hiding ancestors, siblings
    kin.ts      who is who to whom: father, mother, husband, wife, son, daughter, sibling
    store.ts    reducer and undo history
  layout/     layout and geometry, no DOM
    measure.ts  card size, line wrapping and clipping; the measuring and the words come from outside
    layout.ts   the pipeline: card boxes, rows, the unplaced block, pinned cards
    families.ts parents and children, connected pieces, family units for the layout and for the lines
    levels.ts   generations: which row everyone stands in
    rows.ts     the first row order, by traversal
    place.ts    x placement: families as clusters packed by contour, in-laws above their child
    order.ts    reordering people within rows so that lines cross less
    crossings.ts crossing and proximity counters shared by the layout and the metrics
    timeline.ts placement by year of birth
    route.ts    routing lines around cards
    detour.ts   a way round the cards on a grid, for a line the usual route cannot take
    edges.ts    the lines: couple bracket, bridges, arrows to children
    couple.ts   side-by-side couple geometry shared by the lines and the row-order scoring
  ui/         React components, rendering and input only
    bits.tsx    shared bits: date field, button row, person line, "close on click outside"
    sheet.ts    the side panel as a sheet on a phone: three heights, drag and flick
    screen.ts   the phone media query and the bar's height, which the stylesheet repeats (a test holds them together)
    Board.tsx   the canvas: puts the pieces of board/ together and draws
    board/      view.ts: the scale and offset and the arithmetic of moving them; gestures.ts: what a finger
                or a mouse means, as a plain automaton; useView.ts, useGestures.ts: both wired to React;
                Popovers.tsx: the add window and the menu of a line
    cards.ts    what the layout needs from the screen: a canvas to measure text, card words in the language
    useSync.ts  the sync engine wired into React; keys.ts: what a key press means
  io/         talking to the server and to files
    api.ts      the server's HTTP API, one request per function
    sync.ts     keeping the tree in step with the server: fingerprint, write queue, autosave
    local.ts    the browser's copy when there is no server
    files.ts, exportSvg.ts, exportPdf.ts: JSON save/open, SVG, PNG and PDF export
  data/       family.json, a small sample tree used to seed an empty persons/
tools/metrics.ts  layout quality metrics
tools/smoke.mjs   smoke check of a running instance, local or remote
Dockerfile        the image for a remote machine: build stage, then node and one html
docker-compose-prod.yml  what runs on the server: one service, no database, no volume
Makefile          build, ship, logs, backup
```

The layout is a pure function `layout(state, cards) → { pos, level, tl, lonePlate }`,
where `cards` sizes a card (the browser measures with a canvas, the tests and the metrics
by characters). Its result
is memoised and handed to the components; dragging a card does not recompute the layout,
it replaces one coordinate.

### Features

- **Add** from the side panel or the canvas. The dialog shows at once who the new person
  will be to the selected one: parent, child, spouse or nobody. If a person with that name
  exists, they appear in the suggestions; picking from the list links the existing person
  instead of creating a twin. Names are entered as first name, patronymic, surname.
- **Arrows on the card**: click a person to get "parent" above, "child" below, "spouse" and
  "sibling" at the sides. The spouse goes to whichever side is freer.
- **Siblings.** If one of the two has parents in the tree and the other has none, the other
  gets the same parents, with ordinary lines. If both have parents, or neither, the kinship
  is recorded explicitly and drawn dashed; such people stand in one row, next to each other.
- **Hide ancestors.** Select a person and hide their ancestors together with everything
  growing from them, except the person, their family and descendants. "Bring everyone back"
  restores the view. Remembered in `_view.json`.
- **Dates.** A bare year becomes `??.??.1995`: the day and month are unknown, not
  forgotten. Existing records are rewritten the same way on load. `197?` means an
  approximate year: the middle of the decade is used for ordering and rows, and in
  timeline mode the card is marked as an estimate.
- **Generation rows.** Siblings share a row. A person with no link to the tree is placed in
  the row that matches their year of birth rather than at the top.
- **Two languages.** RU/EN switch at the bottom of the side panel; the choice is kept in
  the browser. Date labels on the cards change with the language.
- **Link two drawn people** with the panel buttons, then click the second person.
- **Remove a link** by clicking the line itself. The popup shows what the line holds, and
  each relation can be removed separately.
- **Lines do not pass through cards.** If someone stands in the way, the vertical moves
  into the nearest gap between cards and comes back under it; turns are made in the gaps
  between rows. By years too: an estimated year keeps clear of the parents' and children's,
  and a line that cannot take the usual down–across–down route finds its way round.
- **Kinship labels**: the list shows who each person is to the selected one. Two roles at
  once are shown together on one line.
- **Same-sex marriage is not created**; the app explains the refusal. Unknown sex of either
  person does not block it. Nor is a marriage with one's own ancestor or descendant, nor a
  parent link that would make two spouses parent and descendant.
- **Namesakes are allowed.** "Add" always creates a new person; it warns about a namesake
  but does not stop you.
- People not linked to anyone stand in a separate block under the tree, below a dashed line
  with a caption.
- Sex is detected from the patronymic, the surname, the name ending and role words; a
  coloured strip at the top of the card shows it. A name the rules do not recognise (one in
  Latin letters, say) leaves it unknown. It can be corrected in the panel.
- **Timeline mode**: vertical position by year of birth with a sticky year scale on the
  left. Missing years are estimated from relatives and marked; a spouse counts more than
  other relatives.
- **A parent is always exactly one row above the children.** If a marriage pulls a person
  down, their relatives follow rather than staying at the top; empty rows collapse.
- **Arrows to children go straight down.** Parents stand over the middle of their children,
  an only child exactly under them, and the parents of a spouse above their own child.
  Families are packed as clusters by contour, as in classic tree layouts; when a family does
  not fit, the other family moves right, never the child out from under its parents.
- A person with two families gets one spouse on the left and one on the right.
- **Lines try not to cross.** After the traversal, rows are reordered: blocks (a couple
  stays together) are sorted by their kin in the neighbouring row, sibling seniority is
  kept, and every candidate order is scored by the real line routing. What was already good
  is not broken. Family buses that share a band between rows are stacked so that they cut
  each other's descents as rarely as possible.
- **Saving** one second after the last edit, and immediately when you switch to another
  person or leave a field.
- **Two fingers on the trackpad pan the canvas**, pinch zooms. The mouse wheel pans too
  (Shift for sideways); zoom with ⌘ or Ctrl, the `+`/`−` buttons, or a pinch on a touch
  screen.
- **On a phone the tree takes the whole screen** and the side panel becomes a sheet at
  the bottom. At rest it shows only the search and the add button; its grab bar is
  dragged or flicked up to half the screen or nearly all of it, and a tap on the bar opens
  and closes it. Tapping a person on the tree brings the sheet up with their fields and
  keeps them in sight above it; tapping the empty canvas sends it back down. A finger pans
  the tree even when it starts on a card — to move a card, rest the finger on it for a
  moment first; a second finger while you carry it puts it back, unsaved, and zooms. The
  canvas controls fold into one row at the top, the rest behind "more". While edits are not
  being saved, the head of the sheet says so and offers to re-read.
- **Undo (⌘Z)** takes back one step. Typing into a field is one step per field; changing
  the spacing or switching to years can be undone, pinned cards included. Inside a text
  field ⌘Z and ⇧⌘Z belong to the field's own typing.
- **Files are forgiving.** A card with a broken link list still loads, an unusable id gets
  a new one, a link written twice counts once, fields the app does not know are kept and
  written back, and other JSON in the folder is left alone.
- Spacing slider, card dragging, search with highlighting, JSON save and open.
- **Export as an image**: SVG, PNG and PDF. The PDF holds the whole tree on one page of its
  own size, losslessly compressed, without libraries.

## RUS version

Локальный редактор родословного древа. React 19 + TypeScript + Vite снаружи, Node-сервер
без зависимостей внутри. Древо растёт мышью: выбрали человека — вокруг карточки появились
стрелки «родитель», «ребёнок», «супруг» и «брат/сестра». Каждая правка тут же ложится на
диск, по файлу на человека.

### Что нужно

- **Node.js 22.12 или новее** (лучше 24 LTS). Вместе с ним ставится `npm`; больше ничего
  не нужно. Для `npm test` нужен Node 24 или новее.
- Современный браузер: Chrome, Safari, Firefox или Edge.
- `git` не обязателен: код можно скачать ZIP-архивом.

### Установка и запуск с нуля

1. **Поставьте Node.js**, если `node -v` в терминале ничего не печатает или даёт ошибку.
   - macOS: скачайте установщик LTS с https://nodejs.org и запустите, либо
     `brew install node`, если стоит Homebrew.
   - Windows: скачайте установщик LTS с https://nodejs.org и запустите, либо
     `winget install OpenJS.NodeJS.LTS`. Потом откройте новое окно терминала (PowerShell
     или командная строка): открытое до установки `npm` не видит.
   - Linux: пакеты дистрибутива часто старые; берите LTS-сборку с https://nodejs.org или
     ставьте через `nvm`.
   - Проверка: `node -v` печатает `v22.12.0` или выше, `npm -v` печатает версию.
2. **Получите код.**
   - С git: `git clone https://github.com/DmitriiRus37/geneology.git`, затем
     `cd geneology`.
   - Без git: откройте https://github.com/DmitriiRus37/geneology, нажмите **Code → Download
     ZIP**, распакуйте и откройте терминал в распакованной папке (macOS: правый щелчок по
     папке в Finder → Службы → Новый терминал в папке; Windows: Shift + правый щелчок внутри
     папки → Открыть окно PowerShell здесь).
3. **Поставьте зависимости** — один раз, нужен интернет: `npm install`.
4. **Запустите**: `npm start`. Первый запуск соберёт приложение (несколько секунд) и
   напечатает `http://127.0.0.1:5179`. Откройте этот адрес в браузере.
5. При первом запуске рядом с кодом появится папка `persons/` с небольшим образцовым
   древом. Удалите образцовых людей в приложении, чтобы начать своё древо, или сначала
   осмотритесь на них.
6. **Остановить** сервер — `Ctrl+C` в терминале. Данные остаются в `persons/`.
7. **Запустить снова**: `npm start` (пересобирает и запускает) или `npm run serve`, если с
   прошлой сборки ничего не менялось.
8. **Обновиться до новой версии**: `git pull`, затем `npm install` и `npm start`. Без git:
   распакуйте новый ZIP и перенесите в него свою папку `persons/` — она не входит в
   репозиторий, и ничто её не перезапишет.

Сервер слушает только `127.0.0.1`: он пишет в вашу файловую систему, из сети его быть не
должно.

```bash
npm run serve                          # уже собранное приложение, без пересборки
node server.mjs --dir /путь/к/папке    # держать данные в другом месте
node server.mjs --port 8080            # другой порт
```

### Если что-то не так

- `npm: command not found` или `"npm" не является внутренней или внешней командой` —
  Node.js не установлен или терминал открыт до установки. Поставьте Node и откройте новый
  терминал.
- PowerShell пишет `выполнение сценариев отключено в этой системе` — вместо `npm` пишите
  `npm.cmd` (`npm.cmd install`, `npm.cmd start`) либо один раз разрешите сценарии:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- `EADDRINUSE`: порт 5179 занят — `npm run build`, затем `node server.mjs --port 8080`.
- Страница открылась, но выглядит по-старому — перезагрузите её без кэша (⌘⇧R на macOS,
  Ctrl+F5 в остальных) после `npm start`.
- `npm install` падает с сетевой ошибкой — нет интернета или прокси не пускает к
  https://registry.npmjs.org; установке он нужен один раз.

### Где лежат данные

`persons/` — один JSON на человека, имя файла совпадает с его id:

```json
{
  "id": "p6-3cn1",
  "name": "Иван Петрович Иванов",
  "maiden": "",
  "alt": [],
  "born": "28.02.1932",
  "died": "17.10.2005",
  "sex": "m",
  "n": 6,
  "parents": ["p2-i832", "p3-2hqu"],
  "spouses": [],
  "siblings": []
}
```

Родство живёт в самих карточках: `parents` — чьим ребёнком человек является, `spouses` —
брак без общих детей (записывается у обоих), `siblings` — родные братья и сёстры, у которых
общих родителей в древе нет (тоже у обоих; рисуется пунктиром). Если у двоих есть общий
ребёнок, они и так пара — отдельной записи не нужно. Настройки холста — в
`persons/_view.json`: режим, просвет и `hidden` — кого срезали кнопкой «Скрыть предков».

- добавили человека — появился новый файл;
- поправили дату, имя, пол, перетащили карточку — переписался только его файл;
- удалили человека — файл исчез вместе с ним.

Сервер пишет через временный файл с переименованием, так что оборванная запись не
испортит уже лежащий на диске.

### Защита от затирания

Каждый ответ сервера содержит отпечаток состояния папки. Вкладка присылает его обратно
вместе с записью, и если на диске с момента её последнего чтения что-то изменилось —
сервер отклоняет запись и не трогает ни одного файла. Вкладка после этого перестаёт
сохранять и предлагает «Перечитать с диска». Забытая вкладка со старым древом не может
стереть свежие правки, а в сервер старой версии, не понимающий отпечатков, вкладка писать
отказывается. Править файлы руками при запущенном сервере можно: вкладка увидит
расхождение и предложит перечитать. Древо, прочитанное с сервера, начинает историю отмен
заново: «Отменить» не вернёт древо, которое было до него, и не запишет его поверх чужих
правок. Сохранение удаляет только карточки людей, удалённых во вкладке: файл, который
сервер не может прочитать как карточку, остаётся на месте.

Сохранение, сорвавшееся по другой причине — сеть, ошибка сервера, — не теряется: оно
повторяется каждые несколько секунд, пока не пройдёт, а приложение говорит, когда
сохранить не удалось и когда снова получилось. Если сервер, держащий древо в памяти,
перезапустился пустым, открытая вкладка записывает своё древо обратно и сообщает об этом.
Когда страница уходит в фон, отложенное сохранение уходит сразу; при закрытии вкладки с
несохранённым древом, слишком большим для прощального запроса браузера, браузер сначала
спросит. Медленный сервер спрашивают трижды, прежде чем перейти к хранению правок в
браузере, — и об этом говорят.

### Без сервера тоже работает

```bash
npm run build
open dist/genealogy.html
```

`dist/genealogy.html` — самодостаточный HTML со всем внутри: React, стили, данные.
Открывается двойным щелчком, работает офлайн — но на диск не пишет, хранит древо в памяти
браузера. Файла достаточно самого по себе: скопируйте его на любой компьютер, даже без
Node.js, и откройте в браузере. Внизу панели всегда написано, куда уходят правки: зелёная точка — в `persons/`,
жёлтая — в браузер. Переносить древо между режимами — кнопками «Сохранить в файл» и
«Открыть файл».

### На удалённой машине

То же приложение умеет работать на сервере, в Docker. Там оно устроено нарочно иначе:
древо живёт **в памяти контейнера** и до диска сервера не доходит. Вы привозите его
zip-архивом кнопкой **«Загрузить архив»**, правите, увозите кнопкой **«Скачать архив»** и
стираете кнопкой **«Очистить»**. Перезапуск, перезагрузка и выкладка оставляют чистый лист —
на чужой машине от вашей семьи не остаётся ничего. Свежий экземпляр поднимается по-настоящему
пустым: образцовое древо вырезано из образа, и на странице нет ничьих имён.

Древо у сервера одно, а не по штуке на посетителя: все, кто вошёл тем же паролем, видят одних
и тех же людей, и **«Очистить»** опустошает древо сразу для всех. **«Выйти»** сбрасывает сессию.

Может быть и вторая учётная запись, администратор: `GENEALOGY_ADMIN_USER` и
`GENEALOGY_ADMIN_PASS`. Только ей открыт `/admin`, где перечислены все входы и попытки войти —
когда, какой логин набрали, с какого адреса, пустили ли и какой браузер. Последние 10 000
(`GENEALOGY_ATTEMPTS` меняет число) лежат в `logs/logins.jsonl` рядом с журналом запросов —
по объекту JSON на строку, `{"when":…,"login":…,"address":…,"result":…,"browser":…}`, — так что
перезапуск и выкладка их не теряют, а со страницы файл открывается как есть. Экранирует сам
JSON: что бы ни набрали в поле логина, подделать запись или разорвать строку не выйдет.
Оба журнала пишут адрес самого соединения: `X-Forwarded-For` может прислать кто угодно,
поэтому он не учитывается, пока не задано `GENEALOGY_TRUST_PROXY=1` — только для своего
обратного прокси перед контейнером; тогда берётся его запись, последняя.

В каждой строке видно и примерное место адреса — `Warsaw, PL`. Его спрашивают у ipinfo.io, а
за ним стоят get.geojs.io и ipwho.is: отвечает первый откликнувшийся, так что недоступность
одного ничего не стоит. Ответы помнятся, пока сервер жив. Пока администратор не откроет
страницу, никто никуда не ходит, и спрашивают только про строки на ней — вошедший не
отправляет свой адрес наружу. Локальные адреса не спрашивают вовсе. В таблице рисуются
последние 500 записей, остальные остаются в файле.

Администратор попадает на `/admin` сразу после входа и по-прежнему может открыть древо. Без
этих двух переменных страницы нет ни для кого.

```bash
make check                                   # типы, сборка и тесты; make deploy не выкатит, пока они красные
GENEALOGY_USER=fam GENEALOGY_PASS='secret' make run_local   # сперва посмотреть у себя
make smoke                                   # проверить поднятый экземпляр
```

Выкладка на сервер:

```bash
PROD_HOST=1.2.3.4 SSHPASS='<пароль root>' \
GENEALOGY_USER=fam GENEALOGY_PASS='<пароль к древу>' make deploy
```

Образ собирается здесь и уезжает тарболом; сервер только загружает его и поднимает
контейнер — сам он ничего не собирает и инструментов не держит. `GENEALOGY_USER` и
`GENEALOGY_PASS` закрывают сервис, и без них compose просто не стартует: древо не окажется
в открытом доступе по недосмотру. Браузер попадает на страницу входа `/login` и получает
печенье сессии — оно живёт до перезапуска сервера, а `/logout` его снимает. Инструменты
ходят по-прежнему через HTTP Basic, так что `curl -u`, `make backup` и `make smoke`
работают как работали.

Раз древо в памяти, **выкладка его стирает**. Сначала заберите архив, потом верните:

```bash
make backup                                  # кладёт backups/persons_<дата>.zip, хранит пять
```

Сервер пишет по строке на запрос в `logs/access.log` рядом с compose-файлом: время, адрес
клиента, метод, путь, код ответа, предъявлялся ли пароль (`auth` или `-`, но никогда сам
пароль), длительность и user-agent. На 10 МБ он сам себя
прокручивает — файл уезжает в `access.log.1.gz`, прежние сдвигаются на номер дальше, а всё,
что старше третьего, удаляется: переполнить диск журнал не может. Заголовки и тела в него
не попадают, так что ни пароля, ни древа там нет.

```bash
make applog                                  # последние строки и что осталось от ротации
make applog_grep PATTERN=192.0.2.7           # искать и в сжатой истории
```

Две вещи, о которых стоит помнить. Пароль при HTTP Basic поверх обычного HTTP идёт
открытым текстом — в недоверенной сети поставьте впереди TLS или ходите через SSH-туннель.
И локальная папка `persons/` во всём этом не участвует: на удалённом экземпляре лежит
только то, что туда загрузили.

### Разработка

```bash
npm run serve       # в одном окне: сервер с данными на 5179
npm run dev         # в другом: vite с горячей перезагрузкой на 5178, /api проксируется на 5179
```

```bash
npm test                        # все тесты (Node 24+): даты, имена, раскладка, порядок в рядах, укладка шин, действия над древом, словарь,
                                #   HTTP-API сервера, снимки раскладки, случайные деревья, разметка интерфейса
npm run test:update             # после намеренного изменения: переписать снимки и прочитать их дифф
npm run typecheck
node tools/metrics.ts           # метрики качества раскладки на persons/
node tools/metrics.ts /путь/к/копии   # то же на копии данных
```

Тесты гоняются прямо в Node (он сам снимает типы с `.ts`), браузер и заглушки DOM не
нужны: вся логика лежит в обычных модулях. Замер ширины текста в Node падает на прикидку по
числу символов — см. `src/layout/measure.ts`. Метрики гоняйте до и после любой правки
раскладки: почти любое улучшение одного числа стоит другого.

### Как устроено

```
server.mjs    запускает локальный сервер: отдаёт приложение, читает и пишет persons/. Без зависимостей
server/       сам сервер, TypeScript, который Node запускает как есть
  main.ts       настройки, сборка частей, открытие порта
  routes.ts     все маршруты в том порядке, в каком они проверяются
  tree.ts       дерево поверх хранилища, очередь записи и проверка версии
  stores.ts     хранилища на диске и в памяти за одним интерфейсом
  auth.ts       пароли, билет входа, кто спрашивает
  attempts.ts   журнал входов; pages.ts, geo.ts: страница администратора и где находятся адреса
  accesslog.ts  журнал запросов и его ротация; zip.ts, http.ts, config.ts
persons/      ваши данные, по файлу на человека
src/
  util.ts     мелочи на весь проект: списки по ключу, среднее, размах, слияние в куски
  i18n.ts     словарь RU/EN, t(lang, key, vars); модель отдаёт ключи сообщений
  model/      данные, без единого обращения к DOM
    types.ts    Person, Link, Pair, TreeState
    cards.ts    формат файлов: карточки <-> дерево, общий с сервером
    dates.ts    разбор дат: 01.12.1995, 12.1995, «осень 1938», «1880-е гг.», «197?»
    names.ts    формы имени, поиск, определение пола
    tree.ts     связи, проверка петель, приведение файла к валидному виду, скрытие предков, сиблинги
    kin.ts      кто кем приходится: отец, мать, муж, жена, сын, дочь, брат, сестра
    store.ts    редьюсер и история отмен
  layout/     раскладка и геометрия, тоже без DOM
    measure.ts  размеры карточки, перенос и обрезка строк; замер и слова приходят снаружи
    layout.ts   весь конвейер: карточки, ряды, блок неразмещённых, закреплённые карточки
    families.ts родители и дети, связные куски, семейные ячейки для раскладки и для линий
    levels.ts   поколения: кто в каком ряду
    rows.ts     первый порядок в рядах, обходом
    place.ts    расстановка по x: семьи гроздями по контуру, родители мужа или жены — над ним
    order.ts    перестановка людей в рядах, чтобы линии меньше пересекались
    crossings.ts счётчики пересечений и сближений линий — общие для раскладки и метрик
    timeline.ts расстановка по годам рождения
    route.ts    прокладка связей в обход карточек
    detour.ts   обход карточек по сетке для линии, которой не годится обычный маршрут
    edges.ts    линии связей: скобка пары, мостики, стрелки к детям
    couple.ts   геометрия пары бок о бок — общая у линий и у оценки порядка рядов
  ui/         React-компоненты, только отрисовка и ввод
    bits.tsx    общие мелочи: поле даты, ряд кнопок, строка человека, «закрыть по щелчку мимо»
    sheet.ts    боковая панель как шторка на телефоне: три высоты, перетаскивание и смахивание
    screen.ts   медиазапрос телефона и высота панели, которые повторяет таблица стилей (тест держит их вместе)
    Board.tsx   холст: собирает части из board/ и рисует
    board/      view.ts: масштаб и сдвиг и арифметика их изменения; gestures.ts: что значит палец или мышь,
                простым автоматом; useView.ts, useGestures.ts: оба подключены к React;
                Popovers.tsx: окно добавления и меню линии
    cards.ts    что раскладке нужно от экрана: канвас для замера текста, слова карточки на нужном языке
    useSync.ts  движок синхронизации, подключённый к React; keys.ts: что значит нажатая клавиша
  io/         обмен с сервером и с файлами
    api.ts      HTTP-API сервера, по функции на запрос
    sync.ts     древо в ногу с сервером: отпечаток версии, очередь записи, автосохранение
    local.ts    копия в браузере, когда сервера нет
    files.ts, exportSvg.ts, exportPdf.ts: сохранение JSON, выгрузка SVG, PNG и PDF
  data/       family.json — небольшое образцовое древо, им заполняется пустая persons/
tools/metrics.ts  метрики качества раскладки
tools/smoke.mjs   проверка поднятого экземпляра, своего или удалённого
Dockerfile        образ для удалённой машины: стадия сборки, дальше node и один html
docker-compose-prod.yml  что крутится на сервере: одна служба, без базы и без тома
Makefile          сборка, выкладка, логи, резервная копия
```

Раскладка — чистая функция `layout(state, cards) → { pos, level, tl, lonePlate }`,
где `cards` задаёт размер карточки (браузер меряет канвасом, тесты и метрики — по числу
символов). Её результат
мемоизуется и раздаётся компонентам; перетаскивание карточки не пересчитывает раскладку,
а подменяет одну координату.

### Что умеет

- **Добавить** — кнопка на панели и на холсте. В окне добавления сразу видно, кем новый
  человек будет для выбранного: родитель, ребёнок, супруг или «сам по себе». Если человек
  с таким именем уже есть, он всплывает в подсказках — выбор из списка связывает
  существующего, а не плодит двойника. Имя вводится в порядке «Имя Отчество Фамилия».
- **Стрелки у карточки** — щёлкните по человеку: сверху «родитель», снизу «ребёнок»,
  сбоку «супруг» и «брат/сестра». Сторона для супруга выбирается там, где свободнее.
- **Брат или сестра.** Если у одного из двоих есть родители в древе, а у другого нет,
  другой получает тех же родителей — обычные линии. Если родители есть у обоих или ни у
  кого, родство записывается само и рисуется пунктиром; такие люди стоят в одном ряду и рядом.
- **Скрыть предков.** Выберите человека и нажмите «Скрыть предков»: его предки и всё, что
  растёт от них, кроме него самого, его семьи и потомков, уходят с холста. «Вернуть всех»
  возвращает. Запоминается в `_view.json`.
- **Даты.** Голый год становится «??.??.1995» — день и месяц неизвестны, а не забыты; уже
  записанные даты переписываются так же при загрузке. «197?» — год известен
  приблизительно: для порядка и рядов берётся середина десятилетия, по годам такая
  карточка помечена как оценка.
- **Ряды по поколениям.** Братья и сёстры стоят в одном ряду, а люди без единой связи с
  древом встают в ряд, подходящий по году рождения, а не в шапку.
- **Два языка.** Переключатель RU/EN внизу боковой панели; выбор помнится в браузере.
  Подписи дат на карточках меняются вместе с языком.
- **Соединить двух уже нарисованных** — кнопки в панели, потом щелчок по второму человеку.
- **Убрать связь** — щёлкните по самой линии на холсте. Покажется, что она держит, и
  каждую связь можно убрать по отдельности.
- **Линии не проходят сквозь карточки.** Если на пути связи стоит чужой человек,
  вертикаль уходит в ближайший просвет между карточками и возвращается под ним; повороты
  делаются в зазорах между рядами. По годам тоже: оценённый год держится в стороне от лет
  родителей и детей, а линия, которой не годится обычный маршрут «вниз — вбок — вниз»,
  находит обход сама.
- **Родня подписана** — у каждого в списке видно, кем он приходится выбранному. Две роли
  сразу показываются вместе одной строкой.
- **Однополый брак не создаётся**, приложение объяснит отказ. Если пол хоть у одного не
  указан — не мешает. Не создаётся и брак со своим предком или потомком, и связь
  «родитель — ребёнок», после которой супруги оказались бы предком и потомком.
- **Тёзки разрешены.** «Добавить» всегда создаёт нового человека; про тёзку предупредит,
  но не помешает.
- Кого ещё ни с кем не связали, тот стоит отдельным блоком под древом, под пунктирной
  чертой с подписью.
- Пол определяется по отчеству, фамилии, окончанию имени и словам-ролям; цветная полоска
  сверху карточки. Незнакомое правилам имя (например, латиницей) оставляет пол неизвестным.
  Поправить можно в панели.
- Режим **по годам** — вертикаль по году рождения, липкая шкала лет слева. Недостающие
  годы оцениваются по родне и помечаются, причём супруг важнее прочей родни.
- **Родитель всегда ровно на ряд выше детей.** Если брак уводит человека вниз, вся его
  родня едет за ним, а не остаётся в шапке древа. Пустые ряды схлопываются.
- **Стрелка к ребёнку идёт строго вниз.** Родители стоят над серединой своих детей,
  единственный ребёнок — ровно под ними, а родители мужа или жены — над своим ребёнком.
  Семьи укладываются гроздями вплотную по контуру, как в классической раскладке деревьев:
  если чья-то родня не помещается, вправо отодвигается чужая семья, а не ребёнок из-под
  родителей.
- У кого две семьи, тому одного супруга ставим слева, другого справа.
- **Линии стараются не пересекаться.** После обхода ряды переставляются: блоки (супруги
  вместе) сортируются по родне в соседнем ряду, старшинство братьев и сестёр сохраняется,
  а каждый вариант порядка оценивается по настоящей прокладке линий. Что уже стояло
  хорошо, при этом не ломается. Шины семей, делящих одну полосу между рядами,
  укладываются так, чтобы реже резать друг другу спуски.
- **Сохранение** — через секунду после последней правки, а при переходе к другому человеку
  или уходе из поля — сразу.
- **Двумя пальцами по трекпаду — двигаем полотно**, щипком — масштаб. Колесо мыши тоже
  двигает полотно (Shift — вбок), масштаб на нём — с ⌘ или Ctrl, кнопками `+`/`−` и
  щипком на сенсорном экране.
- **На телефоне древо занимает весь экран**, а боковая панель становится шторкой снизу.
  В покое в ней только поиск и кнопка «Добавить»; за полоску её тянут или смахивают вверх
  до половины экрана или почти во весь экран, а касание полоски открывает и закрывает её.
  Касание человека на древе поднимает шторку с его полями и держит его на виду над ней;
  касание пустого холста опускает её обратно. Палец двигает древо, даже если лёг на
  карточку, — чтобы передвинуть карточку, на ней сначала надо задержать палец; второй
  палец во время переноса возвращает карточку на место, не сохраняя, и включает масштаб.
  Кнопки над холстом сворачиваются в один ряд сверху, остальное — за «Ещё». Пока правки не
  сохраняются, об этом говорит шапка шторки и предлагает перечитать.
- **Отмена (⌘Z)** возвращает один шаг. Ввод в поле — один шаг на поле; смену просвета и
  переход «по годам» тоже можно отменить, вместе с закреплёнными карточками. В текстовом
  поле ⌘Z и ⇧⌘Z относятся к набору в самом поле.
- **Файлы прощают ошибки.** Карточка с испорченным списком связей всё равно читается,
  негодный id получает новый, дважды записанная связь считается один раз, незнакомые
  приложению поля сохраняются и пишутся обратно, а чужой JSON в папке не трогается.
- Ползунок **просвет**, перетаскивание карточек, поиск с подсветкой, сохранение и открытие
  JSON.
- **Выгрузка картинкой**: SVG, PNG и PDF. В PDF попадает всё древо целиком, одной
  страницей размером с него самого, без потерь и без библиотек.
