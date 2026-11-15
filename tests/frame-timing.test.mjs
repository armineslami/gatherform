import assert from "node:assert/strict";
import { test } from "node:test";
import { nextFrameDeadline } from "../packages/core/dist/rendering/frame-timing.js";

function renderedFrames(timestamps, fps) {
  let deadline = 0;
  return timestamps.filter((time) => {
    const next = nextFrameDeadline(time, deadline, fps);
    if (next === null) return false;
    deadline = next;
    return true;
  });
}

test("a jittery 60 Hz clock does not repeatedly halve the frame rate", () => {
  const times = Array.from(
    { length: 600 },
    (_, index) => 100 + (index * 1000) / 60 + (index % 2 ? -2 : 0),
  );
  assert.equal(renderedFrames(times, 60).length, 600);
});
test("120 Hz displays retain the requested 60 and 30 FPS caps", () => {
  const times = Array.from(
    { length: 1200 },
    (_, index) => 100 + (index * 1000) / 120,
  );
  assert.equal(renderedFrames(times, 60).length, 600);
  assert.equal(renderedFrames(times, 30).length, 300);
});
test("long stalls restart cadence without a catch-up burst", () => {
  assert.equal(nextFrameDeadline(5000, 120, 60), 5000 + 1000 / 60);
  assert.equal(nextFrameDeadline(5001, 5000 + 1000 / 60, 60), null);
});
