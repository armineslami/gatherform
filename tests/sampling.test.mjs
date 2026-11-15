import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleImage } from "../apps/studio/src/preparation/image-sampling.ts";

const input = {
  name: "Synthetic two-pixel image",
  width: 2,
  height: 1,
  rgba: new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 0]),
  pointCount: 32,
  threshold: 0,
};

test("transparent pixels are excluded and preparation is deterministic", () => {
  const first = sampleImage(input);
  const second = sampleImage(input);
  assert.deepEqual(first, second);
  assert.equal(first.positions.length, 96);
  assert.ok(first.positions.every(Number.isFinite));
  for (let index = 0; index < 32; index++) {
    assert.ok(first.positions[index * 3] < 0);
    assert.equal(first.colors[index * 4 + 3], 255);
  }
});

test("empty evidence is rejected, and constant depth remains finite", () => {
  assert.throws(
    () => sampleImage({ ...input, rgba: new Uint8ClampedArray(8) }),
    /visible pixels/,
  );
  const cloud = sampleImage({
    ...input,
    depth: {
      values: new Float32Array([1, 1]),
      width: 2,
      height: 1,
      source: "depth-map",
    },
  });
  assert.ok(cloud.positions.every(Number.isFinite));
  assert.equal(cloud.depthSource, "depth-map");
  assert.throws(
    () => sampleImage({ ...input, pointCount: 1_000_000 }),
    /sampling/,
  );
  assert.throws(() => sampleImage({ ...input, threshold: NaN }), /sampling/);
});

test("brightness relief curves toward the edges instead of filling a thick block", () => {
  const rgba = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 4; y < 28; y++) {
    for (let x = 4; x < 28; x++)
      rgba.set([255, 255, 255, 255], (y * 32 + x) * 4);
  }
  const fixture = { ...input, rgba, width: 32, height: 32, pointCount: 4096 };
  const cloud = sampleImage(fixture);
  const centerDepths = [];
  const edgeDepths = [];
  for (let index = 0; index < cloud.positions.length; index += 3) {
    const x = cloud.positions[index];
    const y = cloud.positions[index + 1];
    if (Math.abs(x) < 0.1 && Math.abs(y) < 0.1)
      centerDepths.push(cloud.positions[index + 2]);
    if (Math.abs(x) > 0.68) edgeDepths.push(cloud.positions[index + 2]);
  }
  const average = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(centerDepths.length > 0 && edgeDepths.length > 0);
  assert.ok(average(centerDepths) > average(edgeDepths) + 0.1);
  assert.ok(cloud.positions.every(Number.isFinite));
  assert.deepEqual(cloud, sampleImage(fixture));
});

test("dark opaque interiors survive while transparent backgrounds stay empty", () => {
  const cloud = sampleImage({
    ...input,
    pointCount: 4096,
    rgba: new Uint8ClampedArray([255, 255, 255, 255, 8, 8, 8, 255]),
  });
  const dark = Array.from(cloud.colors).filter(
    (value, index) => index % 4 === 0 && value === 8,
  );
  assert.ok(dark.length > 100);
});

test("low resolution depth interpolates into a continuous surface", () => {
  const cloud = sampleImage({
    ...input,
    width: 8,
    height: 1,
    pointCount: 4096,
    rgba: new Uint8ClampedArray(32).fill(255),
    depth: {
      values: new Float32Array([0, 1]),
      width: 2,
      height: 1,
      source: "depth-map",
    },
  });
  const middle = [];
  for (let index = 0; index < cloud.positions.length; index += 3) {
    if (Math.abs(cloud.positions[index]) < 0.2)
      middle.push(cloud.positions[index + 2]);
  }
  assert.ok(middle.length > 100);
  assert.ok(middle.every((value) => Math.abs(value) < 0.18));
  assert.ok(
    middle.some((value) => value < -0.05) &&
      middle.some((value) => value > 0.05),
  );
});

test("AI relief keeps rounded brightness contours; imported depth stays authoritative", () => {
  const rgba = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 4; y < 28; y++)
    for (let x = 4; x < 28; x++)
      rgba.set([255, 255, 255, 255], (y * 32 + x) * 4);
  const fixture = { ...input, width: 32, height: 32, rgba, pointCount: 4096 };
  const depth = { values: new Float32Array([1]), width: 1, height: 1 };
  const ai = sampleImage({ ...fixture, depth: { ...depth, source: "ai" } });
  const imported = sampleImage({
    ...fixture,
    depth: { ...depth, source: "depth-map" },
  });
  assert.ok(
    ai.positions.some((value, index) => index % 3 === 2 && value > -0.25),
  );
  assert.ok(
    imported.positions.every(
      (value, index) => index % 3 !== 2 || Math.abs(value + 0.4) < 0.008,
    ),
  );
});
