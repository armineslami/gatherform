# @armin-eslami/gatherform-core

A Three.js player and versioned scene codec for Gatherform's interactive image
point clouds. Image decoding and AI processing belong to the separate Studio app.

```ts
import { GatherformPlayer, loadScene } from "@armin-eslami/gatherform-core";

const scene = await loadScene("/logo.gatherform");
const player = new GatherformPlayer(container, scene, {
  maxFps: 30,
  maxPixelRatio: 1.5,
  interactions: { pointer: true, rotate: false, zoom: false },
});

// On removal of the host element:
player.dispose();
```

The host needs a nonzero size and position: relative. WebGL2 is required.
Public exports include scene types, defaults, validation, encodeScene, decodeScene,
loadScene, and GatherformPlayer. Inputs are validated and downloads are bounded.

The package is ESM and requires the declared Three.js peer. All coordinates are
artistic local units. Scenes contain no model weights or executable code.
Released under the MIT license. Third-party dependencies retain their own licenses.

Compact scenes use `encodeCompactScene(scene)` and `await decodeSceneFile(bytes)`.
`loadScene` loads both compact and full-detail files. Compact version 4 stores local density, curve direction, color and depth slope,
plus finer edge directions and limits, then rebuilds points on load. It remains lossy. Legacy version 2 and 3 compact files
continue to load; earlier players need updating for version 4. Decoded particle memory is unchanged. `decodeScene` accepts full-detail files
only. The original full-detail encoder and public package entry remain compatible.

New scenes enable pan (Shift + drag) by default. Saved interaction choices remain unchanged.
Compact edge limits constrain reconstructed points to their source patches and reduce stray edge points; older files remain readable.
