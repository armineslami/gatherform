// Prepare a fixed point budget once; playback reuses these arrays without resampling the image.
import { MAX_POINTS, type Cloud } from "@armin-eslami/gatherform-core";

/** Cutout height relative to its rounding radius; above 1 the rounded strokes read as raised relief. */
const SHAPE_RISE = 2.5;

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

  // Cutouts frame and round by their silhouette; an imported depth map stays authoritative.
  const isCutout = depth?.source !== "depth-map" && hasTransparentPixels(rgba);
  const useShapeDepth = !depth && isCutout;
  const weights = new Float32Array(width * height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
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

    if (isCutout) {
      const x = index % width;
      const y = Math.floor(index / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }

    const adjacent = (index % width) + 1 < width ? index + 1 : index;
    const edge = Math.abs(rgba[adjacent * 4 + 3] - rgba[offset + 3]) / 255;
    // A dark stroke in a cutout needs the same point density as a light one.
    weights[index] =
      (useShapeDepth ? 1 : 0.1 + brightness + edge * 0.5) *
      (rgba[offset + 3] / 255);
    totalWeight += weights[index];
  }
  if (totalWeight === 0)
    throw new Error("No visible pixels. Lower the dark-pixel cutoff.");

  // Transparent margins belong to the file, not to the size or depth of its artwork.
  const visibleWidth = isCutout ? right - left + 1 : width;
  const visibleHeight = isCutout ? bottom - top + 1 : height;
  const extent = Math.max(visibleWidth, visibleHeight);
  const centerX = (isCutout ? left : 0) + visibleWidth / 2;
  const centerY = (isCutout ? top : 0) + visibleHeight / 2;
  // Cutout strokes round over this many pixels, so thin lines become full tubes
  // and wide areas keep a flat face instead of a tall, sparsely sampled cliff.
  const roundingRadius = Math.max(3, Math.round(extent / 30));
  const relief =
    depth?.source === "depth-map"
      ? null
      : isCutout
        ? createShapeRelief(weights, width, height, roundingRadius)
        : createImageRelief(rgba, weights, width, height, extent);
  if (relief && useShapeDepth)
    totalWeight = weightSlopes(
      weights,
      relief,
      width,
      height,
      1,
      SHAPE_RISE * roundingRadius,
    );
  const guidedDepth =
    depth?.source === "ai"
      ? createGuidedDepth(rgba, weights, width, height, depth, extent)
      : null;
  if (guidedDepth && relief) {
    // AI estimates can flatten logos, so keep some rounded image relief.
    const padding = isCutout ? 1 : 0;
    for (let index = 0; index < guidedDepth.length; index++) {
      const x = index % width;
      const y = Math.floor(index / width);
      guidedDepth[index] =
        guidedDepth[index] * 0.65 +
        relief[(y + padding) * (width + 2 * padding) + x + padding] * 0.35;
    }
    // At depth 1 the AI range spans 0.8 × 1.875 world units, half an extent per unit.
    totalWeight = weightSlopes(
      weights,
      guidedDepth,
      width,
      height,
      0,
      0.75 * extent,
    );
  }

  const positions = new Float32Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 4);
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

  // At depth 1 (strength 1.875) a cutout rises SHAPE_RISE times its rounding
  // radius, so proportions follow the artwork instead of the file size.
  const depthScale = useShapeDepth
    ? (SHAPE_RISE * 2 * roundingRadius) / extent / 1.875
    : 0.8;
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
    const reliefDepth = relief
      ? interpolateDepth(
          relief,
          width + (isCutout ? 2 : 0),
          height + (isCutout ? 2 : 0),
          sampleX + (isCutout ? 0.5 : -0.5),
          sampleY + (isCutout ? 0.5 : -0.5),
        )
      : 0;
    let near = reliefDepth;
    if (guidedDepth) {
      near = interpolateDepth(
        guidedDepth,
        width,
        height,
        sampleX - 0.5,
        sampleY - 0.5,
      );
    } else if (depth) {
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
    positions[index * 3] = ((sampleX - centerX) * 2) / extent;
    positions[index * 3 + 1] = ((centerY - sampleY) * 2) / extent;
    // Sample between depth pixels so side views do not reveal stacked terraces.
    positions[index * 3 + 2] =
      (near - 0.5) * depthScale + (random() - 0.5) * 0.014;
    colors.set(rgba.subarray(offset, offset + 4), index * 4);
  }
  return {
    name: input.name.slice(0, 200),
    depthSource: depth?.source ?? (useShapeDepth ? "procedural" : "brightness"),
    positions,
    colors,
  };
}

function hasTransparentPixels(rgba: Uint8ClampedArray): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] <= 8) return true;
  }
  return false;
}

/**
 * Inflate a cutout into rounded strokes: depth follows the distance to the
 * nearest transparent pixel along a quarter circle, then stays flat. The result
 * has one empty pixel of padding on each side for interpolation at the PNG edge.
 */
function createShapeRelief(
  weights: Float32Array,
  width: number,
  height: number,
  roundingRadius: number,
): Float32Array {
  const stride = width + 2;
  const distances = new Float32Array(stride * (height + 2));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A pixel excluded by the cutoff must leave a hole in the relief as well.
      if (weights[y * width + x])
        distances[(y + 1) * stride + x + 1] = Infinity;
    }
  }

  // shortcut: chamfer distance is within 8% of Euclidean, enough for a rounded profile.
  const diagonal = Math.SQRT2;
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const index = y * stride + x;
      if (!distances[index]) continue;
      distances[index] = Math.min(
        distances[index],
        distances[index - 1] + 1,
        distances[index - stride] + 1,
        distances[index - stride - 1] + diagonal,
        distances[index - stride + 1] + diagonal,
      );
    }
  }
  for (let y = height; y >= 1; y--) {
    for (let x = width; x >= 1; x--) {
      const index = y * stride + x;
      if (!distances[index]) continue;
      distances[index] = Math.min(
        distances[index],
        distances[index + 1] + 1,
        distances[index + stride] + 1,
        distances[index + stride + 1] + diagonal,
        distances[index + stride - 1] + diagonal,
      );
    }
  }

  for (let index = 0; index < distances.length; index++) {
    if (!distances[index]) continue;
    // Distances run between pixel centers; the contour lies half a pixel out.
    const rise = Math.min(1, (distances[index] - 0.5) / roundingRadius);
    distances[index] = Math.sqrt(1 - (1 - rise) ** 2);
  }
  return distances;
}

/**
 * Give steep relief proportionally more grains, so the sides of a turned shape
 * are as dense as its face. Returns the new total weight.
 */
function weightSlopes(
  weights: Float32Array,
  relief: Float32Array,
  width: number,
  height: number,
  padding: 0 | 1,
  reliefHeightPixels: number,
): number {
  const stride = width + 2 * padding;
  let totalWeight = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!weights[index]) continue;
      const center = (y + padding) * stride + x + padding;
      // Unpadded fields repeat their border, so slopes stay one-sided there.
      const left = padding || x > 0 ? center - 1 : center;
      const right = padding || x < width - 1 ? center + 1 : center;
      const above = padding || y > 0 ? center - stride : center;
      const below = padding || y < height - 1 ? center + stride : center;
      const slopeX = (relief[right] - relief[left]) / 2;
      const slopeY = (relief[below] - relief[above]) / 2;
      const steepness = Math.hypot(slopeX, slopeY) * reliefHeightPixels;
      // Bound the boost so contour pixels cannot drain the face of its grains.
      weights[index] *= Math.min(4, Math.sqrt(1 + steepness * steepness));
      totalWeight += weights[index];
    }
  }
  return totalWeight;
}

/**
 * Snap a coarse AI depth estimate to the picture's own edges with a guided
 * filter (He, Sun and Tang): within each window, depth becomes a linear function
 * of the image, so contours stay crisp while the model's volume is kept.
 * Returns 0–1 depth per image pixel, normalized over visible pixels.
 */
function createGuidedDepth(
  rgba: Uint8ClampedArray,
  weights: Float32Array,
  width: number,
  height: number,
  depth: NonNullable<SamplingInput["depth"]>,
  extent: number,
): Float32Array {
  const length = width * height;
  const guide = new Float32Array(length);
  const estimate = new Float32Array(length);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < length; index++) {
    const x = index % width;
    const y = Math.floor(index / width);
    estimate[index] = interpolateDepth(
      depth.values,
      depth.width,
      depth.height,
      ((x + 0.5) / width) * depth.width - 0.5,
      ((y + 0.5) / height) * depth.height - 0.5,
    );
    minimum = Math.min(minimum, estimate[index]);
    maximum = Math.max(maximum, estimate[index]);

    const offset = index * 4;
    const brightness =
      (rgba[offset] * 0.2126 +
        rgba[offset + 1] * 0.7152 +
        rgba[offset + 2] * 0.0722) /
      255;
    // Opacity keeps dark strokes distinct from a transparent background.
    guide[index] = (rgba[offset + 3] / 255) * (0.35 + 0.65 * brightness);
  }
  const range = Math.max(0.00001, maximum - minimum);
  for (let index = 0; index < length; index++)
    estimate[index] = (estimate[index] - minimum) / range;

  const radius = Math.max(2, Math.round(extent / 40));
  // Regularization on 0–1 values: smaller follows finer image edges.
  const regularization = 0.0015;
  const guideSquares = new Float32Array(length);
  const guideEstimate = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    guideSquares[index] = guide[index] * guide[index];
    guideEstimate[index] = guide[index] * estimate[index];
  }
  const meanGuide = blurDepth(guide, width, height, radius);
  const meanEstimate = blurDepth(estimate, width, height, radius);
  const meanSquares = blurDepth(guideSquares, width, height, radius);
  const meanProducts = blurDepth(guideEstimate, width, height, radius);

  // Reuse the product buffers for the per-window slope and offset.
  const slope = guideSquares;
  const offset = guideEstimate;
  for (let index = 0; index < length; index++) {
    const variance = meanSquares[index] - meanGuide[index] ** 2;
    const covariance =
      meanProducts[index] - meanGuide[index] * meanEstimate[index];
    slope[index] = covariance / (variance + regularization);
    offset[index] = meanEstimate[index] - slope[index] * meanGuide[index];
  }
  const meanSlope = blurDepth(slope, width, height, radius);
  const meanOffset = blurDepth(offset, width, height, radius);

  const guided = new Float32Array(length);
  minimum = Infinity;
  maximum = -Infinity;
  for (let index = 0; index < length; index++) {
    guided[index] = meanSlope[index] * guide[index] + meanOffset[index];
    if (!weights[index]) continue;
    minimum = Math.min(minimum, guided[index]);
    maximum = Math.max(maximum, guided[index]);
  }
  // Spread the visible artwork over the full range; hidden pixels only feed edge interpolation.
  const visibleRange = maximum - minimum;
  // A flat estimate stays flat; stretching float noise would invent relief.
  if (!(visibleRange > 0.001)) return guided.fill(0.5);
  for (let index = 0; index < length; index++)
    guided[index] = Math.min(
      1,
      Math.max(0, (guided[index] - minimum) / visibleRange),
    );
  return guided;
}

/** Soften the brightness field into a rounded surface. */
function createImageRelief(
  rgba: Uint8ClampedArray,
  weights: Float32Array,
  width: number,
  height: number,
  extent: number,
): Float32Array {
  const field = new Float32Array(width * height);
  for (let index = 0; index < field.length; index++) {
    // A pixel excluded by the cutoff must leave a hole in the relief as well.
    if (!weights[index]) continue;
    const offset = index * 4;
    field[index] =
      ((rgba[offset] * 0.2126 +
        rgba[offset + 1] * 0.7152 +
        rgba[offset + 2] * 0.0722) /
        255) *
      (rgba[offset + 3] / 255);
  }

  const radius = Math.max(1, Math.round(extent / 45));
  const softened = blurDepth(
    blurDepth(field, width, height, radius),
    width,
    height,
    radius,
  );
  for (let index = 0; index < field.length; index++)
    softened[index] = softened[index] * 0.75 + field[index] * 0.25;

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
