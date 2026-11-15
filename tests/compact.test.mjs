import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  DEFAULT_INTERACTIONS,
  encodeScene,
  encodeCompactScene,
  decodeSceneFile,
} from "../packages/core/dist/index.js";

function fixture() {
  return {
    version: 1,
    name: "Compact fixture",
    activeImage: 0,
    settings: { ...DEFAULT_SETTINGS },
    interactions: { ...DEFAULT_INTERACTIONS },
    clouds: [
      {
        name: "Logo",
        depthSource: "brightness",
        positions: new Float32Array([-0.5, 0.5, 0.2, 0.5, -0.5, -0.2]),
        colors: new Uint8Array([255, 255, 255, 255, 73, 153, 140, 255]),
      },
    ],
  };
}
test("compact files preserve metadata, point budget and source colors with bounded position error", async () => {
  const source = fixture();
  source.settings.driftSpeed = 0.5;
  const encoded = await encodeCompactScene(source);
  const decoded = await decodeSceneFile(encoded);
  assert.equal(
    decoded.clouds[0].positions.length,
    source.clouds[0].positions.length,
  );
  assert.deepEqual(decoded.settings, source.settings);
  assert.deepEqual(decoded.interactions, source.interactions);
  assert.deepEqual(decoded.clouds[0].colors, source.clouds[0].colors);
  source.clouds[0].positions.forEach((value, index) =>
    assert.ok(Math.abs(value - decoded.clouds[0].positions[index]) < 0.02),
  );
  assert.deepEqual(await decodeSceneFile(encodeScene(source)), source);
  assert.ok(encoded.byteLength < 15000);
});
test("compact decoding rejects corruption and cancellation", async () => {
  const encoded = await encodeCompactScene(fixture());
  await assert.rejects(decodeSceneFile(encoded.slice(0, 30)));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(decodeSceneFile(encoded, controller.signal), {
    name: "AbortError",
  });
});

test("compact export rejects geometry outside its surface frame", async () => {
  const scene = fixture();
  scene.clouds[0].positions[0] = 2;
  await assert.rejects(encodeCompactScene(scene), /full-detail export/);
});
test("gzip expansion has a fixed upper limit", async () => {
  const stream = new Blob([new Uint8Array(600000)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  await assert.rejects(
    decodeSceneFile(await new Response(stream).arrayBuffer()),
    /limit/,
  );
});

test("all overlay combinations preserve appearance and interactions in both formats", async () => {
  const overlays = ["track", "links", "scan", "trails", "marks", "dense"];
  for (let mask = 0; mask < 64; mask++) {
    const source = fixture();
    for (let index = 0; index < overlays.length; index++)
      source.settings[overlays[index]] = Boolean(mask & (1 << index));
    Object.assign(source.settings, {
      opacity: 0.64,
      depth: 0.97,
      driftSpeed: 0.45,
      driftSpread: 0.87,
      paper: mask % 2 ? "light" : "dark",
      tone: mask % 3 ? "original" : "negative",
    });
    Object.assign(source.interactions, {
      rotate: false,
      zoom: true,
      pointerStrength: 0.8,
    });
    for (const encoded of [
      encodeScene(source),
      await encodeCompactScene(source),
    ]) {
      const decoded = await decodeSceneFile(encoded);
      assert.deepEqual(
        decoded.settings,
        source.settings,
        `overlay mask ${mask}`,
      );
      assert.deepEqual(
        decoded.interactions,
        source.interactions,
        `overlay mask ${mask}`,
      );
    }
  }
});

test("compact reconstruction preserves thin diagonal curves and unequal density", async () => {
  const source = fixture();
  const count = 24000;
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  for (let index = 0; index < count; index++) {
    const heavy = index < count * 0.75;
    const start = heavy ? 0 : count * 0.75;
    const length = heavy ? count * 0.75 : count * 0.25;
    const centerX = heavy ? -0.5 : 0.5;
    const centerY = heavy ? -0.3 : 0.3;
    const x = centerX + ((index - start) / (length - 1) - 0.5) * 0.2;
    const y = centerY + (x - centerX) * 0.75;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = x * 0.4 + y * 0.2;
    colors.set(heavy ? [73, 153, 140, 255] : [255, 255, 255, 255], index * 4);
  }
  source.clouds = [{ ...source.clouds[0], positions, colors }];
  const decoded = await decodeSceneFile(await encodeCompactScene(source));
  const points = decoded.clouds[0].positions;
  let heavyCount = 0;
  let lineError = 0;
  let depthError = 0;
  for (let index = 0; index < count; index++) {
    const x = points[index * 3];
    const y = points[index * 3 + 1];
    const heavy = x < 0;
    if (heavy) heavyCount++;
    const expectedY = (heavy ? -0.3 : 0.3) + (x - (heavy ? -0.5 : 0.5)) * 0.75;
    lineError += (y - expectedY) ** 2;
    depthError += (points[index * 3 + 2] - x * 0.4 - y * 0.2) ** 2;
  }
  assert.ok(Math.abs(heavyCount / count - 0.75) < 0.02);
  assert.ok(Math.sqrt(lineError / count) < 0.0015);
  assert.ok(Math.sqrt(depthError / count) < 0.002);
});

test("re-exporting an unchanged compact surface does not lose another generation of detail", async () => {
  const source = fixture();
  const count = 12000;
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  for (let index = 0; index < count; index++) {
    const x = (index / count) * 0.4 - 0.2;
    positions[index * 3] = x;
    positions[index * 3 + 1] = Math.sin(x * 12) * 0.1;
    positions[index * 3 + 2] = x * x + Math.sin(index) * 0.001;
    colors.set([73 + (index % 8), 153, 140, 255], index * 4);
  }
  source.clouds = [{ ...source.clouds[0], positions, colors }];
  const encoded = await encodeCompactScene(source);
  const decoded = await decodeSceneFile(encoded);
  assert.deepEqual(
    new Uint8Array(await encodeCompactScene(decoded)),
    new Uint8Array(encoded),
  );
});

test("previous compact grid files continue to load", async () => {
  const source = fixture();
  source.clouds[0].positions = new Float32Array([0, 0, 0]);
  source.clouds[0].colors = new Uint8Array([255, 255, 255, 255]);
  const metadata = encodeScene(source);
  const gridBytes = 128 * 128 * 6;
  const bytes = new Uint8Array(12 + metadata.byteLength + gridBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x47464332);
  view.setUint32(4, metadata.byteLength, true);
  bytes.set(new Uint8Array(metadata), 8);
  const cell = 64 * 128 + 64;
  bytes.fill(
    255,
    8 + metadata.byteLength + cell * 6,
    8 + metadata.byteLength + cell * 6 + 4,
  );
  view.setUint16(8 + metadata.byteLength + cell * 6 + 4, 32768, true);
  view.setUint32(bytes.length - 4, 32, true);
  const compressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const decoded = await decodeSceneFile(compressed);
  assert.equal(decoded.clouds[0].positions.length, 96);
  assert.ok(decoded.clouds[0].positions.every(Number.isFinite));
  assert.ok(decoded.clouds[0].colors.every((value) => value === 255));
});

test("compact surface records reject invalid patch counts, order and coefficients", async () => {
  const encoded = await encodeCompactScene(fixture());
  const raw = new Uint8Array(
    await new Response(
      new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const headerLength = new DataView(raw.buffer).getUint32(4, true);
  const start = 8 + headerLength;
  const count = new DataView(raw.buffer).getUint16(start + 8, true) & 0x3fff;
  for (const corrupt of [
    (bytes) => new DataView(bytes.buffer).setUint16(start + 8, 65535, true),
    (bytes) => new DataView(bytes.buffer).setFloat32(start, NaN, true),
    (bytes) => {
      bytes[start + 11] = 0;
      bytes[start + 10 + count + 1] = 0;
    },
    (bytes) => {
      bytes[start + 10 + 11 * count] = 255;
    },
  ]) {
    const bytes = raw.slice();
    corrupt(bytes);
    const compressed = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    await assert.rejects(decodeSceneFile(compressed), /compact surface/);
  }
});

test("surface records written without difference packing remain compatible", async () => {
  const encoded = await encodeCompactScene(fixture());
  const raw = new Uint8Array(
    await new Response(
      new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const view = new DataView(raw.buffer);
  const start = 8 + view.getUint32(4, true);
  const count = view.getUint16(start + 8, true) & 0x3fff;
  view.setUint16(start + 8, count | 0x4000, true);
  for (let plane = 0; plane < 16; plane++) {
    let previous = 0;
    for (let index = 0; index < count; index++) {
      const offset = start + 10 + plane * count + index;
      raw[offset] = (raw[offset] + previous) & 255;
      previous = raw[offset];
    }
  }
  const unpacked = await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  assert.deepEqual(
    await decodeSceneFile(unpacked),
    await decodeSceneFile(encoded),
  );
});

test("compact curved boundaries do not grow floating points outside the silhouette", async () => {
  const source = fixture();
  const count = 24000;
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4).fill(255);
  for (let index = 0; index < count; index++) {
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt((index + 0.5) / count) * 0.7;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius;
  }
  source.clouds = [{ ...source.clouds[0], positions, colors }];
  const decoded = await decodeSceneFile(await encodeCompactScene(source));
  const points = decoded.clouds[0].positions;
  let maximumRadius = 0;
  for (let index = 0; index < count; index++) {
    maximumRadius = Math.max(
      maximumRadius,
      Math.hypot(points[index * 3], points[index * 3 + 1]),
    );
  }
  assert.ok(maximumRadius < 0.70075, `edge radius ${maximumRadius}`);
  assert.equal(DEFAULT_INTERACTIONS.pan, true);
});

test("version 3 surface records remain readable after precise-edge exports", async () => {
  const encoded = await encodeCompactScene(fixture());
  const raw = new Uint8Array(
    await new Response(
      new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const view = new DataView(raw.buffer);
  const start = 8 + view.getUint32(4, true);
  const count = view.getUint16(start + 8, true) & 0x3fff;
  const previous = new Uint8Array(raw.length - count);
  previous.set(raw.subarray(0, start + 10 + count * 15));
  previous.set(raw.subarray(raw.length - 4), previous.length - 4);
  const previousView = new DataView(previous.buffer);
  previousView.setUint32(0, 0x47464333);
  previousView.setUint16(start + 8, count | 0x8000, true);
  const file = await new Response(
    new Blob([previous]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const decoded = await decodeSceneFile(file);
  assert.ok(decoded.clouds[0].positions.every(Number.isFinite));
  assert.deepEqual(decoded.settings, fixture().settings);
  assert.deepEqual(
    (await decodeSceneFile(await encodeCompactScene(decoded))).clouds,
    decoded.clouds,
  );
});
