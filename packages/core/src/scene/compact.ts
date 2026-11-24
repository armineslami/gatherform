import {
  encodeSurface,
  decodeSurface,
  MAX_SURFACE_BYTES,
} from "./compact-surface.js";
import {
  validateScene,
  decodeScene,
  encodeScene,
  MAX_SCENE_BYTES,
  MAX_POINTS,
  type GatherformScene,
  type Cloud,
} from "./scene.js";

const GRID_SIZE = 128;
const CELL_BYTES = 6;
const GRID_BYTES = GRID_SIZE * GRID_SIZE * CELL_BYTES;
const LEGACY_MAGIC = 0x47464332;
const SURFACE_MAGIC = 0x47464333;
const PRECISE_SURFACE_MAGIC = 0x47464334;
const MAGIC = 0x47464335;
const savedPictures = new WeakMap<Cloud, Uint8Array>();

function encodePicture(cloud: Cloud): Uint8Array {
  const saved = savedPictures.get(cloud);
  if (saved) return saved;

  const pointCount = cloud.positions.length / 3;
  let darkCount = 0;
  let lightCount = 0;
  const toneCounts = [0, 0];
  const toneAlphaSums = [0, 0];
  // Keep two distinct tones in separate surfaces so a diagonal between them does not become a row of gray squares.
  const brightness = (offset: number) =>
    Math.max(
      cloud.colors[offset],
      cloud.colors[offset + 1],
      cloud.colors[offset + 2],
    );
  // Any depth source qualifies: the two-tone test below decides, not how depth was made.
  for (let offset = 0; offset < cloud.colors.length; offset += 4) {
    const value = brightness(offset);
    if (value <= 95) darkCount++;
    if (value >= 175) lightCount++;
    const tone = value < 135 ? 0 : 1;
    toneCounts[tone]++;
    toneAlphaSums[tone] += cloud.colors[offset + 3];
  }

  let surfaces: Uint8Array[];
  let firstCount = 0;
  if (
    Math.min(darkCount, lightCount) >= pointCount * 0.05 &&
    darkCount + lightCount >= pointCount * 0.97 &&
    toneAlphaSums.every((sum, tone) => sum >= toneCounts[tone] * 128)
  ) {
    firstCount = toneCounts[0];
    const toneClouds = toneCounts.map((count) => ({
      ...cloud,
      positions: new Float32Array(count * 3),
      colors: new Uint8Array(count * 4),
    }));
    const offsets = [0, 0];
    for (let point = 0; point < pointCount; point++) {
      const tone = brightness(point * 4) < 135 ? 0 : 1;
      const index = offsets[tone]++;
      toneClouds[tone].positions.set(
        cloud.positions.subarray(point * 3, point * 3 + 3),
        index * 3,
      );
      toneClouds[tone].colors.set(
        cloud.colors.subarray(point * 4, point * 4 + 4),
        index * 4,
      );
    }
    surfaces = toneClouds.map(encodeSurface);
  } else {
    surfaces = [encodeSurface(cloud)];
  }

  const bytes = new Uint8Array(
    4 + surfaces.reduce((length, surface) => length + surface.length, 0),
  );
  new DataView(bytes.buffer).setUint32(0, firstCount, true);
  let offset = 4;
  for (const surface of surfaces) {
    bytes.set(surface, offset);
    offset += surface.length;
  }
  return bytes;
}

function mergeTones(first: Cloud, second: Cloud): Cloud {
  const firstCount = first.positions.length / 3;
  const secondCount = second.positions.length / 3;
  const positions = new Float32Array(
    first.positions.length + second.positions.length,
  );
  const colors = new Uint8Array(first.colors.length + second.colors.length);
  let left = 0;
  let right = 0;

  // Preserve the top-to-bottom order used by picture transitions and trackers.
  for (let point = 0; point < firstCount + secondCount; point++) {
    const useFirst =
      right === secondCount ||
      (left < firstCount &&
        first.positions[left * 3 + 1] >= second.positions[right * 3 + 1]);
    const cloud = useFirst ? first : second;
    const index = useFirst ? left++ : right++;
    positions.set(
      cloud.positions.subarray(index * 3, index * 3 + 3),
      point * 3,
    );
    colors.set(cloud.colors.subarray(index * 4, index * 4 + 4), point * 4);
  }
  return { ...first, positions, colors };
}

/** A compact surface trades exact grains for a small download; the full scene format stays lossless. */
export async function encodeCompactScene(
  scene: GatherformScene,
): Promise<ArrayBuffer> {
  validateScene(scene);
  const pictures: Uint8Array[] = [];
  for (const cloud of scene.clouds) {
    pictures.push(encodePicture(cloud));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const hasSeparateTones = pictures.some(
    (picture) =>
      new DataView(
        picture.buffer,
        picture.byteOffset,
        picture.byteLength,
      ).getUint32(0, true) > 0,
  );
  const surfaces = hasSeparateTones
    ? pictures
    : pictures.map((picture) => picture.subarray(4));
  const metadata = encodeScene({
    ...scene,
    clouds: scene.clouds.map((cloud) => ({
      ...cloud,
      positions: new Float32Array(3),
      colors: new Uint8Array(4),
    })),
  });
  const bytes = new Uint8Array(
    8 +
      metadata.byteLength +
      surfaces.reduce((total, surface) => total + surface.length, 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, hasSeparateTones ? MAGIC : PRECISE_SURFACE_MAGIC);
  view.setUint32(4, metadata.byteLength, true);
  bytes.set(new Uint8Array(metadata), 8);
  let surfaceOffset = 8 + metadata.byteLength;
  for (const surface of surfaces) {
    bytes.set(surface, surfaceOffset);
    surfaceOffset += surface.length;
  }
  // The original point budget is kept separately from the one-point metadata scene.
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(
    0,
    scene.clouds[0].positions.length / 3,
    true,
  );
  const compressed = new Blob([bytes, count])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(compressed).arrayBuffer();
}

/** Accept both existing prepared files and compact files. Expansion yields between small batches. */
export async function decodeSceneFile(
  buffer: ArrayBuffer,
  signal?: AbortSignal,
): Promise<GatherformScene> {
  signal?.throwIfAborted();
  if (buffer.byteLength > MAX_SCENE_BYTES)
    throw new Error("Scene exceeds 40 MB.");
  if (buffer.byteLength < 2 || new DataView(buffer).getUint16(0) !== 0x1f8b)
    return decodeScene(buffer);
  const reader = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (
        length >
        4 * Math.max(GRID_BYTES, 4 + 2 * MAX_SURFACE_BYTES) + 65536 + 16
      )
        throw new Error("Compact scene expands beyond its limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const view = new DataView(bytes.buffer);
  if (
    length < 12 ||
    ![MAGIC, PRECISE_SURFACE_MAGIC, SURFACE_MAGIC, LEGACY_MAGIC].includes(
      view.getUint32(0),
    )
  )
    throw new Error("Invalid or unsupported compact scene.");
  const headerLength = view.getUint32(4, true);
  if (headerLength < 8 || headerLength > 65536 || headerLength + 12 > length)
    throw new Error("Invalid compact header.");
  const scene = decodeScene(bytes.buffer.slice(8, 8 + headerLength));
  const pointCount = view.getUint32(length - 4, true);
  if (
    pointCount < 1 ||
    pointCount > MAX_POINTS ||
    (view.getUint32(0) === LEGACY_MAGIC &&
      length !== 12 + headerLength + scene.clouds.length * GRID_BYTES)
  )
    throw new Error("Invalid compact point budget.");
  if (view.getUint32(0) !== LEGACY_MAGIC) {
    const clouds: Cloud[] = [];
    let surfaceOffset = 8 + headerLength;
    for (const cloud of scene.clouds) {
      signal?.throwIfAborted();
      const pictureStart = surfaceOffset;
      let firstCount = 0;
      if (view.getUint32(0) === MAGIC) {
        if (surfaceOffset + 4 > length - 4)
          throw new Error("Truncated compact picture.");
        firstCount = view.getUint32(surfaceOffset, true);
        if (firstCount >= pointCount)
          throw new Error("Invalid compact tone count.");
        surfaceOffset += 4;
      }
      const first = await decodeSurface(
        bytes,
        surfaceOffset,
        length - 4,
        cloud,
        firstCount || pointCount,
        signal,
      );
      surfaceOffset = first.nextOffset;
      let picture = first.cloud;
      if (firstCount) {
        const second = await decodeSurface(
          bytes,
          surfaceOffset,
          length - 4,
          cloud,
          pointCount - firstCount,
          signal,
        );
        picture = mergeTones(first.cloud, second.cloud);
        surfaceOffset = second.nextOffset;
      }
      if (view.getUint32(0) === MAGIC)
        savedPictures.set(picture, bytes.slice(pictureStart, surfaceOffset));
      clouds.push(picture);
    }
    if (surfaceOffset !== length - 4)
      throw new Error("Unexpected compact surface bytes.");
    const result = { ...scene, clouds };
    validateScene(result);
    return result;
  }
  const clouds: Cloud[] = [];
  for (let image = 0; image < scene.clouds.length; image++) {
    signal?.throwIfAborted();
    const grid = new DataView(
      bytes.buffer,
      8 + headerLength + image * GRID_BYTES,
      GRID_BYTES,
    );
    const cells: number[] = [];
    for (let cell = 0; cell < GRID_SIZE * GRID_SIZE; cell++)
      if (grid.getUint8(cell * 6 + 3) > 0) cells.push(cell);
    if (!cells.length)
      throw new Error("Compact picture has no visible pixels.");
    const positions = new Float32Array(pointCount * 3);
    const colors = new Uint8Array(pointCount * 4);
    let state = 123456789;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    for (let point = 0; point < pointCount; point++) {
      const cell =
        cells[Math.floor(((point + random()) / pointCount) * cells.length)];
      const sampleX = (cell % GRID_SIZE) + random();
      const sampleY = Math.floor(cell / GRID_SIZE) + random();
      positions[point * 3] = (sampleX / GRID_SIZE - 0.5) * 2;
      positions[point * 3 + 1] = (0.5 - sampleY / GRID_SIZE) * 2;
      // Blend between occupied depth cells so rotation does not expose grid-shaped steps.
      const left = Math.floor(sampleX - 0.5);
      const top = Math.floor(sampleY - 0.5);
      const horizontal = sampleX - 0.5 - left;
      const vertical = sampleY - 0.5 - top;
      const upper =
        readGridDepth(grid, left, top, cell) * (1 - horizontal) +
        readGridDepth(grid, left + 1, top, cell) * horizontal;
      const lower =
        readGridDepth(grid, left, top + 1, cell) * (1 - horizontal) +
        readGridDepth(grid, left + 1, top + 1, cell) * horizontal;
      positions[point * 3 + 2] =
        upper * (1 - vertical) + lower * vertical + (random() - 0.5) * 0.014;
      for (let channel = 0; channel < 4; channel++)
        colors[point * 4 + channel] = grid.getUint8(cell * 6 + channel);
      if ((point + 1) % 8192 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal?.throwIfAborted();
      }
    }
    clouds.push({ ...scene.clouds[image], positions, colors });
  }
  const result = { ...scene, clouds };
  validateScene(result);
  return result;
}

function readGridDepth(
  grid: DataView,
  x: number,
  y: number,
  fallbackCell: number,
): number {
  const neighbor =
    Math.max(0, Math.min(GRID_SIZE - 1, y)) * GRID_SIZE +
    Math.max(0, Math.min(GRID_SIZE - 1, x));
  const cell = grid.getUint8(neighbor * CELL_BYTES + 3)
    ? neighbor
    : fallbackCell;
  return (grid.getUint16(cell * CELL_BYTES + 4, true) / 65535) * 20 - 10;
}
