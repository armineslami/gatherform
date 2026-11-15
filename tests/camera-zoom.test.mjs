import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceZoom } from "../packages/core/dist/rendering/camera-zoom.js";

test("button zoom reverses and shares wheel bounds", () => {
  assert.equal(advanceZoom(advanceZoom(1, 1.2), 1 / 1.2), 1);
  assert.equal(advanceZoom(1, 100), 2);
  assert.equal(advanceZoom(1, 0.001), 0.5);
});
test("zoom rejects invalid public inputs", () => {
  for (const factor of [0, -1, NaN, Infinity])
    assert.throws(() => advanceZoom(1, factor));
  assert.throws(() => advanceZoom(NaN, 1));
});
