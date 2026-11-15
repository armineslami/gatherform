import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const THREE = await import(
  new URL("../build/three.module.js", "file://" + require.resolve("three")).href
);
import { createTrailGeometry } from "../packages/core/dist/rendering/trail-geometry.js";

test("trail endpoints share homes, colors and seeds and keep a bounded sample", () => {
  const source = new THREE.BufferGeometry();
  const count = 40_000;
  const positions = Float32Array.from(
    { length: count * 3 },
    (_, index) => index / 100,
  );
  const colors = new Uint8Array(count * 4).fill(128);
  source.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  source.setAttribute(
    "targetPosition",
    new THREE.BufferAttribute(positions.slice(), 3),
  );
  source.setAttribute("pointColor", new THREE.BufferAttribute(colors, 4, true));
  source.setAttribute(
    "targetColor",
    new THREE.BufferAttribute(colors.slice(), 4, true),
  );
  source.setAttribute(
    "pointSeed",
    new THREE.BufferAttribute(new Float32Array(count).fill(0.25), 1),
  );
  const trails = createTrailGeometry(source);
  assert.equal(trails.getAttribute("position").count, 32_768);
  for (let index = 0; index < 32_768; index += 2) {
    const position = trails.getAttribute("position");
    assert.equal(position.getX(index), position.getX(index + 1));
    assert.equal(trails.getAttribute("trailEnd").getX(index), 0);
    assert.equal(trails.getAttribute("trailEnd").getX(index + 1), 1);
    assert.ok(
      Math.abs(trails.getAttribute("pointColor").getX(index) - 128 / 255) <
        1e-6,
    );
  }
  assert.equal(positions[3], 0.029999999329447746);
  trails.dispose();
  source.dispose();
});
