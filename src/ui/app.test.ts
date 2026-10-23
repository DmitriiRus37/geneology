/**
 * The whole app in a DOM (happy-dom) against a real test server (server/testing.ts):
 * what a person does on the page, and what reaches the persons folder. The trees are
 * synthetic, the interface is in English.
 */
import { $, $$, browser, answers, byText, click, downloads, fire, key, mount, nodeFetch, pointer, resizeAll, setRect, settle, type, until, type Mounted } from "../testing/dom.ts";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { card, getTree, postTree, startServer, unzip, zip, type Running, type ServerOptions } from "../../server/testing.ts";
import { t } from "../i18n.ts";

const { createElement: h } = await import("react");
const { App } = await import("../App.tsx");

const en = (k: string, v?: Record<string, string | number>) => t("en", k, v);

/** Start a test server from outside the page: Node's fetch, not the page's. */
async function serve(opts: ServerOptions = {}): Promise<Running> {
  const page = globalThis.fetch;
  globalThis.fetch = nodeFetch;
  try {
    return await startServer(opts);
  } finally {
    globalThis.fetch = page;
  }
}

const outside = <T>(job: () => Promise<T>): Promise<T> => {
  const page = globalThis.fetch;
  globalThis.fetch = nodeFetch;
  return job().finally(() => (globalThis.fetch = page));
};

let open: { srv: Running | null; app: Mounted } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.app.unmount();
  await open.srv?.stop();
  open = null;
  downloads.length = 0;
  answers.confirm = true;
});

/** The app on a page served by `srv` (or by nothing at all), in English, once it knows where the tree lives. */
async function openApp(srv: Running | null, base = srv?.base ?? "http://127.0.0.1:9"): Promise<Mounted> {
  browser.setURL(base + "/");
  localStorage.setItem("genealogy:lang", "en");
  setRect("board", { left: 300, top: 0, width: 980, height: 800 });
  setRect("tree", { left: 300, top: 0, width: 980, height: 800 });
  const app = await mount(h(App)).catch(async (e) => {
    await srv?.stop();
    throw e;
  });
  open = { srv, app };
  await until(() => !$(".rail-foot .where").textContent?.includes("…"), "the app to find where the tree lives", 15_000);
  return app;
}

const readCard = async (srv: Running, id: string) => JSON.parse(await readFile(join(srv.dir, id + ".json"), "utf8"));
const onDisk = (srv: Running, id: string, what: (c: Record<string, unknown>) => boolean, label: string) =>
  until(async () => what(await readCard(srv, id).catch(() => ({}))), label);
const people = () => $$("#people li").map((li) => li.querySelector(".nm")?.textContent);
const notice = () => $("#toast").textContent;
const node = (id: string) => $(`#nodes .node[data-id="${id}"]`);

/** A mouse click on a card: the canvas selects on the way up. */
async function clickCard(id: string) {
  await pointer(node(id), "pointerdown", 500, 300);
  await pointer($("#tree"), "pointerup", 500, 300);
}

const family = (): ServerOptions => ({
  files: {
    "a.json": card("a", "Ivan Petrov", { sex: "m" }),
    "b.json": card("b", "Maria Petrova", { sex: "f" }),
    "c.json": card("c", "Oleg Petrov", { sex: "m", parents: ["a", "b"] }),
  },
});

test("the tree comes from the server, and every field of the editor reaches the card on disk", async () => {
  const srv = await serve(family());
  await openApp(srv);
  assert.deepEqual(people(), ["Ivan Petrov", "Maria Petrova", "Oleg Petrov"]);
  assert.equal($(".rail-foot .where").textContent, en("where.disk", { dir: srv.dir }));

  await click(byText("Oleg Petrov", "#people li"));
  const [name, maiden, born, died, alt] = $$("#editor input[type=text]") as HTMLInputElement[];
  assert.equal(name.value, "Oleg Petrov");
  assert.match($("#editor .block-title").textContent ?? "", /Parents: 2/);

  await type(name, "Oleg Sidorov");
  await type(maiden, " Ivanova ");
  await type(born, "1995");
  await fire(born, new FocusEvent("focusout", { bubbles: true }));
  assert.equal(born.value, "??.??.1995", "a bare year shows that the day and month are unknown");
  await type(died, "17.10.2005");
  await type(alt, "Oleg, Alik;  ");
  await click(byText(en("ed.female"), "#editor .seg button"));

  const c = await onDisk(srv, "c", (c) => c.sex === "f", "the edits on disk").then(() => readCard(srv, "c"));
  assert.equal(c.name, "Oleg Sidorov");
  assert.equal(c.maiden, "Ivanova");
  assert.equal(c.born, "??.??.1995");
  assert.equal(c.died, "17.10.2005");
  assert.deepEqual(c.alt, ["Oleg", "Alik"]);
  assert.deepEqual(people(), ["Ivan Petrov", "Maria Petrova", "Oleg Sidorov"]);
});

test("adding a person on their own, a namesake warning, and picking the namesake instead", async () => {
  const srv = await serve(family());
  await openApp(srv);

  await click(byText(en("rail.add")));
  assert.equal($(".pop h3").textContent, en("pop.new"));
  assert.ok($(".pop").textContent?.includes(en("pop.hintLone")));
  const [name, born] = $$(".pop input") as HTMLInputElement[];
  await type(name, "Anna Petrova");
  await type(born, "1950");
  await click(byText(en("pop.female"), ".pop .seg button"));
  await key(name, "Enter");
  await until(() => people().includes("Anna Petrova"), "the new person in the list");
  assert.equal($$(".pop").length, 0, "the window closes");
  const files = await until(async () => {
    const f = (await readdir(srv.dir)).filter((n) => n.endsWith(".json") && !n.startsWith("_"));
    return f.length === 4 && f;
  }, "a fourth card on disk");
  const added = await Promise.all(files.map((f) => readFile(join(srv.dir, f), "utf8").then((x) => JSON.parse(x))));
  const anna = added.find((p) => p.name === "Anna Petrova");
  assert.equal(anna.sex, "f");
  assert.equal(anna.born, "??.??.1950");

  await click(byText(en("rail.add")));
  await type($(".pop input"), "Ivan Petrov");
  assert.ok($(".pop .warn").textContent?.includes(en("pop.twin")));
  assert.equal($(".pop .hintline").textContent, en("pop.namesakes"));
  await click($(".pop .sugg li"));
  assert.equal($$(".pop").length, 0);
  assert.equal(($("#editor input[type=text]") as HTMLInputElement).value, "Ivan Petrov", "the namesake is shown, not created");

  await click(byText(en("rail.add")));
  await key($(".pop input"), "Escape");
  assert.equal($$(".pop").length, 0, "Escape closes the window");
  await click(byText(en("rail.add")));
  await click(byText(en("pop.cancel"), ".pop button"));
  assert.equal($$(".pop").length, 0, "so does Cancel");
});

test("adding relatives from the editor: a new child, a link to someone existing, and no link at all", async () => {
  const srv = await serve(family());
  await openApp(srv);
  await click(byText("Ivan Petrov", "#people li"));

  await click(byText(en("ed.addChild"), "#editor button"));
  assert.equal($(".pop h3").textContent, en("pop.forChild") + ": Ivan Petrov");
  await click(byText(en("pop.chNone"), ".pop .choice button"));
  assert.ok($(".pop").textContent?.includes(en("pop.hintNone")));
  await click(byText(en("pop.chChild"), ".pop .choice button"));
  await type($(".pop input"), "Pavel Petrov");
  await click(byText(en("pop.add"), ".pop button"));
  await until(() => people().includes("Pavel Petrov"), "the child in the list");
  assert.equal(($("#editor input[type=text]") as HTMLInputElement).value, "Pavel Petrov", "the new child is selected");
  assert.match($("#editor .block-title").textContent ?? "", /Parents: 1/);
  await click(byText("Ivan Petrov", "#people li"));
  assert.match($("#editor .block-title").textContent ?? "", /children: 2/);

  // the arrow keys walk the suggestions, Enter links the one under the cursor
  await click(byText(en("ed.addSpouse"), "#editor button"));
  const input = $(".pop input");
  await type(input, "Petrov");
  assert.equal($(".pop .hintline").textContent, en("pop.linkExisting"));
  const names = $$(".pop .sugg li").map((li) => li.textContent);
  await key(input, "ArrowDown");
  await key(input, "ArrowDown");
  await key(input, "ArrowUp");
  await key(input, "ArrowUp");
  await key(input, "ArrowUp");
  const at = $$(".pop .sugg li").findIndex((li) => li.className === "on");
  assert.ok(at >= 0);
  const chosen = names[at];
  await key(input, "Enter");
  assert.equal($$(".pop").length, 0);
  const kin = $$("#editor .kin li").map((li) => li.textContent ?? "");
  assert.ok(kin.some((k) => chosen && k.includes(chosen.replace(/\d.*$/, ""))), "the chosen person is now a relative");
});

test("connecting by picking a card on the canvas, and calling the pick off", async () => {
  const srv = await serve({ files: { "a.json": card("a", "Ivan Petrov", { sex: "m" }), "b.json": card("b", "Maria Ivanova", { sex: "f" }) } });
  await openApp(srv);
  await clickCard("a");
  assert.equal(($("#editor input[type=text]") as HTMLInputElement).value, "Ivan Petrov");

  await click(byText(en("ed.marriage"), "#editor button"));
  assert.equal($("#pickbar span").textContent, en("pick.spouse") + " «Ivan Petrov»");
  assert.equal($("#tree").getAttribute("class"), "picking");
  await clickCard("b");
  assert.equal($$("#pickbar").length, 0);
  await onDisk(srv, "a", (c) => (c.spouses as string[])?.includes("b"), "the marriage on disk");

  await click(byText(en("ed.toChild"), "#editor button"));
  await click(byText(en("pick.cancel"), "#pickbar button"));
  assert.equal($$("#pickbar").length, 0, "Cancel ends the pick");

  await click(byText(en("ed.sibling"), "#editor button"));
  await key(document.body, "Escape");
  assert.equal($$("#pickbar").length, 0, "so does Escape");
});

test("the arrows around a selected card open the add window for that relation", async () => {
  const srv = await serve(family());
  await openApp(srv);
  await clickCard("c");
  const handles = $$("#handles .handle");
  assert.equal(handles.length, 4);
  const parent = handles.find((g) => g.querySelector("title")?.textContent === en("handle.addParent"))!;
  await click(parent);
  assert.equal($(".pop h3").textContent, en("pop.forParent") + ": Oleg Petrov");
  await pointer(document.body, "pointerdown", 5, 5);
  await settle(5);
  await pointer(document.body, "pointerdown", 5, 5);
  assert.equal($$(".pop").length, 0, "a click outside closes the window");
});

test("a line's menu removes the link it holds", async () => {
  const srv = await serve(family());
  await openApp(srv);
  const lines = $$("#edges path.hit");
  assert.ok(lines.length > 0);
  await pointer(lines[0], "pointerdown", 600, 400);
  await pointer($("#tree"), "pointerup", 600, 400);
  const menu = $(".edge-pop");
  const rows = $$(".cuts li", menu).map((li) => li.querySelector(".nm")?.textContent);
  assert.ok(rows.length > 0, "the menu lists the links: " + menu.textContent);
  await click($(".cuts li button", menu));
  assert.equal($$(".edge-pop").length, 0);
  await until(async () => {
    const c = await readCard(srv, "c");
    const a = await readCard(srv, "a");
    return (c.parents as string[]).length < 2 || (a.spouses as string[]).length === 0;
  }, "one link fewer on disk");

  await pointer($$("#edges path.hit")[0], "pointerdown", 600, 400);
  await pointer($("#tree"), "pointerup", 600, 400);
  await click(byText(en("em.close"), ".edge-pop button"));
  assert.equal($$(".edge-pop").length, 0);
});

test("the bar over the canvas: years, spacing, zoom, fitting, rearranging and hidden people", async () => {
  const srv = await serve(family());
  await openApp(srv);
  await resizeAll();
  const transform = () => $("#viewport").getAttribute("transform");

  await click($("#tools label.sw input"));
  await until(() => $$("#axis").length === 1, "the year axis");
  await onDisk(srv, "a", () => true, "");
  await click($("#tools label.sw input"));
  assert.equal($$("#axis").length, 0);

  const before = transform();
  await click(byText("+", "#tools button"));
  assert.notEqual(transform(), before, "zooming in changes the view");
  await click(byText("−", "#tools button"));
  await click(byText(en("tool.fit"), "#tools button"));
  await click(byText(en("tool.rearrange"), "#tools button"));

  const range = $("#tools input[type=range]") as HTMLInputElement;
  await type(range, "1.8");
  await until(() => range.value === "1.8", "the new spacing");

  await click($("#toolsMore"));
  assert.equal($("#tools").className, "more");
  await click($("#toolsMore"));
  assert.equal($("#tools").className, "");

  await click(byText("Oleg Petrov", "#people li"));
  await click(byText(en("ed.hideAbove"), "#editor button"));
  const unhide = byText(en("tool.unhide", { n: 2 }), "#tools button");
  assert.equal($$("#nodes .node").length, 1, "the parents are hidden");
  assert.ok($$("#people li.hid").length === 2);
  await click(unhide);
  assert.equal($$("#nodes .node").length, 3);
});

test("keys: undo, leaving a selection, deleting the selected person", async () => {
  const srv = await serve(family());
  await openApp(srv);
  await click(byText("Oleg Petrov", "#people li"));
  await type($("#editor input[type=text]"), "Oleg X");
  await key(document.body, "z", { ctrlKey: true });
  assert.equal(($("#editor input[type=text]") as HTMLInputElement).value, "Oleg Petrov", "undo takes the name back");

  await key(document.body, "Escape");
  assert.equal($$("#editor").length, 0, "Escape leaves the selection");

  await click(byText("Oleg Petrov", "#people li"));
  answers.confirm = false;
  await key(document.body, "Delete");
  assert.ok(people().includes("Oleg Petrov"), "a declined confirmation keeps the person");
  answers.confirm = true;
  await key(document.body, "Delete");
  assert.ok(!people().includes("Oleg Petrov"));
  assert.match(answers.confirmed.at(-1) ?? "", /Oleg Petrov/);
  await until(async () => !(await readdir(srv.dir)).includes("c.json"), "the card gone from disk");

  await click(byText("Ivan Petrov", "#people li"));
  await click(byText(en("ed.delete"), "#editor button"));
  assert.ok(!people().includes("Ivan Petrov"));
  await click(byText(en("rail.undo"), ".rail-foot button"));
  assert.ok(people().includes("Ivan Petrov"), "the footer's Undo brings them back");
});

test("relatives in the editor: going to one, and cutting each kind of link", async () => {
  const srv = await serve({
    files: {
      "a.json": card("a", "Ivan Petrov", { sex: "m", spouses: ["b"] }),
      "b.json": card("b", "Maria Petrova", { sex: "f", spouses: ["a"] }),
      "c.json": card("c", "Oleg Petrov", { sex: "m", parents: ["a", "b"], siblings: ["d"] }),
      "d.json": card("d", "Lev Orlov", { sex: "m", siblings: ["c"] }),
      "e.json": card("e", "Pyotr Petrov", { sex: "m", parents: ["a", "b"] }),
    },
  });
  await openApp(srv);
  await click(byText("Oleg Petrov", "#people li"));
  const row = (name: string) => $$("#editor .kin li").find((li) => li.querySelector(".who")?.textContent === name)!;
  assert.ok(row("Pyotr Petrov"), "a brother through the parents is listed");
  assert.equal(row("Pyotr Petrov").querySelector("button.cut"), null, "and has no link of his own to cut");

  await click(row("Lev Orlov").querySelector("button.cut")!);
  await onDisk(srv, "c", (c) => !(c.siblings as string[]).length, "the sibling link gone");
  await click(row("Ivan Petrov").querySelector("button.cut")!);
  await onDisk(srv, "c", (c) => !(c.parents as string[]).includes("a"), "the parent link gone");

  await click(row("Maria Petrova").querySelector(".who")!);
  await click(byText("Maria Petrova", "#people li"));
  await click(row("Ivan Petrov").querySelector("button.cut")!);
  await onDisk(srv, "b", (c) => !(c.spouses as string[]).length, "the marriage gone");
  await click(row("Pyotr Petrov").querySelector("button.cut")!);
  await onDisk(srv, "e", (c) => !(c.parents as string[]).includes("b"), "the child link gone");
});

test("files: the archive, the JSON file both ways, clearing, and the language", async () => {
  const srv = await serve(family());
  await openApp(srv);

  await click(byText(en("rail.downloadZip"), ".rail-foot button"));
  const zipped = await until(() => downloads.find((f) => f.name === "persons.zip"), "the archive");
  const entries = unzip(Buffer.from(await zipped.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(entries).filter((n) => !n.includes("_")).sort(), ["persons/a.json", "persons/b.json", "persons/c.json"]);

  await click(byText(en("rail.saveFile"), ".rail-foot button"));
  const json = downloads.find((f) => f.name === "genealogy.json")!;
  const saved = JSON.parse(await json.blob.text());
  assert.deepEqual(Object.keys(saved.people).sort(), ["a", "b", "c"]);

  const fileInput = $$(".rail-foot input[type=file]").find((i) => i.getAttribute("accept")?.includes("json")) as HTMLInputElement;
  const choose = async (input: HTMLInputElement, file: File | null) => {
    Object.defineProperty(input, "files", { value: file ? [file] : [], configurable: true });
    await fire(input, new Event("change", { bubbles: true }));
  };
  saved.people.a.name = "Ivan From File";
  await choose(fileInput, new File([JSON.stringify(saved)], "tree.json", { type: "application/json" }));
  await until(() => people().includes("Ivan From File"), "the tree from the file");
  assert.equal(notice(), en("notice.loaded"));
  await choose(fileInput, new File(["{not json"], "bad.json"));
  await until(() => notice() === en("notice.fileFailed"), "a refusal of a broken file");
  await choose(fileInput, null);

  answers.confirm = false;
  await click(byText(en("rail.clear"), ".rail-foot button"));
  assert.equal(people().length, 3);
  answers.confirm = true;
  await click(byText(en("rail.clear"), ".rail-foot button"));
  assert.equal(people().length, 0);
  assert.equal($("#blank h2").textContent, en("blank.title"));
  assert.equal($("#people + .empty-note").textContent, en("rail.nobodyYet"));
  await click(byText(en("rail.svg"), ".rail-foot button"));
  assert.equal(notice(), en("notice.empty"), "an empty tree has no picture");
  await click(byText(en("rail.png"), ".rail-foot button"));
  assert.equal(notice(), en("notice.empty"));
  await click(byText(en("rail.pdf"), ".rail-foot button"));
  await until(() => notice() === en("notice.empty"), "no PDF either");

  await click(byText("RU", ".langs button"));
  assert.equal(document.title, t("ru", "app.title"));
  assert.equal(document.documentElement.lang, "ru");
  assert.equal(localStorage.getItem("genealogy:lang"), "ru");
  await click(byText("EN", ".langs button"));
  assert.equal(document.title, en("app.title"));
});

test("pictures of the tree: an SVG file, and PNG and PDF failing without a canvas", async () => {
  const srv = await serve(family());
  await openApp(srv);
  await click(byText(en("rail.svg"), ".rail-foot button"));
  const svg = await downloads.find((f) => f.name === "genealogy.svg")!.blob.text();
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.ok(svg.includes("Oleg Petrov"));
  assert.ok(!svg.includes('class="hit"'), "the click lines are left out");

  await click(byText(en("rail.png"), ".rail-foot button"));
  await until(() => notice() === en("notice.pngFailed"), "the PNG failure");
  await click(byText(en("rail.pdf"), ".rail-foot button"));
  await until(() => notice() === en("notice.pdfFailed", { detail: "no canvas" }), "the PDF failure");
});

test("a server that keeps the tree in memory takes an archive and gives it back", async () => {
  const srv = await serve({ store: "memory" });
  await openApp(srv);
  await settle(50); // the empty tree it opens with is written once, at once
  assert.equal($(".rail-foot .where").textContent, en("where.memory"));
  assert.equal($$(".rail-foot button").filter((b) => b.textContent === en("rail.saveFile")).length, 0, "no JSON pair in memory");

  const zipInput = $$(".rail-foot input[type=file]").find((i) => i.getAttribute("accept")?.includes("zip")) as HTMLInputElement;
  const choose = async (file: File | null) => {
    Object.defineProperty(zipInput, "files", { value: file ? [file] : [], configurable: true });
    await fire(zipInput, new Event("change", { bubbles: true }));
  };
  await choose(new File([new Uint8Array(zip({ "persons/x.json": card("x", "Zoya Kim") }))], "persons.zip"));
  await until(() => people().includes("Zoya Kim"), "the person from the archive");
  assert.equal(notice(), en("notice.zipLoaded", { n: 1 }));
  const held = await outside(() => getTree(srv.base));
  assert.deepEqual(Object.keys(held.body.tree.people), ["x"], "the server holds the archive");

  await choose(new File(["not a zip"], "bad.zip"));
  await until(() => notice().startsWith(en("notice.zipFailed", { detail: "" })), "a refused archive");
  await choose(null);

  await click(byText(en("rail.downloadZip"), ".rail-foot button"));
  const z = await until(() => downloads.find((f) => f.name === "persons.zip"), "the archive");
  const back = unzip(Buffer.from(await z.blob.arrayBuffer()));
  const named = Object.values(back).filter((text) => text.includes('"name"'));
  assert.deepEqual(named.map((text) => JSON.parse(text).name), ["Zoya Kim"], "keys: " + Object.keys(back));

  await srv.stop();
  await click(byText(en("rail.downloadZip"), ".rail-foot button"));
  await until(() => notice().startsWith(en("notice.zipFailed", { detail: "" })), "the download failing without a server");
});

test("without a server the tree lives in the browser, and comes back from it", async () => {
  localStorage.clear();
  await openApp(null);
  assert.equal($(".rail-foot .where").textContent, en("where.browser"));
  const seeded = people().length;
  assert.ok(seeded > 0, "the first run opens the sample tree");

  await click(byText(en("rail.add")));
  await type($(".pop input"), "Browser Person");
  await key($(".pop input"), "Enter");
  await until(() => (localStorage.getItem("genealogy:v3") ?? "").includes("Browser Person"), "the tree in localStorage", 8000);
  await open!.app.unmount();
  open = null;

  await openApp(null);
  assert.ok(people().includes("Browser Person"), "the browser's copy is what opens next time");
  assert.equal(people().length, seeded + 1);
  await open!.app.unmount();
  open = null;

  localStorage.setItem("genealogy:v3", "{broken");
  await openApp(null);
  assert.equal(people().length, seeded, "a broken copy is ignored");
});

test("a tree changed elsewhere stops the writes until it is read again", async () => {
  const srv = await serve(family());
  await openApp(srv);
  const now = await outside(() => getTree(srv.base));
  now.body.tree.people.a.name = "Changed Elsewhere";
  assert.equal((await outside(() => postTree(srv.base, now.body.rev, now.body.tree))).status, 200);

  await click(byText("Oleg Petrov", "#people li"));
  await type($("#editor input[type=text]"), "Oleg Local");
  await until(() => $(".rail-foot .where").classList.contains("stuck"), "the conflict", 8000);
  assert.equal($(".rail-foot .where").textContent, en("where.conflict"));
  assert.equal(notice(), en("notice.conflict"));

  await click(byText(en("where.reread"), ".rail-foot button"));
  await until(() => people().includes("Changed Elsewhere"), "the tree from disk");
  assert.ok($(".rail-foot .where").classList.contains("disk"));
});

test("an administrator's session: the admin page and logging out are plain navigations", async () => {
  const srv = await serve({ ...family(), user: ["user", "pw"], admin: ["boss", "secret"] });
  const cookie = await outside(async () => {
    const r = await nodeFetch(srv.base + "/login", { method: "POST", body: new URLSearchParams({ u: "boss", p: "secret" }), redirect: "manual" });
    return (r.headers.get("set-cookie") ?? "").split(";")[0];
  });
  browser.setURL(srv.base + "/");
  document.cookie = cookie;
  await openApp(srv);
  assert.deepEqual(people(), ["Ivan Petrov", "Maria Petrova", "Oleg Petrov"]);
  byText(en("rail.logout"), ".rail-foot button");
  await click(byText(en("rail.admin"), ".rail-foot button"));
  await until(() => location.pathname === "/admin", "the admin page");
});

test("dragging a card pins it where it was dropped; the wheel pans and zooms", async () => {
  const srv = await serve(family());
  await openApp(srv);
  await resizeAll();
  await pointer(node("a"), "pointerdown", 500, 300);
  await pointer($("#tree"), "pointermove", 540, 330);
  await pointer($("#tree"), "pointermove", 580, 360);
  assert.ok(node("a").getAttribute("class")?.includes("node"));
  await pointer($("#tree"), "pointerup", 580, 360);
  await onDisk(srv, "a", (c) => typeof c.fx === "number" && typeof c.fy === "number", "the pinned position on disk");

  const transform = () => $("#viewport").getAttribute("transform");
  let before = transform();
  await fire($("#tree"), new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true }));
  assert.notEqual(transform(), before, "the wheel pans");
  before = transform();
  await fire($("#tree"), new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, clientX: 600, clientY: 300, bubbles: true, cancelable: true }));
  assert.match(transform() ?? "", /scale\(/);
  assert.notEqual(transform(), before, "Ctrl and the wheel zoom");
  before = transform();
  await fire($("#tree"), new WheelEvent("wheel", { deltaY: 0, deltaX: 0, bubbles: true, cancelable: true }));
  assert.equal(transform(), before, "a wheel that does not move does nothing");

  // two fingers pinch
  const touch = (kind: string, pts: [number, number][]) =>
    fire(
      $("#tree"),
      Object.assign(new Event(kind, { bubbles: true, cancelable: true }), {
        touches: pts.map(([x, y], i) => ({ identifier: i, clientX: x, clientY: y })),
      }),
    );
  before = transform();
  await touch("touchstart", [[500, 300], [600, 300]]);
  await touch("touchmove", [[450, 300], [650, 300]]);
  await touch("touchend", []);
  assert.notEqual(transform(), before, "a pinch zooms");
});

test("leaving the page: a pending write goes out when it is hidden, and on closing through a beacon", async () => {
  const srv = await serve(family());
  const beacons: { url: string; body: Blob }[] = [];
  navigator.sendBeacon = (url: string | URL, body?: BodyInit | null) => {
    beacons.push({ url: String(url), body: body as Blob });
    return true;
  };
  await openApp(srv);
  await click(byText("Oleg Petrov", "#people li"));

  await type($("#editor input[type=text]"), "Oleg Hidden");
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  await fire(document, new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  await onDisk(srv, "c", (c) => c.name === "Oleg Hidden", "the write on hiding");

  await type($("#editor input[type=text]"), "Oleg Closing");
  const ask = await fire(window, new Event("beforeunload", { cancelable: true }));
  assert.equal(ask.defaultPrevented, false, "a tree that fits into a beacon needs no question");
  await fire(window, new Event("pagehide"));
  assert.equal(beacons.length, 1);
  assert.match(beacons[0].url, /\/api\/tree$/);
  assert.equal(JSON.parse(await beacons[0].body.text()).tree.people.c.name, "Oleg Closing");

  // too big for a beacon: the browser is asked to hold the tab
  await type($$("#editor input[type=text]")[4], "x".repeat(70_000));
  const big = await fire(window, new Event("beforeunload", { cancelable: true }));
  assert.equal(big.defaultPrevented, true);

  // leaving a text field writes at once
  await type($("#editor input[type=text]"), "Oleg Blurred");
  await fire($("#editor input[type=text]"), new FocusEvent("focusout", { bubbles: true }));
  await onDisk(srv, "c", (c) => c.name === "Oleg Blurred", "the write on leaving the field");
});

test("a photo: shrunk in the browser, kept by the server, shown on the card, and taken away", async () => {
  const srv = await serve(family());
  let bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const ctx = { fillRect() {}, drawImage() {}, measureText: (s: string) => ({ width: s.length * 8 }), set fillStyle(_v: string) {} } as unknown as CanvasRenderingContext2D;
  const proto = HTMLCanvasElement.prototype;
  const saved = { getContext: proto.getContext, toBlob: proto.toBlob, bitmap: globalThis.createImageBitmap };
  proto.getContext = (() => ctx) as unknown as typeof proto.getContext;
  proto.toBlob = function (cb: BlobCallback) {
    setTimeout(() => cb(new Blob([bytes], { type: "image/jpeg" })), 0);
  };
  let broken = false;
  globalThis.createImageBitmap = (async () => {
    if (broken) throw new Error("not a picture");
    return { width: 2000, height: 1000, close() {} };
  }) as unknown as typeof createImageBitmap;
  try {
    await openApp(srv);
    await click(byText("Oleg Petrov", "#people li"));
    assert.ok($(".photo-big").classList.contains("none"));
    const input = $(".photo-row input[type=file]") as HTMLInputElement;
    const choose = async (file: File) => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await fire(input, new Event("change", { bubbles: true }));
    };
    byText(en("ed.photoAdd"), ".photo-btns button");

    await choose(new File(["raw"], "me.png"));
    const c = await onDisk(srv, "c", (c) => typeof c.photo === "string" && c.photo !== "", "the photo's name on the card").then(() => readCard(srv, "c"));
    assert.match(c.photo, /^[0-9a-f]{16}\.jpg$/);
    await until(() => $$("img.photo-big").length === 1, "the photo in the editor");
    assert.equal($("img.photo-big").getAttribute("src"), "/api/photo/" + c.photo);
    assert.equal(node("c").querySelector("image")?.getAttribute("href"), "/api/photo/" + c.photo, "and on the card");
    const served = await outside(() => nodeFetch(srv.base + "/api/photo/" + c.photo));
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes, "the server keeps the JPEG as sent");
    byText(en("ed.photoChange"), ".photo-btns button");

    bytes = new Uint8Array([1, 2, 3]);
    await choose(new File(["raw"], "bad.png"));
    await until(() => notice().startsWith(en("notice.photoFailed", { detail: "" })), "a refused photo");
    broken = true;
    await choose(new File(["raw"], "worse.png"));
    await until(() => notice() === en("notice.photoFailed", { detail: "not a picture" }), "a picture the browser cannot open");

    await click(byText(en("ed.photoRemove"), ".photo-btns button"));
    await onDisk(srv, "c", (c) => !c.photo, "the photo gone from the card");
  } finally {
    proto.getContext = saved.getContext;
    proto.toBlob = saved.toBlob;
    globalThis.createImageBitmap = saved.bitmap;
  }
});
