/// <reference lib="webworker" />

import { sampleImage, type SamplingInput } from "@/preparation/image-sampling";

self.onmessage = (
  event: MessageEvent<{ id: number; input: SamplingInput }>,
) => {
  try {
    const cloud = sampleImage(event.data.input);
    self.postMessage(
      { id: event.data.id, cloud },
      { transfer: [cloud.positions.buffer, cloud.colors.buffer] },
    );
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
