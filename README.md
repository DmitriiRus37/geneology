# Genealogy

## ENG version

A local family-tree editor. React 19 + TypeScript + Vite on the front, a dependency-free
Node server behind it. The tree is built with the mouse: select a person and the card grows
arrows for "parent", "child", "spouse" and "sibling". Every edit is written to disk at once,
one JSON file per person.

### Quick start

```bash
npm install
npm start
```

This builds the app and serves it at http://127.0.0.1:5179. Stop with `Ctrl+C`. The server
listens on `127.0.0.1` only: it writes to your file system and must not be reachable from
the network.

```bash
npm run serve                          # serve an already built app, no rebuild
node server.mjs --dir /path/to/folder  # keep the data somewhere else
node server.mjs --port 8080            # another port
```

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

### Works without the server too

```bash
npm run build
open dist/genealogy.html
```

`dist/genealogy.html` is a self-contained page with React, styles and data inside. It
opens with a double click and works offline, but it does not write to disk: the tree lives
in browser memory. The bottom of the side panel always says where edits go: a green dot
means `persons/`, a yellow one means the browser. Move a tree between the two modes with
"Save to file" and "Open file".

### Development

```bash
npm run serve       # terminal 1: data server on 5179
npm run dev         # terminal 2: Vite with hot reload on 5178, /api is proxied to 5179
```

```bash
npm test                        # unit tests: dates, names, layout, row order, bus stacking, tree actions, dictionary
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
server.mjs    local server: serves the app, reads and writes persons/. No dependencies
persons/      your data, one file per person
src/
  util.ts     small shared helpers: lists by key, mean, extent, merging into components
  i18n.ts     RU/EN dictionary, t(lang, key, vars); the model returns message keys
  model/      data logic, no DOM
    types.ts    Person, Link, Pair, TreeState
    dates.ts    date parsing: 01.12.1995, 12.1995, "autumn 1938", "1880s", "197?"
    names.ts    name forms, search, sex detection
    tree.ts     links, cycle checks, normalisation of files, hiding ancestors, siblings
    kin.ts      who is who to whom: father, mother, husband, wife, son, daughter, sibling
    store.ts    reducer, undo history, browser storage as the fallback
  layout/     layout and geometry, no DOM
    measure.ts  card size, line wrapping and clipping
    layout.ts   generations, components, family units, row order
    place.ts    x placement: families as clusters packed by contour, in-laws above their child
    order.ts    reordering people within rows so that lines cross less
    crossings.ts crossing and proximity counters shared by the layout and the metrics
    timeline.ts placement by year of birth
    route.ts    routing lines around cards
    edges.ts    the lines: couple bracket, bridges, arrows to children
    couple.ts   side-by-side couple geometry shared by the lines and the row-order scoring
  ui/         React components, rendering and input only
    bits.tsx    shared bits: date field, button row, person line, "close on click outside"
  io/         disk.ts talks to the server; JSON save/open, SVG, PNG and PDF export
  data/       family.json, a small sample tree used to seed an empty persons/
tools/metrics.ts  layout quality metrics
```

The layout is a pure function `layout(state) → { pos, level, tl, lonePlate }`. Its result
is memoised and handed to the components; dragging a card does not recompute the layout,
it replaces one coordinate.

### Features

- **Add** from the side panel or the canvas. The dialog shows at once who the new person
  will be to the selected one: parent, child, spouse or nobody. If a person with that name
  exists, they appear in the suggestions; picking from the list links the existing person
  instead of creating a twin. Names are entered as first name, patronymic, surname.
- **Arrows on the card**: click a person to get "parent" above, "child" below, "spouse" and
  "sibling" at the sides. The spouse goes to whichever side is freer.
- **Siblings.** If the person has parents in the tree, the new sibling becomes their child
  with ordinary lines. Otherwise the kinship is recorded explicitly and drawn dashed; such
  people stand in one row, next to each other.
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
  between rows.
- **Kinship labels**: the list shows who each person is to the selected one. Two roles at
  once are shown together on one line.
- **Same-sex marriage is not created**; the app explains the refusal. Unknown sex of either
  person does not block it.
- **Namesakes are allowed.** "Add" always creates a new person; it warns about a namesake
  but does not stop you.
- People not linked to anyone stand in a separate block under the tree, below a dashed line
  with a caption.
- Sex is detected from the patronymic, the surname, the name ending and role words; a
  coloured strip at the top of the card shows it. It can be corrected in the panel.
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
- Spacing slider, card dragging, search with highlighting, undo (⌘Z), JSON save and open.
- **Export as an image**: SVG, PNG and PDF. The PDF holds the whole tree on one page of its
  own size, losslessly compressed, without libraries.

## RUS version

Локальный редактор родословного древа. React 19 + TypeScript + Vite снаружи, Node-сервер
без зависимостей внутри. Древо растёт мышью: выбрали человека — вокруг карточки появились
стрелки «родитель», «ребёнок», «супруг» и «брат/сестра». Каждая правка тут же ложится на
диск, по файлу на человека.

### Запуск

```bash
npm install
npm start
```

Соберёт приложение и поднимет сервер на http://127.0.0.1:5179. Остановить — `Ctrl+C`.
Сервер слушает только `127.0.0.1`: он пишет в вашу файловую систему, из сети его быть не
должно.

```bash
npm run serve                          # уже собранное приложение, без пересборки
node server.mjs --dir /путь/к/папке    # держать данные в другом месте
node server.mjs --port 8080            # другой порт
```

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
расхождение и предложит перечитать.

### Без сервера тоже работает

```bash
npm run build
open dist/genealogy.html
```

`dist/genealogy.html` — самодостаточный HTML со всем внутри: React, стили, данные.
Открывается двойным щелчком, работает офлайн — но на диск не пишет, хранит древо в памяти
браузера. Внизу панели всегда написано, куда уходят правки: зелёная точка — в `persons/`,
жёлтая — в браузер. Переносить древо между режимами — кнопками «Сохранить в файл» и
«Открыть файл».

### Разработка

```bash
npm run serve       # в одном окне: сервер с данными на 5179
npm run dev         # в другом: vite с горячей перезагрузкой на 5178, /api проксируется на 5179
```

```bash
npm test                        # тесты: даты, имена, раскладка, порядок в рядах, укладка шин, действия над древом, словарь
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
server.mjs    локальный сервер: отдаёт приложение, читает и пишет persons/. Без зависимостей
persons/      ваши данные, по файлу на человека
src/
  util.ts     мелочи на весь проект: списки по ключу, среднее, размах, слияние в куски
  i18n.ts     словарь RU/EN, t(lang, key, vars); модель отдаёт ключи сообщений
  model/      данные, без единого обращения к DOM
    types.ts    Person, Link, Pair, TreeState
    dates.ts    разбор дат: 01.12.1995, 12.1995, «осень 1938», «1880-е гг.», «197?»
    names.ts    формы имени, поиск, определение пола
    tree.ts     связи, проверка петель, приведение файла к валидному виду, скрытие предков, сиблинги
    kin.ts      кто кем приходится: отец, мать, муж, жена, сын, дочь, брат, сестра
    store.ts    редьюсер, история отмен, запасное хранилище в браузере
  layout/     раскладка и геометрия, тоже без DOM
    measure.ts  размеры карточки, перенос и обрезка строк
    layout.ts   поколения, компоненты, семейные ячейки, порядок рядов
    place.ts    расстановка по x: семьи гроздями по контуру, родители мужа или жены — над ним
    order.ts    перестановка людей в рядах, чтобы линии меньше пересекались
    crossings.ts счётчики пересечений и сближений линий — общие для раскладки и метрик
    timeline.ts расстановка по годам рождения
    route.ts    прокладка связей в обход карточек
    edges.ts    линии связей: скобка пары, мостики, стрелки к детям
    couple.ts   геометрия пары бок о бок — общая у линий и у оценки порядка рядов
  ui/         React-компоненты, только отрисовка и ввод
    bits.tsx    общие мелочи: поле даты, ряд кнопок, строка человека, «закрыть по щелчку мимо»
  io/         disk.ts — обмен с сервером; сохранение JSON, выгрузка SVG, PNG и PDF
  data/       family.json — небольшое образцовое древо, им заполняется пустая persons/
tools/metrics.ts  метрики качества раскладки
```

Раскладка — чистая функция `layout(state) → { pos, level, tl, lonePlate }`. Её результат
мемоизуется и раздаётся компонентам; перетаскивание карточки не пересчитывает раскладку,
а подменяет одну координату.

### Что умеет

- **Добавить** — кнопка на панели и на холсте. В окне добавления сразу видно, кем новый
  человек будет для выбранного: родитель, ребёнок, супруг или «сам по себе». Если человек
  с таким именем уже есть, он всплывает в подсказках — выбор из списка связывает
  существующего, а не плодит двойника. Имя вводится в порядке «Имя Отчество Фамилия».
- **Стрелки у карточки** — щёлкните по человеку: сверху «родитель», снизу «ребёнок»,
  сбоку «супруг» и «брат/сестра». Сторона для супруга выбирается там, где свободнее.
- **Брат или сестра.** Если у человека есть родители в древе, новый становится их
  ребёнком — обычные линии. Если родителей нет, родство записывается само и рисуется
  пунктиром; такие люди стоят в одном ряду и рядом.
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
  делаются в зазорах между рядами.
- **Родня подписана** — у каждого в списке видно, кем он приходится выбранному. Две роли
  сразу показываются вместе одной строкой.
- **Однополый брак не создаётся**, приложение объяснит отказ. Если пол хоть у одного не
  указан — не мешает.
- **Тёзки разрешены.** «Добавить» всегда создаёт нового человека; про тёзку предупредит,
  но не помешает.
- Кого ещё ни с кем не связали, тот стоит отдельным блоком под древом, под пунктирной
  чертой с подписью.
- Пол определяется по отчеству, фамилии, окончанию имени и словам-ролям; цветная полоска
  сверху карточки. Поправить можно в панели.
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
- Ползунок **просвет**, перетаскивание карточек, поиск с подсветкой, отмена (⌘Z),
  сохранение и открытие JSON.
- **Выгрузка картинкой**: SVG, PNG и PDF. В PDF попадает всё древо целиком, одной
  страницей размером с него самого, без потерь и без библиотек.
