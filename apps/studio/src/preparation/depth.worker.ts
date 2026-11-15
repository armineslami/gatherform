/// <reference lib="webworker" />
// AI stays in this editor worker so model downloads and inference never enter the player.

import * as ort from "onnxruntime-web";

// Model loading happens only after the author asks for AI depth.
ort.env.wasm.numThreads = 1;

let session: Promise<ort.InferenceSession> | null = null;

self.onmessage = async (
  event: MessageEvent<{
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
  }>,
) => {
  try {
    const { rgba, width, height } = event.data;
    const length = width * height;
    if (
      width < 1 ||
      height < 1 ||
      length > 518 * 518 ||
      rgba.length !== length * 4
    )
      throw new Error("Invalid depth input.");

    session ??= ort.InferenceSession.create(
      "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx",
      { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
    );
    const model = await session;
    const tensor = new Float32Array(length * 3);
    const means = [0.485, 0.456, 0.406];
    const deviations = [0.229, 0.224, 0.225];
    for (let channel = 0; channel < 3; channel++) {
      for (let index = 0; index < length; index++)
        tensor[channel * length + index] =
          (rgba[index * 4 + channel] / 255 - means[channel]) /
          deviations[channel];
    }
    const result = await model.run({
      [model.inputNames[0]]: new ort.Tensor("float32", tensor, [
        1,
        3,
        height,
        width,
      ]),
    });
    const output = result[model.outputNames[0]];
    if (!(output.data instanceof Float32Array))
      throw new Error("Unsupported model output.");

    const values = new Float32Array(output.data);
    self.postMessage(
      { values, width: output.dims.at(-1), height: output.dims.at(-2) },
      { transfer: [values.buffer] },
    );
  } catch (error) {
    session = null;
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
