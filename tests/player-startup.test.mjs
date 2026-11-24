import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import {
  DEFAULT_SETTINGS,
  DEFAULT_INTERACTIONS,
} from "../packages/core/dist/index.js";

const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const { OneFactor, OneMinusSrcAlphaFactor } = require("three");
const threeUrl = new URL(
  "../build/three.module.js",
  pathToFileURL(require.resolve("three")),
).href;

// Keep real Three geometry and materials; replace only the browser/GPU boundary.
const result = await build({
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "test-renderer",
      enforce: "pre",
      resolveId(id) {
        if (id === "three") return "\0test-three";
      },
      load(id) {
        if (id !== "\0test-three") return;
        return `export * from ${JSON.stringify(threeUrl)};
        export class WebGLRenderer {
          constructor() { this.domElement = document.createElement("canvas"); this.ratio = 1; }
          setPixelRatio(value) { this.ratio = value; }
          getPixelRatio() { return this.ratio; }
          setSize(width, height) { this.size = [width, height]; }
          getDrawingBufferSize(target) { return target.set(...this.size).multiplyScalar(this.ratio).floor(); } setClearColor(color, alpha) { this.clearAlpha = alpha; }
          render() {} dispose() {} forceContextLoss() {}
        }`;
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    lib: { entry: "packages/core/src/rendering/player.ts", formats: ["es"] },
    rolldownOptions: { external: [threeUrl] },
  },
});
const bundle = (Array.isArray(result) ? result[0] : result).output.find(
  (output) => output.type === "chunk",
);
assert.ok(bundle);
const { GatherformPlayer } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.code).toString("base64")}`
);

test("saved Trails and overlay settings initialize, toggle and dispose without missing geometry", (context) => {
  const labels = [];
  class Canvas extends EventTarget {
    style = {};
    setAttribute() {}
    getContext() {
      return {
        setTransform() {},
        clearRect() {
          labels.length = 0;
        },
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        strokeRect() {},
        fillText(text) {
          labels.push(text);
        },
      };
    }
    remove() {}
  }
  class Observer {
    observe() {}
    disconnect() {}
  }
  const document = new EventTarget();
  document.createElement = () => new Canvas();
  const motion = new EventTarget();
  motion.matches = false;
  const replacements = {
    document,
    window: { devicePixelRatio: 1 },
    devicePixelRatio: 1,
    matchMedia: () => motion,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  for (const [name, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  const host = { clientWidth: 600, clientHeight: 400, append() {} };
  for (const trails of [true, false]) {
    const scene = {
      version: 1,
      name: "Startup fixture",
      activeImage: 0,
      settings: {
        ...DEFAULT_SETTINGS,
        trails,
        scan: true,
        track: true,
        links: true,
        marks: true,
        dense: true,
      },
      interactions: { ...DEFAULT_INTERACTIONS },
      clouds: [
        {
          name: "Logo",
          depthSource: "brightness",
          positions: new Float32Array([0, 0, 0]),
          colors: new Uint8Array([255, 255, 255, 255]),
        },
      ],
    };
    try {
      const player = new GatherformPlayer(host, scene);
      assert.equal(player.material.blendSrcAlpha, OneFactor);
      assert.equal(player.material.blendDstAlpha, OneMinusSrcAlphaFactor);
      player.draw(100);
      assert.ok(labels.some((label) => label.includes("LOGO")));
      assert.equal(player.renderer.clearAlpha, 1);
      assert.deepEqual(
        player.material.uniforms.viewportPixels.value.toArray(),
        [600, 400],
      );
      assert.equal(player.material.uniforms.fadeEdges.value, true);

      player.update({
        settings: { background: "transparent", paper: "light" },
      });
      assert.equal(player.geometry.instanceCount, 1);
      player.update({
        settings: { density: 8, background: "transparent", paper: "light" },
      });
      assert.equal(player.geometry.instanceCount, 8);
      player.scatter();
      player.draw(117);
      assert.equal(player.renderer.clearAlpha, 0);
      assert.equal(player.trailMaterial.blendSrc, OneFactor);
      assert.equal(
        labels.some((label) => label.includes("LOGO")),
        false,
      );

      player.gather();
      for (let time = 134; time <= 5000; time += 17) player.draw(time);
      assert.ok(labels.some((label) => label.includes("LOGO")));
      player.update({ settings: { trails: !trails, fadeEdges: false } });
      player.draw(5017);
      assert.equal(player.material.uniforms.fadeEdges.value, false);
      player.update({ settings: { trails } });
      player.dispose();
    } catch (error) {
      // Keep failures readable instead of printing the bundled data URL in a stack.
      throw new Error(error.message);
    }
  }
});
