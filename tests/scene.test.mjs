import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_INTERACTIONS,
  DEFAULT_SETTINGS,
  MAX_SCENE_BYTES,
  decodeScene,
  encodeScene,
  loadScene,
  validateInteractions,
  validateSettings,
} from "../packages/core/dist/scene/scene.js";

function createScene() {
  return {
    version: 1,
    name: "Synthetic logo",
    activeImage: 0,
    settings: { ...DEFAULT_SETTINGS },
    interactions: { ...DEFAULT_INTERACTIONS, rotate: false },
    clouds: [
      {
        name: "Transparent fixture",
        depthSource: "brightness",
        positions: new Float32Array([-1, 0, 0.25, 1, 0, -0.25]),
        colors: new Uint8Array([255, 255, 255, 255, 0, 100, 200, 128]),
      },
    ],
  };
}

test("scene round trip preserves prepared evidence and permissions in detached buffers", () => {
  const original = createScene();
  const encoded = encodeScene(original);
  const decoded = decodeScene(encoded);
  assert.deepEqual(decoded, original);
  decoded.clouds[0].positions[0] = 0;
  decoded.clouds[0].colors[0] = 0;
  assert.equal(original.clouds[0].positions[0], -1);
  assert.equal(decodeScene(encoded).clouds[0].colors[0], 255);
  assert.equal(decoded.interactions.rotate, false);
});

test("invalid magic, truncation, unsupported versions, and non-finite points are rejected", () => {
  const buffer = encodeScene(createScene());
  assert.throws(() => decodeScene(buffer.slice(0, -1)), /Truncated/);
  assert.throws(() => decodeScene(new ArrayBuffer(8)), /not a Gatherform/);
  const invalid = createScene();
  invalid.clouds[0].positions[0] = NaN;
  assert.throws(() => encodeScene(invalid), /point position/);
  invalid.clouds[0].positions[0] = Infinity;
  assert.throws(() => encodeScene(invalid), /point position/);
  invalid.version = 2;
  assert.throws(() => encodeScene(invalid), /Unsupported/);
});

test("header size and point counts cannot allocate unbounded arrays", () => {
  const buffer = encodeScene(createScene());
  new DataView(buffer).setUint32(4, 0xffffffff, true);
  assert.throws(() => decodeScene(buffer), /header/);
  assert.throws(
    () => decodeScene(new ArrayBuffer(MAX_SCENE_BYTES + 1)),
    /size/,
  );
});

test("partial interaction overrides preserve defaults and reject invalid inputs", () => {
  assert.deepEqual(validateInteractions({ rotate: false }), {
    ...DEFAULT_INTERACTIONS,
    rotate: false,
  });
  assert.equal(validateSettings({ drift: 0 }).drift, 0);
  assert.throws(() => validateInteractions({ rotate: "false" }), /Invalid/);
  assert.throws(() => validateInteractions({ pointerStrength: NaN }), /range/);
  assert.throws(
    () => validateSettings({ lightColor: "url(https://example.com)" }),
    /Invalid/,
  );
  assert.throws(() => validateSettings({ travel: "unknown" }), /Invalid/);
});

test("failed fetch and oversized streamed scenes are rejected before decoding", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 404 }),
  );
  await assert.rejects(loadScene("https://example.test/scene"), /404/);
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(null, {
        headers: { "content-length": String(MAX_SCENE_BYTES + 1) },
      }),
  );
  await assert.rejects(loadScene("https://example.test/scene"), /40 MB/);
});

test("oversized streams are cancelled even when content-length is absent", async (context) => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(21 * 1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  context.mock.method(globalThis, "fetch", async () => new Response(stream));
  await assert.rejects(loadScene("https://example.test/scene"), /40 MB/);
  assert.equal(cancelled, true);
  assert.ok(chunks <= 3);
});

test("caller cancellation reaches the scene fetch", async (context) => {
  const controller = new AbortController();
  context.mock.method(
    globalThis,
    "fetch",
    async (_src, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        );
      }),
  );
  const loading = loadScene("https://example.test/scene", controller.signal);
  controller.abort();
  await assert.rejects(loading, { name: "AbortError" });
});

test("older settings receive drift spread and reject invalid spread", () => {
  const { driftSpread, ...olderSettings } = DEFAULT_SETTINGS;
  assert.equal(validateSettings(olderSettings).driftSpread, driftSpread);
  assert.throws(() =>
    validateSettings({ ...DEFAULT_SETTINGS, driftSpread: 2 }),
  );
});

test("drift speed preserves old scene playback and validates its multiplier", () => {
  const scene = createScene();
  delete scene.settings.driftSpeed;
  assert.equal(decodeScene(encodeScene(scene)).settings.driftSpeed, 1);
  for (const driftSpeed of [0, 0.5, 1, 3]) {
    scene.settings.driftSpeed = driftSpeed;
    assert.equal(
      decodeScene(encodeScene(scene)).settings.driftSpeed,
      driftSpeed,
    );
  }
  for (const driftSpeed of [-1, 3.1, NaN, Infinity])
    assert.throws(() => validateSettings({ driftSpeed }));
});

test("transparent backgrounds survive scene export and reject other color keywords", () => {
  const scene = createScene();
  scene.settings.background = "transparent";
  assert.equal(
    decodeScene(encodeScene(scene)).settings.background,
    "transparent",
  );
  assert.equal(
    validateSettings({ background: "transparent", paper: "light" }).background,
    "transparent",
  );
  assert.throws(
    () => validateSettings({ lightColor: "transparent" }),
    /Invalid lightColor/,
  );
  assert.throws(
    () => validateSettings({ background: "red" }),
    /Invalid background/,
  );
});

test("framing and scattered-start settings default safely and stay bounded", () => {
  // Scenes saved before these settings existed keep their earlier look.
  const older = validateSettings({});
  assert.equal(older.frameScale, 1);
  assert.equal(older.startScattered, false);

  const intro = validateSettings({
    startScattered: true,
    gatherDelay: 2.5,
    frameScale: 1.4,
  });
  assert.deepEqual(
    [intro.startScattered, intro.gatherDelay, intro.frameScale],
    [true, 2.5, 1.4],
  );
  for (const frameScale of [0.4, 2.1, NaN])
    assert.throws(() => validateSettings({ frameScale }));
  for (const gatherDelay of [-0.1, 10.1, Infinity])
    assert.throws(() => validateSettings({ gatherDelay }));
  assert.throws(() => validateSettings({ startScattered: "yes" }));
});
