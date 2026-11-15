import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "vite";

async function bundle(entry, modules = {}) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "example-fixtures",
        enforce: "pre",
        resolveId(id) {
          if (id.endsWith("/example")) id = "example";
          if (id in modules) return `\0${id}.tsx`;
        },
        load(id) {
          return modules[id.slice(1, -4)];
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["es"] },
      rollupOptions: { external: [] },
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from((Array.isArray(result) ? result[0] : result).output.find((output) => output.type === "chunk").code).toString("base64")}`
  );
}

const { createPlayerExample } = await bundle(
  new URL("../apps/studio/src/editor/player-example.ts", import.meta.url)
    .pathname,
);
const hooks = `
export const harness = { refs: [], state: [], effects: [], refIndex: 0, stateIndex: 0 };
export function useRef(value) { const index = harness.refIndex++; return harness.refs[index] ??= { current: value }; }
export function useState(value) { const index = harness.stateIndex++; harness.state[index] ??= value; return [harness.state[index], value => { harness.state[index] = value; }]; }
export function useEffect(effect) { harness.effects.push(effect); }
`;

for (const kind of ["basic", "controls", "audio"]) {
  test(`copied ${kind} example compiles and connects its public controls`, async () => {
    const code = createPlayerExample(kind, 30, { pan: true, rotate: false });
    const { Logo, harness } = await bundle("example", {
      example: `${code}\nexport { harness } from "react";`,
      react: hooks,
      "react/jsx-runtime":
        "export const Fragment = Symbol(); export const jsx = (type, props) => ({type, props}); export const jsxs = jsx;",
      "@armin-eslami/gatherform-react": "export function Gatherform() {}",
    });
    const render = () => {
      harness.refIndex = harness.stateIndex = 0;
      harness.effects = [];
      const tree = Logo();
      return kind === "basic" ? [tree] : tree.props.children.filter(Boolean);
    };
    let children = render();
    assert.equal(children[0].props.maxFps, 30);
    assert.deepEqual(children[0].props.interactions, {
      pan: true,
      rotate: false,
    });
    if (kind === "basic") return;

    const calls = [];
    harness.refs[0].current = {
      scatter: () => calls.push("scatter"),
      gather: () => calls.push("gather"),
      setAudioLevel: (level) => calls.push(level),
    };
    children[0].props.onReady();
    children = render();
    children[1].props.onClick();
    children[2].props.onClick();
    assert.deepEqual(calls.splice(0), ["scatter", "gather"]);
    children[3].props.children[0].props.onChange({ target: { checked: true } });
    render();

    const previousWindow = globalThis.window;
    let tick;
    let cleared = false;
    globalThis.window = {
      setInterval: (callback, delay) => {
        assert.equal(delay, 3000);
        tick = callback;
        return 7;
      },
      clearInterval: (id) => {
        assert.equal(id, 7);
        cleared = true;
      },
    };
    try {
      const cleanup = harness.effects[0]();
      tick();
      tick();
      cleanup();
      assert.deepEqual(calls.splice(0), ["scatter", "gather", "gather"]);
      assert.ok(cleared);
    } finally {
      globalThis.window = previousWindow;
    }
    if (kind !== "audio") return;

    const listeners = new Map();
    const audio = {
      paused: false,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    };
    harness.refs[1].current = audio;
    const previous = [
      globalThis.AudioContext,
      globalThis.requestAnimationFrame,
      globalThis.cancelAnimationFrame,
    ];
    let closed = false;
    globalThis.AudioContext = class {
      createAnalyser() {
        return {
          connect() {},
          getByteFrequencyData: (samples) => samples.fill(128),
        };
      }
      createMediaElementSource(element) {
        assert.equal(element, audio);
        return { connect() {} };
      }
      async resume() {}
      async close() {
        closed = true;
      }
    };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    try {
      const cleanup = harness.effects[1]();
      listeners.get("play")();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls[0], 128 / 255);
      listeners.get("pause")();
      assert.equal(calls.at(-1), 0);
      cleanup();
      assert.equal(listeners.size, 0);
      assert.ok(closed);
    } finally {
      [
        globalThis.AudioContext,
        globalThis.requestAnimationFrame,
        globalThis.cancelAnimationFrame,
      ] = previous;
    }
  });
}
