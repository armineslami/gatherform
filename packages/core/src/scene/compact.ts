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
const MAGIC = 0x47464334;

/** A compact surface trades exact grains for a small download; the full scene format stays lossless. */
export async function encodeCompactScene(
  scene: GatherformScene,
): Promise<ArrayBuffer> {
  validateScene(scene);
  const surfaces: Uint8Array[] = [];
  for (const cloud of scene.clouds) {
    surfaces.push(encodeSurface(cloud));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
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
  view.setUint32(0, MAGIC);
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
      if (length > 4 * Math.max(GRID_BYTES, MAX_SURFACE_BYTES) + 65536 + 16)
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
    ![MAGIC, SURFACE_MAGIC, LEGACY_MAGIC].includes(view.getUint32(0))
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
      const surface = await decodeSurface(
        bytes,
        surfaceOffset,
        length - 4,
        cloud,
        pointCount,
        signal,
      );
      clouds.push(surface.cloud);
      surfaceOffset = surface.nextOffset;
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
