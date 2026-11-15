import type { Cloud } from "./scene.js";

const GRID_SIZE = 80;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const PLANE_COUNT = 16;
// Each patch sums count, x/y/depth, their squares, paired products, then RGBA.
const MOMENT_COUNT = 14;
const DIFFERENCE_PACKED = 0x8000;
const PRECISE_EDGES = 0x4000;
const PATCH_COUNT_MASK = 0x3fff;
const DENSITY_STEP = Math.log(1.055);
const savedSurfaces = new WeakMap<Cloud, Uint8Array>();
export const MAX_SURFACE_BYTES = 10 + CELL_COUNT * PLANE_COUNT;

function quantize(
  value: number,
  minimum: number,
  maximum: number,
  levels: number,
): number {
  return Math.max(
    0,
    Math.min(
      levels,
      Math.round(((value - minimum) / (maximum - minimum)) * levels),
    ),
  );
}

/** Store local density, thin-line direction and depth slope instead of filling square cells. */
export function encodeSurface(cloud: Cloud): Uint8Array {
  const saved = savedSurfaces.get(cloud);
  if (saved) return saved;
  const sums = new Float64Array(CELL_COUNT * MOMENT_COUNT);
  let minimumDepth = Infinity;
  let maximumDepth = -Infinity;
  for (let point = 0; point < cloud.positions.length / 3; point++) {
    const x = cloud.positions[point * 3];
    const y = cloud.positions[point * 3 + 1];
    const z = cloud.positions[point * 3 + 2];
    if (Math.abs(x) > 1 || Math.abs(y) > 1 || Math.abs(z) > 9.99)
      throw new Error(
        "This geometry needs the full-detail export; it exceeds the compact surface bounds.",
      );
    minimumDepth = Math.min(minimumDepth, z);
    maximumDepth = Math.max(maximumDepth, z);
    const imageX = ((x + 1) * GRID_SIZE) / 2;
    const imageY = ((1 - y) * GRID_SIZE) / 2;
    const column = Math.min(GRID_SIZE - 1, Math.floor(imageX));
    const row = Math.min(GRID_SIZE - 1, Math.floor(imageY));
    const u = imageX - column;
    const v = imageY - row;
    const offset = (row * GRID_SIZE + column) * MOMENT_COUNT;
    // These totals let us recover the average, spread and line direction without saving each point.
    sums[offset]++;
    sums[offset + 1] += u;
    sums[offset + 2] += v;
    sums[offset + 3] += z;
    sums[offset + 4] += u * u;
    sums[offset + 5] += v * v;
    sums[offset + 6] += z * z;
    sums[offset + 7] += u * v;
    sums[offset + 8] += u * z;
    sums[offset + 9] += v * z;
    for (let channel = 0; channel < 4; channel++)
      sums[offset + 10 + channel] += cloud.colors[point * 4 + channel];
  }
  const { edgeAngles, edgeMinimums } = measurePatchEdges(cloud.positions, sums);

  const indices: number[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    const offset = cell * MOMENT_COUNT;
    if (sums[offset] && sums[offset + 13] / sums[offset] >= 0.5)
      indices.push(cell);
  }
  if (!indices.length)
    throw new Error("Compact picture has no visible pixels.");
  const bytes = new Uint8Array(10 + indices.length * PLANE_COUNT);
  const view = new DataView(bytes.buffer);
  view.setFloat32(0, minimumDepth, true);
  view.setFloat32(4, maximumDepth, true);
  view.setUint16(8, indices.length | DIFFERENCE_PACKED | PRECISE_EDGES, true);
  const range = Math.max(0.000001, maximumDepth - minimumDepth);
  // Store one field for every patch together so neighboring values compress well.
  const put = (plane: number, index: number, value: number) => {
    bytes[10 + plane * indices.length + index] = value;
  };
  for (let index = 0; index < indices.length; index++) {
    const cell = indices[index];
    const offset = cell * MOMENT_COUNT;
    const count = sums[offset];
    const meanX = sums[offset + 1] / count;
    const meanY = sums[offset + 2] / count;
    const meanDepth = sums[offset + 3] / count;
    const varianceX = Math.max(0, sums[offset + 4] / count - meanX * meanX);
    const varianceY = Math.max(0, sums[offset + 5] / count - meanY * meanY);
    const varianceDepth =
      Math.max(0, sums[offset + 6] / count - meanDepth * meanDepth) /
      (range * range);
    const covarianceXY = sums[offset + 7] / count - meanX * meanY;
    const covarianceXZ = (sums[offset + 8] / count - meanX * meanDepth) / range;
    const covarianceYZ = (sums[offset + 9] / count - meanY * meanDepth) / range;
    // The small added value avoids dividing by zero when a patch contains an almost straight line.
    const determinant =
      (varianceX + 0.00001) * (varianceY + 0.00001) -
      covarianceXY * covarianceXY;
    const slopeXCode = quantize(
      (covarianceXZ * (varianceY + 0.00001) - covarianceYZ * covarianceXY) /
        determinant,
      -2,
      2,
      254,
    );
    const slopeYCode = quantize(
      (covarianceYZ * (varianceX + 0.00001) - covarianceXZ * covarianceXY) /
        determinant,
      -2,
      2,
      254,
    );
    const slopeX = ((slopeXCode - 127) * 2) / 127;
    const slopeY = ((slopeYCode - 127) * 2) / 127;
    const residual = Math.sqrt(
      Math.max(
        0,
        varianceDepth -
          2 * (slopeX * covarianceXZ + slopeY * covarianceYZ) +
          slopeX * slopeX * varianceX +
          2 * slopeX * slopeY * covarianceXY +
          slopeY * slopeY * varianceY,
      ),
    );
    const depthCode = quantize(
      meanDepth,
      minimumDepth,
      minimumDepth + range,
      4095,
    );
    put(0, index, cell >> 8);
    put(1, index, cell & 255);
    put(2, index, Math.max(1, Math.round(Math.log(count + 1) / DENSITY_STEP)));
    for (let channel = 0; channel < 4; channel++)
      put(3 + channel, index, Math.round(sums[offset + 10 + channel] / count));
    put(7, index, depthCode >> 4);
    const edgeAngle = (edgeAngles[cell] / 63) * Math.PI * 2 - Math.PI;
    const patchMinimum =
      -(Math.abs(Math.cos(edgeAngle)) + Math.abs(Math.sin(edgeAngle))) / 2;
    // Full patches need no extra boundary; zero planes also compress more efficiently.
    const hasEdge = edgeMinimums[cell] > patchMinimum + 0.025;
    // Share twelve bits between direction and distance to keep the boundary small.
    const limitCode = hasEdge
      ? 1 +
        Math.max(
          0,
          Math.min(
            62,
            Math.floor(((edgeMinimums[cell] + Math.SQRT1_2) * 62) / Math.SQRT2),
          ),
        )
      : 0;
    put(15, index, (hasEdge ? edgeAngles[cell] << 2 : 0) | (limitCode >> 4));
    put(8, index, ((depthCode & 15) << 4) | (limitCode & 15));
    put(9, index, quantize(meanX, 0, 1, 15) * 16 + quantize(meanY, 0, 1, 15));
    put(
      10,
      index,
      quantize(Math.sqrt(varianceX), 0, 0.5, 15) * 16 +
        quantize(Math.sqrt(varianceY), 0, 0.5, 15),
    );
    put(
      11,
      index,
      quantize(
        covarianceXY / Math.max(0.00000001, Math.sqrt(varianceX * varianceY)),
        -1,
        1,
        30,
      ),
    );
    put(12, index, slopeXCode);
    put(13, index, slopeYCode);
    put(14, index, quantize(residual, 0, 0.125, 255));
  }
  // Neighbor differences compress better without changing any stored value.
  for (let plane = 0; plane < PLANE_COUNT; plane++) {
    let previous = 0;
    for (let index = 0; index < indices.length; index++) {
      const offset = 10 + plane * indices.length + index;
      const value = bytes[offset];
      bytes[offset] = (value - previous) & 255;
      previous = value;
    }
  }
  return bytes;
}

/** Rebuild once on load; playback keeps the same prepared buffers and GPU effects. */
export async function decodeSurface(
  bytes: Uint8Array,
  offset: number,
  end: number,
  metadata: Cloud,
  pointCount: number,
  signal?: AbortSignal,
): Promise<{ cloud: Cloud; nextOffset: number }> {
  if (offset + 10 > end) throw new Error("Truncated compact surface.");
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    end - offset,
  );
  const minimumDepth = view.getFloat32(0, true);
  const maximumDepth = view.getFloat32(4, true);
  const countFlags = view.getUint16(8, true);
  const preciseEdges = Boolean(countFlags & PRECISE_EDGES);
  const planeCount = preciseEdges ? PLANE_COUNT : 15;
  const count = countFlags & PATCH_COUNT_MASK;
  const nextOffset = offset + 10 + count * planeCount;
  if (
    !Number.isFinite(minimumDepth) ||
    !Number.isFinite(maximumDepth) ||
    minimumDepth < -10 ||
    maximumDepth > 10 ||
    maximumDepth < minimumDepth ||
    count < 1 ||
    count > CELL_COUNT ||
    nextOffset > end
  )
    throw new Error("Invalid compact surface bounds.");
  const encodedSurface = bytes.slice(offset, nextOffset);
  const data = bytes.slice(offset + 10, nextOffset);
  if (countFlags & DIFFERENCE_PACKED) {
    for (let plane = 0; plane < planeCount; plane++) {
      let previous = 0;
      for (let index = 0; index < count; index++) {
        const value = (data[plane * count + index] + previous) & 255;
        data[plane * count + index] = value;
        previous = value;
      }
    }
  }
  const at = (plane: number, index: number) => data[plane * count + index];
  const cells = new Uint16Array(count);
  // A denser source patch must receive more rebuilt points than a sparse one.
  const cumulativeWeight = new Float64Array(count);
  let totalWeight = 0;
  for (let index = 0; index < count; index++) {
    const cell = at(0, index) * 256 + at(1, index);
    if (
      cell >= CELL_COUNT ||
      (index > 0 && cell <= cells[index - 1]) ||
      !at(2, index) ||
      !at(6, index) ||
      at(11, index) > 30 ||
      at(12, index) > 254 ||
      at(13, index) > 254
    )
      throw new Error("Invalid compact surface patch.");
    cells[index] = cell;
    totalWeight += Math.expm1(at(2, index) * DENSITY_STEP);
    cumulativeWeight[index] = totalWeight;
  }
  const positions = new Float32Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 4);
  let state = 123456789;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const range = maximumDepth - minimumDepth;
  let index = 0;
  for (let point = 0; point < pointCount; point++) {
    const targetWeight = ((point + random()) / pointCount) * totalWeight;
    while (cumulativeWeight[index] <= targetWeight && index < count - 1)
      index++;
    const cell = cells[index];
    const meanX = (at(9, index) >> 4) / 15;
    const meanY = (at(9, index) & 15) / 15;
    const spreadX = (at(10, index) >> 4) / 30;
    const spreadY = (at(10, index) & 15) / 30;
    const correlation = at(11, index) / 15 - 1;
    const limitCode = preciseEdges
      ? ((at(15, index) & 3) << 4) | (at(8, index) & 15)
      : 0;
    const edgeCode = preciseEdges ? 1 : at(8, index) & 15;
    const angle = preciseEdges
      ? ((at(15, index) >> 2) / 63) * Math.PI * 2 - Math.PI
      : 0;
    const normalX = preciseEdges ? Math.cos(angle) : meanX - 0.5;
    const normalY = preciseEdges ? Math.sin(angle) : meanY - 0.5;
    const normalLength = preciseEdges ? 1 : Math.hypot(normalX, normalY);
    const edgeLimit =
      -Math.SQRT1_2 +
      (preciseEdges
        ? ((limitCode - 1) * Math.SQRT2) / 62
        : ((edgeCode - 1) * Math.SQRT2) / 14);
    // shortcut: one straight edge per patch, use full detail for exact highly zoomed curves.
    let u = meanX;
    let v = meanY;
    // Reject overshoot rather than clamping, which would pile points onto a visible line.
    for (let attempt = 0; attempt < 32; attempt++) {
      const across = (random() - 0.5) * Math.sqrt(12);
      const along = (random() - 0.5) * Math.sqrt(12);
      const candidateU = meanX + spreadX * across;
      const candidateV =
        meanY +
        spreadY *
          (correlation * across +
            Math.sqrt(Math.max(0, 1 - correlation * correlation)) * along);
      if (
        edgeCode &&
        (candidateU < 0 ||
          candidateU > 1 ||
          candidateV < 0 ||
          candidateV > 1 ||
          ((!preciseEdges || limitCode !== 0) &&
            ((candidateU - 0.5) * normalX + (candidateV - 0.5) * normalY) /
              normalLength <
              edgeLimit))
      )
        continue;
      u = candidateU;
      v = candidateV;
      break;
    }
    positions[point * 3] = Math.max(
      -1,
      Math.min(1, (((cell % GRID_SIZE) + u) / GRID_SIZE - 0.5) * 2),
    );
    positions[point * 3 + 1] = Math.max(
      -1,
      Math.min(1, (0.5 - (Math.floor(cell / GRID_SIZE) + v) / GRID_SIZE) * 2),
    );
    const depth = ((at(7, index) << 4) + (at(8, index) >> 4)) / 4095;
    const slopeX = ((at(12, index) - 127) * 2) / 127;
    const slopeY = ((at(13, index) - 127) * 2) / 127;
    const grain =
      (at(14, index) / 255) * 0.125 * (random() + random() - 1) * Math.sqrt(6);
    positions[point * 3 + 2] = Math.max(
      -10,
      Math.min(
        10,
        minimumDepth +
          (depth + slopeX * (u - meanX) + slopeY * (v - meanY) + grain) * range,
      ),
    );
    for (let channel = 0; channel < 4; channel++)
      colors[point * 4 + channel] = at(3 + channel, index);
    if ((point + 1) % 8192 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
  }
  const cloud = { ...metadata, positions, colors };
  // Keep the encoded surface so repeated saves do not add another round of approximation.
  savedSurfaces.set(cloud, encodedSurface);
  return { cloud, nextOffset };
}

/** Find the inward edge direction and the outermost source point in each patch. */
function measurePatchEdges(positions: Float32Array, sums: Float64Array) {
  // Neighbor density gives curved edges a steadier direction than each patch's center alone.
  const edgeAngles = new Uint8Array(CELL_COUNT);
  const edgeMinimums = new Float64Array(CELL_COUNT).fill(Infinity);
  const density = (column: number, row: number) => {
    if (column < 0 || column >= GRID_SIZE || row < 0 || row >= GRID_SIZE)
      return 0;
    return sums[(row * GRID_SIZE + column) * MOMENT_COUNT];
  };
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    const column = cell % GRID_SIZE;
    const row = Math.floor(cell / GRID_SIZE);
    let normalX = 0;
    let normalY = 0;
    for (let neighbor = -1; neighbor <= 1; neighbor++) {
      const weight = neighbor === 0 ? 2 : 1;
      normalX +=
        weight *
        (density(column + 1, row + neighbor) -
          density(column - 1, row + neighbor));
      normalY +=
        weight *
        (density(column + neighbor, row + 1) -
          density(column + neighbor, row - 1));
    }
    edgeAngles[cell] = quantize(
      Math.atan2(normalY, normalX),
      -Math.PI,
      Math.PI,
      63,
    );
  }
  for (let point = 0; point < positions.length / 3; point++) {
    const imageX = ((positions[point * 3] + 1) * GRID_SIZE) / 2;
    const imageY = ((1 - positions[point * 3 + 1]) * GRID_SIZE) / 2;
    const column = Math.min(GRID_SIZE - 1, Math.floor(imageX));
    const row = Math.min(GRID_SIZE - 1, Math.floor(imageY));
    const cell = row * GRID_SIZE + column;
    const angle = (edgeAngles[cell] / 63) * Math.PI * 2 - Math.PI;
    const projection =
      (imageX - column - 0.5) * Math.cos(angle) +
      (imageY - row - 0.5) * Math.sin(angle);
    edgeMinimums[cell] = Math.min(edgeMinimums[cell], projection);
  }
  return { edgeAngles, edgeMinimums };
}
