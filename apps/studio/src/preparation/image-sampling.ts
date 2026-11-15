// Prepare a fixed point budget once; playback reuses these arrays without resampling the image.
import { MAX_POINTS, type Cloud } from "@armin-eslami/gatherform-core";

export interface SamplingInput {
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  pointCount: number;
  threshold: number;
  depth?: {
    values: Float32Array;
    width: number;
    height: number;
    source: "ai" | "depth-map";
  };
}

/** Deterministic sampling keeps image transitions stable after reopening an export. */
export function sampleImage(input: SamplingInput): Cloud {
  const { width, height, rgba, pointCount, threshold, depth } = input;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4_194_304 ||
    rgba.length !== width * height * 4
  )
    throw new Error("Invalid image pixels.");
  if (
    !Number.isInteger(pointCount) ||
    pointCount < 1 ||
    pointCount > MAX_POINTS ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  )
    throw new Error("Invalid sampling settings.");
  if (
    depth &&
    (!Number.isInteger(depth.width) ||
      !Number.isInteger(depth.height) ||
      depth.width < 1 ||
      depth.height < 1 ||
      depth.width * depth.height > 4_194_304 ||
      depth.values.length !== depth.width * depth.height ||
      !depth.values.every(Number.isFinite))
  )
    throw new Error("Invalid depth map.");

  const brightnessDepth = createBrightnessDepth(rgba, width, height);
  const weights = new Float32Array(width * height);
  let totalWeight = 0;
  for (let index = 0; index < weights.length; index++) {
    const offset = index * 4;
    const brightness =
      (rgba[offset] * 0.2126 +
        rgba[offset + 1] * 0.7152 +
        rgba[offset + 2] * 0.0722) /
      255;
    const visible =
      rgba[offset + 3] > 8 &&
      Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]) / 255 >=
        threshold;
    if (!visible) continue;

    const adjacent = (index % width) + 1 < width ? index + 1 : index;
    const edge = Math.abs(rgba[adjacent * 4 + 3] - rgba[offset + 3]) / 255;
    weights[index] = (0.1 + brightness + edge * 0.5) * (rgba[offset + 3] / 255);
    totalWeight += weights[index];
  }
  if (totalWeight === 0)
    throw new Error("No visible pixels. Lower the dark-pixel cutoff.");

  const positions = new Float32Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 4);
  const aspect = width / height;
  const imageWidth = aspect >= 1 ? 2 : 2 * aspect;
  const imageHeight = aspect >= 1 ? 2 / aspect : 2;
  let randomState = 123456789;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 4294967296;
  };

  let minimumDepth = Infinity;
  let maximumDepth = -Infinity;
  if (depth) {
    for (const value of depth.values) {
      minimumDepth = Math.min(minimumDepth, value);
      maximumDepth = Math.max(maximumDepth, value);
    }
  }

  let pixel = 0;
  let accumulatedWeight = weights[0];
  for (let index = 0; index < pointCount; index++) {
    const targetWeight = ((index + random()) / pointCount) * totalWeight;
    while (accumulatedWeight <= targetWeight && pixel < weights.length - 1)
      accumulatedWeight += weights[++pixel];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const offset = pixel * 4;
    const sampleX = x + random();
    const sampleY = y + random();
    let near = interpolateDepth(
      brightnessDepth,
      width,
      height,
      sampleX - 0.5,
      sampleY - 0.5,
    );
    if (depth) {
      near =
        (interpolateDepth(
          depth.values,
          depth.width,
          depth.height,
          (sampleX / width) * depth.width - 0.5,
          (sampleY / height) * depth.height - 0.5,
        ) -
          minimumDepth) /
        Math.max(0.00001, maximumDepth - minimumDepth);
    }
    // AI estimates can flatten logos; retain some rounded image relief without changing imported maps.
    if (depth?.source === "ai") {
      near =
        near * 0.65 +
        interpolateDepth(
          brightnessDepth,
          width,
          height,
          sampleX - 0.5,
          sampleY - 0.5,
        ) *
          0.35;
    }
    positions[index * 3] = (sampleX / width - 0.5) * imageWidth;
    positions[index * 3 + 1] = (0.5 - sampleY / height) * imageHeight;
    // Sample between depth pixels so side views do not reveal stacked terraces.
    positions[index * 3 + 2] = (near - 0.5) * 0.8 + (random() - 0.5) * 0.014;
    colors.set(rgba.subarray(offset, offset + 4), index * 4);
  }
  return {
    name: input.name.slice(0, 200),
    depthSource: depth?.source ?? "brightness",
    positions,
    colors,
  };
}

/** Smooth image brightness into curved relief at opaque contours. Runs in the preparation worker. */
function createBrightnessDepth(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const brightness = new Float32Array(width * height);
  for (let index = 0; index < brightness.length; index++) {
    const offset = index * 4;
    brightness[index] =
      ((rgba[offset] * 0.2126 +
        rgba[offset + 1] * 0.7152 +
        rgba[offset + 2] * 0.0722) /
        255) *
      (rgba[offset + 3] / 255);
  }

  const radius = Math.max(1, Math.round(Math.max(width, height) / 45));
  const softened = blurDepth(
    blurDepth(brightness, width, height, radius),
    width,
    height,
    radius,
  );
  for (let index = 0; index < brightness.length; index++)
    softened[index] = softened[index] * 0.75 + brightness[index] * 0.25;

  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of softened) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (maximum > minimum) {
    for (let index = 0; index < softened.length; index++)
      softened[index] = (softened[index] - minimum) / (maximum - minimum);
  }

  return softened;
}

function blurDepth(
  values: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const stride = width + 1;
  const integral = new Float32Array(stride * (height + 1));

  // A summed-area table keeps the blur cost independent of its radius.
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += values[y * width + x];
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowSum;
    }
  }

  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum =
        integral[bottom * stride + right] -
        integral[top * stride + right] -
        integral[bottom * stride + left] +
        integral[top * stride + left];
      result[y * width + x] = sum / ((right - left) * (bottom - top));
    }
  }

  return result;
}

function interpolateDepth(
  values: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const boundedX = Math.max(0, Math.min(width - 1, x));
  const boundedY = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(boundedX);
  const top = Math.floor(boundedY);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const horizontal = boundedX - left;
  const vertical = boundedY - top;
  const upper =
    values[top * width + left] * (1 - horizontal) +
    values[top * width + right] * horizontal;
  const lower =
    values[bottom * width + left] * (1 - horizontal) +
    values[bottom * width + right] * horizontal;

  return upper * (1 - vertical) + lower * vertical;
}
