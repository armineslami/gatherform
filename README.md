# Gatherform

**Turn an image into an interactive particle visualization. Design it in Studio, export a scene, and play it in your own app.**

[Try Studio](https://armineslami.github.io/gatherform/) · [React player](packages/react/README.md) · [Core API](packages/core/README.md) · [Performance](docs/performance.md) · [MIT license](LICENSE)

![Gatherform Studio with its built-in particle demo](docs/media/studio.png)

Gatherform is a browser-based editor and a reusable WebGL player. It turns logos,
illustrations and photos into point clouds that visitors can rotate, zoom, pan,
scatter and gather. Pointer movement disturbs the particles; optional trails,
trackers, frame marks and scan effects add movement and detail.

Exported scenes remain interactive. They are data files, not videos, and do not
need Studio running in the background.

## Try Studio

Open **[the hosted Studio](https://armineslami.github.io/gatherform/)** and choose
**Load demo** to try it immediately, or upload your own image. Image preparation
runs on your device. There is no account, backend or API key.

To run it locally, install **Node.js 24 or newer** and the pnpm version pinned in
`package.json`, then:

```sh
git clone https://github.com/armineslami/gatherform.git
cd gatherform
pnpm install
pnpm dev
```

Open the address printed by Vite, normally `http://127.0.0.1:5173/`.
To test from a phone or another computer on the same network, run:

```sh
pnpm --filter @armin-eslami/gatherform-studio dev --host 0.0.0.0
```

Open the network address Vite prints on that device. Both devices must be on the
same network, and your firewall must allow the connection.

## Design → export → embed

1. Load the demo or add up to four images. Transparent image backgrounds work well for logos.
2. Adjust depth, point size, opacity, drift, spread, speed and optional overlays.
3. Choose the interactions visitors can use: pointer response, rotation, zoom, pan and click-to-scatter.
4. Select **Export scene**. Choose compact or full detail, and copy a React example.
5. Put the `.gatherform` file in your app’s `public/visualizations/` directory.
6. Render it with the player. Reopen an exported scene in Studio to edit its saved settings.

English and Persian interfaces are included, with a mobile layout and zoom buttons.
Shift + drag pans when rotation and pan are both enabled. Export your work before
closing Studio: original image files and audio tracks are not included in scenes.
Keep the originals if you want to regenerate depth later.

## Use in a React or Next.js app

There are two player packages:

| Package                          | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `@armin-eslami/gatherform-react` | The `<Gatherform />` component and React lifecycle management.     |
| `@armin-eslami/gatherform-core`  | The framework-independent renderer, scene loader and public types. |

**React users install one Gatherform package.** The React package automatically
installs core; `three` is a peer dependency. Studio is a separate application in
this repository and is not bundled into either player package.

The package names are assigned under the maintainer’s npm account, but **registry
publication is still pending**. Until then, use the local-package instructions
below. After publication, the registry install command will be:

```sh
pnpm add @armin-eslami/gatherform-react three
```

```tsx
"use client";

import { Gatherform } from "@armin-eslami/gatherform-react";

export function Logo() {
  return (
    <Gatherform
      src="/visualizations/logo.gatherform"
      style={{ height: 480 }}
      label="Interactive logo"
      maxFps={30}
      maxPixelRatio={1}
      interactions={{ pointer: true, rotate: true, zoom: true, pan: true }}
      onError={(error) => console.error(error.message)}
    />
  );
}
```

The scene supplies appearance and interaction defaults. Partial `settings` and
`interactions` props override only the fields you provide. Give the component a
nonzero height. Use `src` for a scene file or `scene` for an already decoded scene,
not both. Next.js applications import it from a client component.

### Scatter, gather, looping and audio

Studio’s export dialog includes three complete, copyable examples:

- **Basic player:** render the scene with your chosen interactions and FPS.
- **Scatter, gather and loop:** buttons plus a cycle alternating every three seconds.
- **Audio response and controls:** the same controls plus a separate audio track that drives particle movement.

A React ref exposes `scatter()`, `gather()`, `next()`, `transitionTo(index)`,
`light()`, `resetCamera()`, `zoomBy(factor)` and `setAudioLevel(level)`.
Use those methods from your own buttons, page events or animation schedule.
The loop example owns and cleans up its timer; there is no built-in `loop` prop.

Audio makes the particles react to a track’s intensity. The scene does not contain
music or a recorded animation. In the copied audio example, replace
`/audio/track.mp3` with your own separately hosted track. Playback begins when the
visitor presses Play. Existing audio systems can send a normalized 0–1 signal
through `setAudioLevel()` without causing a React render for every update.
See [the React guide](packages/react/README.md) for the contracts and cleanup behavior.

### Use without React

After registry publication, install core and Three.js:

```sh
pnpm add @armin-eslami/gatherform-core three
```

```ts
import { GatherformPlayer, loadScene } from "@armin-eslami/gatherform-core";

const scene = await loadScene("/visualizations/logo.gatherform");
const player = new GatherformPlayer(
  document.querySelector("#visualization")!,
  scene,
  {
    maxFps: 30,
    maxPixelRatio: 1,
  },
);

// The host element needs a nonzero width and height.
player.scatter();
player.gather();

// Call when removing the visualization.
player.dispose();
```

### Install the unpublished packages locally

Build and pack them from this repository:

```sh
pnpm check
pnpm pack:player
```

In the consuming app’s `pnpm-workspace.yaml`, merge this override with any existing ones:

```yaml
overrides:
  "@armin-eslami/gatherform-core": "file:/absolute/path/gatherform/release/armin-eslami-gatherform-core-0.1.0.tgz"
```

Then install the local packages and the peer dependency:

```sh
pnpm add /absolute/path/gatherform/release/armin-eslami-gatherform-core-0.1.0.tgz \
  /absolute/path/gatherform/release/armin-eslami-gatherform-react-0.1.0.tgz three
```

Remove the local override when switching to published registry versions.

## How it works

Studio samples image pixels into prepared point positions and colors. Brightness
produces artistic depth by default. A grayscale depth map can replace that depth;
optional AI depth estimates which parts are nearer or farther away. AI runs in a
worker after downloading its model. It is not measured 3D geometry, and flat logos
may show only a subtle change from the front. Images stay on your device.

Full-detail scenes preserve the prepared point arrays. Compact scenes store local
shape, density, color, depth and edge summaries, then rebuild the authored point
count once on load. The player animates those points on the GPU rather than
updating every point in JavaScript on every frame.

![Gatherform particle depth, curved surfaces and drifting edges](docs/media/showcase.png)

**Compact is lossy.** Fine curves, grains and depth can differ, especially when
zoomed in. The 524,288-point demo measured **22,590 bytes** with refined compact
edges; this is an example, not a size guarantee. Re-export from the original
full-detail scene to benefit from improved compression; discarded detail cannot
be recovered from an older compact file. The updated player loads compact versions
2, 3 and 4, and full-detail version 1.

### Performance and device limits

A smaller download does not mean smaller decoded point buffers. At 524,288 points,
positions and colors take about 8 MiB per image; seeds, trails, canvas buffers,
Three.js and GPU resources add more. The two cloud passes draw each point twice.

For older or mobile devices, start with **65,536 points, 30 FPS, pixel ratio 1,
and trails off**. These are suggested budgets, not a guarantee of quiet fans or
smoothness on every device. Both Studio and the embedded player use the same
renderer. Hidden/offscreen players suspend drawing; reduced-motion preferences
are respected. See [measured sizes and memory accounting](docs/performance.md).

WebGL2 is required. Standalone-player integration and device profiling in your own
app remain necessary. Optional AI dependencies and model downloads are Studio-only.
The player packages do not contain image decoding, ONNX or AI model weights.

## Deploy Studio with GitHub Pages

The repository includes a GitHub Actions workflow that builds Studio and deploys
it to GitHub Pages on pushes to `main`, or when run manually. The site is served at:

**https://armineslami.github.io/gatherform/**

Pages uses **GitHub Actions** as its build source. No npm publishing happens in
this workflow. You can also deploy `apps/studio/dist` to another static HTTPS host
with correct WebAssembly MIME types and permission for workers/model downloads.

## Development

```sh
pnpm check          # Type checks, regression tests and production builds
pnpm pack:player    # Build local npm tarballs; does not publish
```

| Directory                     | Responsibility                                             |
| ----------------------------- | ---------------------------------------------------------- |
| `apps/studio/src/editor`      | Authoring, cancellation and generated app examples         |
| `apps/studio/src/preparation` | Image sampling, depth processing and workers               |
| `apps/studio/src/components`  | Studio controls and audio preview                          |
| `packages/core/src/scene`     | Scene contracts, validation and file codecs                |
| `packages/core/src/rendering` | GPU player, shaders, camera and trail helpers              |
| `packages/react/src`          | React component and lifecycle                              |
| `tests`                       | Scene, sampling, playback and exported-example regressions |

Studio v0.1’s authoring scope is feature-complete. It is an early release: visual
fidelity is approximate and standalone integration testing remains a separate
release step. [Feature details and reference comparison](docs/features.md).

## License and credits

Gatherform’s source code and built-in demo are released under the **[MIT license](LICENSE)**.
You may use, modify and redistribute them in personal or commercial projects,
keeping the license notice. Your uploaded images and audio remain yours.
Third-party dependencies and optional AI models retain their own licenses.

Inspired by [Gather Lite by DAO](https://gather.be-of-dao.com/). Gatherform is an
independent implementation; the reference site’s branding, source code and artwork
are not included. See the [feature guide](docs/features.md) for attribution and limits.
