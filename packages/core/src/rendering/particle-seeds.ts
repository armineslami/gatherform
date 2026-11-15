/** Mix adjacent image samples so their lifetimes cannot form moving rows. */
export function createParticleSeeds(pointCount: number): Float32Array {
  const seeds = new Float32Array(pointCount);

  for (let index = 0; index < pointCount; index++) {
    let hash = index + 1;
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
    hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
    hash ^= hash >>> 16;
    seeds[index] = (hash >>> 8) / 16777216;
  }

  return seeds;
}
