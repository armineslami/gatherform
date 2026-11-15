import type { Cloud } from "@armin-eslami/gatherform-core";
import type { SamplingInput } from "@/preparation/image-sampling";

import { DEFAULT_POINT_COUNT } from "@/config/editor";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function readImage(
  file: File,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES)
    throw new Error("Choose an image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("Image dimensions exceed 40 megapixels.");
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    return {
      rgba: context.getImageData(0, 0, width, height).data,
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

/** Workers are terminated on success, failure, cancellation, and the deadline. */
function runWorker<Result>(
  worker: Worker,
  input: unknown,
  signal: AbortSignal,
  deadlineMilliseconds: number,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, result?: Result) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "Preparation timed out. Try a smaller image or a depth map.",
          ),
        ),
      deadlineMilliseconds,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) =>
      finish(new Error(event.message || "Image worker failed."));
    worker.onmessage = (event: MessageEvent<Result & { error?: string }>) => {
      if (event.data.error) finish(new Error(event.data.error));
      else finish(undefined, event.data);
    };
    if (signal.aborted) abort();
    else worker.postMessage(input);
  });
}

export async function prepareImage(
  input: SamplingInput,
  signal: AbortSignal,
): Promise<Cloud> {
  const worker = new Worker(
    new URL("./preparation.worker.ts", import.meta.url),
    { type: "module" },
  );
  const result = await runWorker<{ cloud: Cloud }>(
    worker,
    { id: 1, input },
    signal,
    30_000,
  );
  return result.cloud;
}

export async function prepareAIDepth(
  image: { rgba: Uint8ClampedArray; width: number; height: number },
  signal: AbortSignal,
): Promise<NonNullable<SamplingInput["depth"]>> {
  const source = new OffscreenCanvas(image.width, image.height);
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("Depth preparation is unavailable.");
  sourceContext.putImageData(
    new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height),
    0,
    0,
  );

  // The model expects normalized RGB input with dimensions divisible by fourteen.
  const scale = 518 / Math.max(image.width, image.height);
  const width = Math.max(14, Math.round((image.width * scale) / 14) * 14);
  const height = Math.max(14, Math.round((image.height * scale) / 14) * 14);
  const target = new OffscreenCanvas(width, height);
  const targetContext = target.getContext("2d");
  if (!targetContext) throw new Error("Depth preparation is unavailable.");
  targetContext.drawImage(source, 0, 0, width, height);
  const worker = new Worker(new URL("./depth.worker.ts", import.meta.url), {
    type: "module",
  });
  const depth = await runWorker<{
    values: Float32Array;
    width: number;
    height: number;
  }>(
    worker,
    {
      rgba: targetContext.getImageData(0, 0, width, height).data,
      width,
      height,
    },
    signal,
    180_000,
  );
  return { ...depth, source: "ai" };
}

export function createDemoImage(): SamplingInput {
  const canvas = new OffscreenCanvas(512, 512);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  const gradient = context.createLinearGradient(90, 70, 430, 450);
  gradient.addColorStop(0, "#f3dfbb");
  gradient.addColorStop(0.5, "#d3e8e0");
  gradient.addColorStop(1, "#7dada7");
  context.strokeStyle = gradient;
  context.lineWidth = 44;
  context.lineCap = "round";
  context.beginPath();
  context.arc(256, 256, 148, 0.2, Math.PI * 1.8);
  context.stroke();
  context.beginPath();
  context.moveTo(266, 256);
  context.lineTo(398, 256);
  context.lineTo(398, 333);
  context.stroke();
  context.lineWidth = 1;
  for (let index = 0; index < 16; index++) {
    context.beginPath();
    context.ellipse(
      256,
      256,
      190,
      45 + index * 8,
      index * 0.11,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  return {
    name: "Gatherform",
    width: 512,
    height: 512,
    rgba: context.getImageData(0, 0, 512, 512).data,
    pointCount: DEFAULT_POINT_COUNT,
    threshold: 0.04,
  };
}
