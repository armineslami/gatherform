// Keep original pixels only in the editor so depth can be rebuilt without enlarging exports.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_INTERACTIONS,
  DEFAULT_SETTINGS,
  MAX_SCENE_BYTES,
  decodeSceneFile,
  type Cloud,
  type GatherformScene,
} from "@armin-eslami/gatherform-core";
import {
  createDemoImage,
  prepareAIDepth,
  prepareImage,
  readImage,
} from "@/preparation/prepare-image";
import type { SamplingInput } from "@/preparation/image-sampling";

import { DEFAULT_POINT_COUNT } from "@/config/editor";

type SourceImage = Awaited<ReturnType<typeof readImage>>;

export function useSceneEditor() {
  // ---------------------------------------------------------
  // State and refs
  // ---------------------------------------------------------

  const [scene, setScene] = useState<GatherformScene | null>(null);

  const [busy, setBusy] = useState<"image" | "depth" | null>(null);

  const [pointCount, setPointCount] = useState(DEFAULT_POINT_COUNT);

  const [threshold, setThreshold] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);

  // Exported scenes omit original pixels; only this editor map can rebuild their depth.
  const sourcesRef = useRef(new Map<Cloud, SourceImage>());

  const currentSceneRef = useRef(scene);

  const mountedRef = useRef(true);

  // ---------------------------------------------------------
  // Actions
  // ---------------------------------------------------------

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(null);
  }, []);

  const beginPreparation = (kind: "image" | "depth") => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(kind);
    return controller;
  };

  const addImages = async (files: File[]) => {
    const previous = currentSceneRef.current;
    if (files.length + (previous?.clouds.length ?? 0) > 4)
      throw new Error("A scene can contain up to four images.");
    const controller = beginPreparation("image");
    const count = previous
      ? previous.clouds[0].positions.length / 3
      : pointCount;
    const added: Cloud[] = [];
    const preparedSources = new Map<Cloud, SourceImage>();

    try {
      for (const file of files) {
        const source = await readImage(file);
        if (controller.signal.aborted) return;
        const cloud = await prepareImage(
          { ...source, name: file.name, pointCount: count, threshold },
          controller.signal,
        );
        added.push(cloud);
        preparedSources.set(cloud, source);
      }
      if (controller.signal.aborted || !mountedRef.current || !added.length)
        return;

      for (const [cloud, source] of preparedSources)
        sourcesRef.current.set(cloud, source);
      setScene({
        version: 1,
        name: previous?.name ?? "Untitled scene",
        activeImage: previous?.clouds.length ?? 0,
        settings: previous?.settings ?? { ...DEFAULT_SETTINGS },
        interactions: previous?.interactions ?? { ...DEFAULT_INTERACTIONS },
        clouds: [...(previous?.clouds ?? []), ...added],
      });
    } finally {
      // A cancelled job must not clear the busy state of a newer job.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current) setBusy(null);
      }
    }
  };

  const loadDemo = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setBusy("image");
    try {
      const input = createDemoImage();
      const cloud = await prepareImage(input, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      sourcesRef.current.clear();
      sourcesRef.current.set(cloud, input);
      setScene({
        version: 1,
        name: "Gatherform study",
        activeImage: 0,
        settings: { ...DEFAULT_SETTINGS },
        interactions: { ...DEFAULT_INTERACTIONS },
        clouds: [cloud],
      });
    } finally {
      // A cancelled job must not clear the busy state of a newer job.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current) setBusy(null);
      }
    }
  }, []);

  const updateDepth = async (depthFile?: File) => {
    const previous = currentSceneRef.current;
    if (!previous) return;
    const previousCloud = previous.clouds[previous.activeImage];
    const source = sourcesRef.current.get(previousCloud);
    if (!source)
      throw new Error("Re-add the original image before generating depth.");
    const controller = beginPreparation("depth");
    try {
      let depth: NonNullable<SamplingInput["depth"]>;
      if (depthFile) {
        const image = await readImage(depthFile);
        const values = new Float32Array(image.width * image.height);
        for (let index = 0; index < values.length; index++)
          values[index] = image.rgba[index * 4] / 255;
        depth = {
          values,
          width: image.width,
          height: image.height,
          source: "depth-map",
        };
      } else {
        depth = await prepareAIDepth(source, controller.signal);
      }
      if (controller.signal.aborted) return;
      const cloud = await prepareImage(
        {
          ...source,
          name: previousCloud.name,
          pointCount: previousCloud.positions.length / 3,
          threshold,
          depth,
        },
        controller.signal,
      );
      if (controller.signal.aborted || !mountedRef.current) return;

      sourcesRef.current.delete(previousCloud);
      sourcesRef.current.set(cloud, source);
      setScene({
        ...previous,
        clouds: previous.clouds.map((item) =>
          item === previousCloud ? cloud : item,
        ),
      });
    } finally {
      // A cancelled job must not clear the busy state of a newer job.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current) setBusy(null);
      }
    }
  };

  const openScene = async (file: File) => {
    if (file.size > MAX_SCENE_BYTES) throw new Error("Scene exceeds 40 MB.");
    const controller = beginPreparation("image");
    try {
      const next = await decodeSceneFile(
        await file.arrayBuffer(),
        controller.signal,
      );
      if (controller.signal.aborted || !mountedRef.current) return;
      sourcesRef.current.clear();
      setScene(next);
    } finally {
      // A cancelled job must not clear the busy state of a newer job.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current) setBusy(null);
      }
    }
  };

  const removeImage = (imageIndex: number) => {
    if (!scene) return;
    sourcesRef.current.delete(scene.clouds[imageIndex]);
    const clouds = scene.clouds.filter((_, index) => index !== imageIndex);
    setScene(
      clouds.length
        ? {
            ...scene,
            clouds,
            activeImage: Math.min(scene.activeImage, clouds.length - 1),
          }
        : null,
    );
  };

  const newScene = () => {
    cancel();
    sourcesRef.current.clear();
    setScene(null);
  };

  // ---------------------------------------------------------
  // Effects
  // ---------------------------------------------------------

  useEffect(() => {
    currentSceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      sourcesRef.current.clear();
    };
  }, []);

  return {
    scene,
    setScene,
    busy,
    pointCount,
    setPointCount,
    threshold,
    setThreshold,
    addImages,
    loadDemo,
    updateDepth,
    openScene,
    removeImage,
    newScene,
    cancel,
  };
}
