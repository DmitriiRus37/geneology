/**
 * A browser for the interface tests: happy-dom's window installed as the globals,
 * React's act() switched on, and the few things a test does to a page — click, type,
 * press a key, play a pointer — written once.
 *
 * Import this before React: react-dom decides whether it runs in a browser when it is
 * first loaded. Each test file runs in a process of its own, so the globals stay there.
 *
 * Layout is not computed by happy-dom: every element measures 0×0. `setRect` gives an
 * element (by id) the box a real browser would.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/** Node's own fetch, for talking to a test server from outside the page. */
export const nodeFetch: typeof fetch = globalThis.fetch;

GlobalRegistrator.register({ url: "http://127.0.0.1/", width: 1280, height: 800 });

/** happy-dom's own controls: the page's address and the window's size. */
export const browser = (window as unknown as { happyDOM: { setURL(url: string): void; setViewport(v: { width: number; height: number }): void } }).happyDOM;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Rect = { left: number; top: number; width: number; height: number };
const rects = new Map<string, Rect>();
const zero: Rect = { left: 0, top: 0, width: 0, height: 0 };
const asDom = (r: Rect) => ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON() {} });
Element.prototype.getBoundingClientRect = function (this: Element) {
  return asDom(rects.get(this.id) ?? zero) as DOMRect;
};
/** What getBoundingClientRect answers for the element with this id. */
export const setRect = (id: string, r: Rect): void => void rects.set(id, r);

/**
 * happy-dom's ResizeObserver never reports. This one reports every observed element
 * once when it starts observing, and again on `resizeAll()` — what a browser does
 * when an element first gets its size and when the window changes.
 */
const observers = new Set<FakeResizeObserver>();
class FakeResizeObserver {
  els = new Set<Element>();
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.els.add(el);
    observers.add(this);
    queueMicrotask(() => this.report());
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
    observers.delete(this);
  }
  report() {
    if (this.els.size) this.cb([...this.els].map((target) => ({ target }) as ResizeObserverEntry), this as unknown as ResizeObserver);
  }
}
Object.assign(globalThis, { ResizeObserver: FakeResizeObserver });
window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
export async function resizeAll(): Promise<void> {
  await act(async () => {
    for (const o of observers) o.report();
    window.dispatchEvent(new Event("resize"));
  });
}

/**
 * Files the page hands to the person: an `<a download>` clicked with a blob URL. They
 * are recorded here instead of navigating the page away.
 */
export const downloads: { name: string; blob: Blob }[] = [];
const blobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (obj: Blob | MediaSource) => {
  const url = createObjectURL(obj);
  if (obj instanceof Blob) blobs.set(url, obj);
  return url;
};
const anchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  const blob = blobs.get(this.href);
  if (this.download && blob) downloads.push({ name: this.download, blob });
  else anchorClick.call(this);
};

// happy-dom matches a media query list ("a, b") as if it were one query; a browser
// takes it as "a or b"
const matchOne = window.matchMedia.bind(window);
window.matchMedia = globalThis.matchMedia = (query: string) => {
  const parts = query.split(",").map((q) => matchOne(q.trim()));
  const list = matchOne(query);
  Object.defineProperty(list, "matches", { get: () => parts.some((p) => p.matches) });
  return list;
};

// pointer capture is not implemented; the gestures only need it not to throw
Element.prototype.setPointerCapture = function () {};
Element.prototype.releasePointerCapture = function () {};

/** confirm() answers what the test sets here. */
export const answers = { confirm: true, confirmed: [] as string[] };
window.confirm = globalThis.confirm = (text?: string) => {
  answers.confirmed.push(String(text));
  return answers.confirm;
};

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
export { act };

import type { ReactNode } from "react";

export interface Mounted {
  root: HTMLElement;
  unmount: () => Promise<void>;
}

export async function mount(el: ReactNode): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(el));
  return {
    root: host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** Let promises and timers that are already due run, inside act(). */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Wait (in real time) until `check` passes; it is retried on every settle. */
type Truthy<T> = Exclude<T, false | null | undefined | 0 | "">;
export async function until<T>(check: () => T | Promise<T>, what = "the condition", ms = 5000): Promise<Truthy<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v as Truthy<T>;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await settle(20);
  }
}

export function $(sel: string, from: ParentNode = document): HTMLElement {
  const el = from.querySelector(sel);
  if (!el) throw new Error("no element " + sel);
  return el as HTMLElement;
}

export const $$ = (sel: string, from: ParentNode = document): HTMLElement[] => [...from.querySelectorAll(sel)] as HTMLElement[];

/** The button (or other element matching `sel`) whose text is exactly `text`. */
export function byText(text: string, sel = "button", from: ParentNode = document): HTMLElement {
  const el = $$(sel, from).find((e) => e.textContent?.trim() === text);
  if (!el) throw new Error(`no ${sel} with the text «${text}»`);
  return el;
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Type into a field the way React hears it: the value set natively, then an input event. */
export async function type(el: Element, value: string): Promise<void> {
  const input = el as HTMLInputElement;
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function check(el: Element, on: boolean): Promise<void> {
  const input = el as HTMLInputElement;
  if (input.checked !== on) await click(input);
}

export async function key(el: Element, k: string, opts: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
  await act(async () => {
    el.dispatchEvent(e);
  });
  return e;
}

export async function fire(el: EventTarget, e: Event): Promise<Event> {
  await act(async () => {
    el.dispatchEvent(e);
  });
  return e;
}

export async function pointer(el: Element, kind: string, x: number, y: number, opts: PointerEventInit = {}): Promise<void> {
  await fire(
    el,
    new PointerEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, pointerType: "mouse", ...opts }),
  );
}

export async function blur(el: Element): Promise<void> {
  await fire(el, new FocusEvent("focusout", { bubbles: true }));
  await fire(el, new FocusEvent("blur"));
}
