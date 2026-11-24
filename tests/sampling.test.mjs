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
    assert.ok(Math.abs(first.positions[index * 3]) <= 1);
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

test("shape relief curves toward the edges instead of filling a thick block", () => {
  const rgba = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 4; y < 28; y++) {
    for (let x = 4; x < 28; x++)
      rgba.set([250, 255, 255, 255], (y * 32 + x) * 4);
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
  assert.ok(average(centerDepths) > average(edgeDepths) + 0.035);
  assert.ok(cloud.positions.every(Number.isFinite));
  assert.deepEqual(cloud, sampleImage(fixture));
});

test("transparent padding preserves a cutout's framing and relief", () => {
  function prepare(padding) {
    const width = 24 + 2 * padding;
    const rgba = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++)
        if (x < 10 || y < 10)
          rgba.set(
            [60, 180, 190, 255],
            ((y + padding) * width + x + padding) * 4,
          );
    return sampleImage({
      ...input,
      width,
      height: width,
      rgba,
      pointCount: 4096,
    });
  }
  const tight = prepare(0),
    padded = prepare(16);
  for (let i = 0; i < tight.positions.length; i++)
    assert.ok(Math.abs(tight.positions[i] - padded.positions[i]) < 0.00001);
});

test("opaque images keep brightness depth and retain dark pixels", () => {
  const cloud = sampleImage({
    ...input,
    pointCount: 4096,
    rgba: new Uint8ClampedArray([255, 255, 255, 255, 8, 8, 8, 255]),
  });
  const dark = Array.from(cloud.colors).filter(
    (value, index) => index % 4 === 0 && value === 8,
  );
  assert.ok(dark.length > 100);
  assert.equal(cloud.depthSource, "brightness");
  assert.ok(cloud.positions[2] > cloud.positions.at(-1) + 0.1);
});

test("transparent logos keep the same geometry when recolored", () => {
  const width = 32;
  const height = 32;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const recolored = rgba.slice();

  for (let y = 4; y < 28; y++) {
    for (let x = 4; x < 28; x++) {
      const shade = x < 16 ? 0 : 255;
      const offset = (y * width + x) * 4;
      rgba.set([shade, shade, shade, 255], offset);
      recolored.set(x < 16 ? [72, 153, 139, 255] : [29, 30, 31, 255], offset);
    }
  }

  const fixture = { ...input, width, height, rgba, pointCount: 4096 };
  const cloud = sampleImage(fixture);
  const colorCloud = sampleImage({ ...fixture, rgba: recolored });
  assert.deepEqual(cloud.positions, colorCloud.positions);
  assert.equal(colorCloud.depthSource, "procedural");
  assert.deepEqual(
    colorCloud.colors.slice(0, 4),
    new Uint8Array([72, 153, 139, 255]),
  );

  const blackPoints = cloud.colors.filter(
    (value, index) => index % 4 === 0 && value === 0,
  );
  assert.ok(Math.abs(blackPoints.length / fixture.pointCount - 0.5) < 0.01);
  assert.ok(cloud.positions[2] < 0.1); // First point sits on the outer contour.
  assert.ok(
    cloud.positions.some((value, index) => index % 3 === 2 && value > 0.13),
  );

  const withCutoff = sampleImage({ ...fixture, threshold: 0.01 });
  assert.ok(withCutoff.colors.every((channel) => channel === 255));
  const missingDarkPixels = rgba.slice();
  for (let offset = 0; offset < missingDarkPixels.length; offset += 4) {
    if (missingDarkPixels[offset] === 0) missingDarkPixels[offset + 3] = 0;
  }
  assert.deepEqual(
    withCutoff.positions,
    sampleImage({ ...fixture, rgba: missingDarkPixels }).positions,
  );
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

test("cutout sides receive grains while a wide face stays flat", () => {
  const size = 128;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 14; y < 114; y++)
    for (let x = 14; x < 114; x++)
      rgba.set([30, 30, 30, 255], (y * size + x) * 4);
  const cloud = sampleImage({
    ...input,
    width: size,
    height: size,
    rgba,
    pointCount: 20_000,
  });

  const depths = [];
  const faceDepths = [];
  for (let index = 0; index < cloud.positions.length; index += 3) {
    depths.push(cloud.positions[index + 2]);
    if (
      Math.abs(cloud.positions[index]) < 0.5 &&
      Math.abs(cloud.positions[index + 1]) < 0.5
    )
      faceDepths.push(cloud.positions[index + 2]);
  }
  const lowest = Math.min(...depths);
  const highest = Math.max(...depths);
  const sideShare =
    depths.filter((depth) => depth < (lowest + highest) / 2).length /
    depths.length;

  // A turned cutout must show filled sides, not a floating face.
  assert.ok(sideShare > 0.06);
  // Away from its contour, a wide area is one plateau plus sample jitter.
  assert.ok(Math.max(...faceDepths) - Math.min(...faceDepths) < 0.016);
});

test("AI depth on a cutout stays deterministic and keeps the model's relief", () => {
  const size = 48;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 8; y < 40; y++)
    for (let x = 8; x < 40; x++)
      rgba.set([240, 240, 240, 255], (y * size + x) * 4);
  const fixture = {
    ...input,
    width: size,
    height: size,
    rgba,
    pointCount: 8192,
  };

  const flat = sampleImage({
    ...fixture,
    depth: {
      values: new Float32Array(16).fill(3),
      width: 4,
      height: 4,
      source: "ai",
    },
  });
  assert.equal(flat.depthSource, "ai");
  assert.ok(flat.positions.every(Number.isFinite));
  assert.deepEqual(
    flat,
    sampleImage({
      ...fixture,
      depth: {
        values: new Float32Array(16).fill(3),
        width: 4,
        height: 4,
        source: "ai",
      },
    }),
  );

  // A coarse bump still reads as relief after edge snapping and the silhouette mix.
  const bump = sampleImage({
    ...fixture,
    depth: {
      values: new Float32Array([
        0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0,
      ]),
      width: 4,
      height: 4,
      source: "ai",
    },
  });
  const depths = [];
  for (let index = 2; index < bump.positions.length; index += 3)
    depths.push(bump.positions[index]);
  assert.ok(depths.every(Number.isFinite));
  assert.ok(Math.max(...depths) - Math.min(...depths) > 0.1);
});
