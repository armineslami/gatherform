import { decodeSceneFile } from "./compact.js";
// Scenes contain prepared points so consumer apps never need image decoding or AI.
export const MAX_POINTS = 524_288;
export const MAX_SCENE_BYTES = 40 * 1024 * 1024;

export interface Settings {
  drift: number;
  driftSpread: number;
  /** Drift-only playback multiplier; zero freezes drift and one keeps the authored default. */
  driftSpeed: number;
  splash: number;
  gather: number;
  depth: number;
  pointSize: number;
  density: number;
  opacity: number;
  lineAngle: number;
  lineOffset: number;
  lineSide: number;
  travel: "swarm" | "melt";
  paper: "dark" | "light";
  tone: "original" | "negative" | "mono";
  lightColor: string;
  /** Six-digit hex color, or "transparent" to show the host page in either paper mode. */
  background: string;
  /** Feather points and trails where the canvas meets the page. */
  fadeEdges: boolean;
  /** Camera framing multiplier; above 1 the artwork fills more of the canvas. */
  frameScale: number;
  /** Open the scene as scattered grains that gather after gatherDelay seconds. */
  startScattered: boolean;
  /** Seconds of animation time before a scattered start gathers. */
  gatherDelay: number;
  track: boolean;
  links: boolean;
  scan: boolean;
  trails: boolean;
  marks: boolean;
  dense: boolean;
}

export interface Interactions {
  pointer: boolean;
  pointerStrength: number;
  pointerRadius: number;
  rotate: boolean;
  rotationLimitDegrees: number;
  returnOnRelease: boolean;
  zoom: boolean;
  pan: boolean;
  clickToScatter: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  drift: 0.12,
  driftSpread: 0.75,
  driftSpeed: 1,
  splash: 0.7,
  gather: 0.45,
  depth: 0.65,
  pointSize: 0.85,
  density: 1,
  opacity: 0.85,
  lineAngle: 0.15,
  lineOffset: 0.25,
  lineSide: 1,
  travel: "swarm",
  paper: "dark",
  tone: "original",
  lightColor: "#ffe9c4",
  background: "#090b0d",
  fadeEdges: true,
  frameScale: 1,
  startScattered: false,
  gatherDelay: 1,
  track: true,
  links: true,
  scan: false,
  trails: false,
  marks: true,
  dense: false,
};

export const DEFAULT_INTERACTIONS: Interactions = {
  pointer: true,
  pointerStrength: 1.2,
  pointerRadius: 0.7,
  rotate: true,
  rotationLimitDegrees: 360,
  returnOnRelease: false,
  zoom: true,
  pan: true,
  clickToScatter: false,
};

export interface Cloud {
  name: string;
  /** Depth is an artistic estimate. Positions are in a local frame roughly two units wide. */
  depthSource: "brightness" | "depth-map" | "ai" | "procedural";
  positions: Float32Array;
  colors: Uint8Array;
}

export interface GatherformScene {
  version: 1;
  name: string;
  activeImage: number;
  settings: Settings;
  interactions: Interactions;
  clouds: Cloud[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a scene object.");
  return value as Record<string, unknown>;
}

const bounds: Record<string, [number, number]> = {
  drift: [0, 1],
  driftSpread: [0, 1],
  driftSpeed: [0, 3],
  splash: [0, 1],
  gather: [0, 1],
  depth: [0, 2],
  pointSize: [0.25, 6],
  density: [1, 8],
  frameScale: [0.5, 2],
  gatherDelay: [0, 10],
  opacity: [0, 1],
  lineAngle: [-Math.PI, Math.PI],
  lineOffset: [-1.5, 1.5],
  lineSide: [-1, 1],
  pointerStrength: [0, 2],
  pointerRadius: [0.01, 2],
  rotationLimitDegrees: [0, 360],
};

/** Apply partial overrides and reject values that could break rendering. */
export function validateSettings(value: unknown = {}): Settings {
  return validated(value, DEFAULT_SETTINGS);
}

export function validateInteractions(value: unknown = {}): Interactions {
  return validated(value, DEFAULT_INTERACTIONS);
}

function validated<T extends Settings | Interactions>(
  value: unknown,
  defaults: T,
): T {
  const input = record(value);
  const result = { ...defaults };

  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const field = input[key];
    if (field === undefined) continue;
    const fallback = defaults[key];
    if (typeof field !== typeof fallback) throw new Error(`Invalid ${key}.`);
    if (typeof field === "number") {
      if (key === "density" && !Number.isInteger(field))
        throw new Error("Density must be a whole number.");
      const [minimum, maximum] = bounds[key];
      if (!Number.isFinite(field) || field < minimum || field > maximum)
        throw new Error(`Out of range ${key}.`);
    }
    if (typeof field === "string") {
      const choices: Record<string, string[]> = {
        travel: ["swarm", "melt"],
        paper: ["dark", "light"],
        tone: ["original", "negative", "mono"],
      };
      if (
        choices[key]
          ? !choices[key].includes(field)
          : !(key === "background" && field === "transparent") &&
            !/^#[0-9a-f]{6}$/i.test(field)
      )
        throw new Error(`Invalid ${key}.`);
    }
    // The type and range checks above preserve the public settings shape.
    Object.assign(result, { [key]: field });
  }
  return result;
}

export function validateScene(scene: GatherformScene): void {
  if (
    scene.version !== 1 ||
    typeof scene.name !== "string" ||
    scene.name.length > 200
  )
    throw new Error("Unsupported scene.");
  if (
    !Array.isArray(scene.clouds) ||
    scene.clouds.length < 1 ||
    scene.clouds.length > 4
  )
    throw new Error("A scene needs one to four pictures.");
  if (
    !Number.isInteger(scene.activeImage) ||
    scene.activeImage < 0 ||
    scene.activeImage >= scene.clouds.length
  )
    throw new Error("Invalid active picture.");
  validateSettings(scene.settings);
  validateInteractions(scene.interactions);

  const count = scene.clouds[0].positions.length / 3;
  if (!Number.isInteger(count) || count < 1 || count > MAX_POINTS)
    throw new Error("Invalid point count.");
  for (const cloud of scene.clouds) {
    if (
      typeof cloud.name !== "string" ||
      cloud.name.length > 200 ||
      !["brightness", "depth-map", "ai", "procedural"].includes(
        cloud.depthSource,
      )
    )
      throw new Error("Invalid picture metadata.");
    if (
      !(cloud.positions instanceof Float32Array) ||
      !(cloud.colors instanceof Uint8Array) ||
      cloud.positions.length !== count * 3 ||
      cloud.colors.length !== count * 4
    )
      throw new Error("Pictures must have matching point counts.");
    for (const position of cloud.positions)
      if (!Number.isFinite(position) || Math.abs(position) > 10)
        throw new Error("Invalid point position.");
  }
}

/** One portable file. Little-endian float positions and RGBA bytes, with a versioned JSON header. */
export function encodeScene(scene: GatherformScene): ArrayBuffer {
  validateScene(scene);
  const { clouds, ...metadata } = scene;
  const count = clouds[0].positions.length / 3;
  const header = new TextEncoder().encode(
    JSON.stringify({
      ...metadata,
      count,
      clouds: clouds.map(({ name, depthSource }) => ({ name, depthSource })),
    }),
  );
  const buffer = new ArrayBuffer(
    8 + header.length + count * 16 * clouds.length,
  );
  const view = new DataView(buffer);
  view.setUint32(0, 0x47463031);
  view.setUint32(4, header.length, true);
  new Uint8Array(buffer, 8, header.length).set(header);
  let offset = 8 + header.length;

  for (const cloud of clouds) {
    for (let index = 0; index < count; index++) {
      for (let axis = 0; axis < 3; axis++)
        view.setFloat32(
          offset + axis * 4,
          cloud.positions[index * 3 + axis],
          true,
        );
      new Uint8Array(buffer, offset + 12, 4).set(
        cloud.colors.subarray(index * 4, index * 4 + 4),
      );
      offset += 16;
    }
  }
  return buffer;
}

export function decodeScene(buffer: ArrayBuffer): GatherformScene {
  if (buffer.byteLength < 8 || buffer.byteLength > MAX_SCENE_BYTES)
    throw new Error("Invalid scene size (maximum 40 MB).");
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x47463031)
    throw new Error("This is not a Gatherform scene.");
  const headerLength = view.getUint32(4, true);
  if (headerLength > 65536 || headerLength + 8 > buffer.byteLength)
    throw new Error("Invalid scene header.");
  const metadata = record(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(buffer, 8, headerLength),
      ),
    ),
  );
  const count = metadata.count;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_POINTS
  )
    throw new Error("Invalid point count.");
  const images = metadata.clouds;
  if (
    !Array.isArray(images) ||
    images.length < 1 ||
    images.length > 4 ||
    buffer.byteLength !== 8 + headerLength + count * 16 * images.length
  )
    throw new Error("Truncated or invalid scene.");
  if (
    metadata.version !== 1 ||
    typeof metadata.name !== "string" ||
    typeof metadata.activeImage !== "number"
  )
    throw new Error("Unsupported scene metadata.");
  let offset = 8 + headerLength;
  const clouds: Cloud[] = images.map((image: unknown) => {
    const data = record(image);
    if (
      typeof data.name !== "string" ||
      !["brightness", "depth-map", "ai", "procedural"].includes(
        String(data.depthSource),
      )
    )
      throw new Error("Invalid picture metadata.");
    const positions = new Float32Array(count * 3);
    const colors = new Uint8Array(count * 4);
    for (let index = 0; index < count; index++) {
      for (let axis = 0; axis < 3; axis++)
        positions[index * 3 + axis] = view.getFloat32(offset + axis * 4, true);
      colors.set(new Uint8Array(buffer, offset + 12, 4), index * 4);
      offset += 16;
    }
    return {
      name: data.name,
      depthSource: data.depthSource as Cloud["depthSource"],
      positions,
      colors,
    };
  });
  const scene: GatherformScene = {
    version: 1,
    name: metadata.name,
    activeImage: metadata.activeImage,
    settings: validateSettings(metadata.settings),
    interactions: validateInteractions(metadata.interactions),
    clouds,
  };
  validateScene(scene);
  return scene;
}

const preloadedScenes = new Map<string, Promise<GatherformScene>>();

/**
 * Start downloading and decoding a scene before any player asks for it, for
 * example at module load or on route hover. The next successful loadScene(src)
 * uses the result and releases it; a failed preload falls back to a new request.
 */
export function preloadScene(src: string): void {
  if (preloadedScenes.has(src)) return;

  const pending = fetchScene(src);
  preloadedScenes.set(src, pending);
  pending.catch(() => {
    if (preloadedScenes.get(src) === pending) preloadedScenes.delete(src);
  });
}

/** Load a scene, reusing a matching preloadScene request when one exists. */
export async function loadScene(
  src: string,
  signal?: AbortSignal,
): Promise<GatherformScene> {
  signal?.throwIfAborted();
  const preloaded = preloadedScenes.get(src);
  if (preloaded) {
    try {
      const scene = await abortable(preloaded, signal);
      // Keep the entry for a remount after an aborted wait, as in React Strict Mode.
      preloadedScenes.delete(src);
      return scene;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return fetchScene(src, signal);
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Bound streamed downloads before allocating the complete scene. */
async function fetchScene(
  src: string,
  signal?: AbortSignal,
): Promise<GatherformScene> {
  const deadline = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const response = await fetch(src, { signal: requestSignal });
  if (!response.ok)
    throw new Error(`Scene request failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > MAX_SCENE_BYTES)
    throw new Error("Scene exceeds 40 MB.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Scene response has no body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SCENE_BYTES) throw new Error("Scene exceeds 40 MB.");
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
  return decodeSceneFile(bytes.buffer, requestSignal);
}
