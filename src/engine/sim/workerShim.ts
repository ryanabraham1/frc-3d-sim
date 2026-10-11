/**
 * The few DOM calls robot models and field builders make (canvas textures for bumper numbers, AprilTags, labels) get an
 * OffscreenCanvas in the simulation worker. Nothing there is rendered; the textures only need to exist.
 * Imported first by worker.ts, before any module that touches `document` at load time.
 */
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.document === 'undefined') {
  const make = (tag: string) => {
    if (tag.toLowerCase() === 'canvas') {
      const c = new OffscreenCanvas(1, 1) as unknown as Record<string, unknown>;
      c.style = {};
      return c;
    }
    return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, removeEventListener() {} };
  };
  g.document = {
    createElement: make,
    createElementNS: (_ns: string, tag: string) => make(tag),
    addEventListener() {},
    removeEventListener() {},
    body: { appendChild() {} },
  };
}
if (typeof g.window === 'undefined') g.window = globalThis;
if (typeof g.localStorage === 'undefined') {
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
}
export {};
