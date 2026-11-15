import assert from "node:assert/strict";
import { test } from "node:test";
import { createParticleSeeds } from "../packages/core/dist/rendering/particle-seeds.js";

test("lifetimes cover the full range without following neighboring image rows", () => {
  const seeds = createParticleSeeds(65_536);
  const bins = new Uint32Array(16);
  let neighboringDifference = 0;

  for (let index = 0; index < seeds.length; index++) {
    const seed = seeds[index];
    assert.ok(seed >= 0 && seed < 1);
    bins[Math.floor(seed * bins.length)]++;
    if (index > 0) neighboringDifference += Math.abs(seed - seeds[index - 1]);
  }

  assert.ok(neighboringDifference / (seeds.length - 1) > 0.25);
  for (const count of bins) assert.ok(count > 3500 && count < 4700);
  assert.deepEqual(createParticleSeeds(32), seeds.slice(0, 32));
});
