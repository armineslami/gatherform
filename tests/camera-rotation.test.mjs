import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceRotationAngle } from "../packages/core/dist/rendering/camera-rotation.js";
import { validateInteractions } from "../packages/core/dist/scene/scene.js";

test("full rotation keeps crossing complete turns without stopping or snapping", () => {
  assert.equal(advanceRotationAngle(Math.PI * 2, 0.5, 360), Math.PI * 2 + 0.5);
  assert.equal(
    advanceRotationAngle(-Math.PI * 2, -0.5, 360),
    -Math.PI * 2 - 0.5,
  );
  assert.equal(
    validateInteractions({ rotationLimitDegrees: 360 }).rotationLimitDegrees,
    360,
  );
});

test("embedded rotation limits still work on both sides", () => {
  assert.equal(advanceRotationAngle(0, 10, 35), (35 * Math.PI) / 180);
  assert.equal(advanceRotationAngle(0, -10, 35), (-35 * Math.PI) / 180);
  assert.equal(advanceRotationAngle(1, 1, 0), 0);
});
