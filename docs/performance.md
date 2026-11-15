# Performance and size

## Earlier version 2 measurements

Local measurements on November 14, 2026, using the saved logo review scene:

| Artifact                          |     Bytes | Notes                                     |
| --------------------------------- | --------: | ----------------------------------------- |
| Full-detail logo                  | 8,389,273 | 524,288 exact prepared points             |
| Compact logo                      |    12,166 | Same point count, lossy 128 × 128 surface |
| Browser re-export of compact logo |    12,416 | Chrome export verified                    |
| Player JavaScript, gzip           |    11,689 | Excludes shared React and Three.js        |
| Player plus Three.js, gzip        |   151,107 | Excludes shared React                     |

Player sizes use a minified Vite library build of the React entry. These are
transfer sizes, not npm tarball sizes. Editor, AI and source maps are excluded.
A logo can fit 10–15 KB; photos, fine depth and multiple images are not guaranteed
to fit. Compact compression changes the prepared surface, so keep full-detail
exports when exact points matter. Existing full-detail files still load.

## Version 3 compact comparison

On November 15, the same 524,288-point demo and saved appearance settings measured
19,902 bytes in the improved format versus 22,643 bytes in the prior compact file.
A local Node run measured about 35 ms encoding and 106 ms decoding. Front and
rotated Chrome comparisons showed much closer thin curves and depth, while exact
full-detail equivalence is not claimed. Sizes depend on image complexity.

Version 3 adds local density, direction and depth slope, stored as separate sparse
value planes. Unchanged encoded patches stay with the decoded cloud in a weak
cache (roughly 35 KiB for this demo), preventing cumulative loss on repeated saves.
Prepared point buffers and per-frame GPU work do not change. Old version 2 compact
files load through the legacy decoder; they cannot regain discarded source detail.

## CPU and graphics work

Compact reconstruction took about 107 ms elapsed and 55 ms CPU in one local Node
run, including pauses between batches of 8,192 points. This is not a mobile or
browser timing guarantee. It runs once per load, with cancellation between batches.
Point animation runs on the graphics card, with no per-frame point-array uploads.
Two point passes handle depth and color. Trails add a bounded third draw.

Frame rate defaults to 60 and can be limited to 30. Screen density defaults to a
1.5 maximum pixel ratio. Hidden/offscreen views suspend drawing; idle scenes stop
continuous animation. Overlays update at most 15 times per second. GPU fill rate
and point count still matter: GPU animation does not mean zero CPU or RAM usage.

## Memory accounting

| One image      | Prepared CPU arrays |    Seeds | Approximate GPU point buffers |
| -------------- | ------------------: | -------: | ----------------------------: |
| 65,536 points  |               1 MiB | 0.25 MiB |                      1.25 MiB |
| 524,288 points |               8 MiB |    2 MiB |                        10 MiB |

These are array budgets, not measured total process memory. The browser, React,
Three.js, canvas buffers, overlays, driver allocations, and temporary loading data
add memory. Each extra image retains more prepared arrays. Source and target GPU
attributes share buffers for a single image; transitions can require both.
Enabled trails add up to 2 MiB of CPU arrays and roughly 2 MiB of GPU buffers.
Disabled trails release those buffers. Disposal releases display resources and
cancels outstanding loads. Compact export reduces download size, not decoded RAM.

For a lighter embedding, start with 65,536 points, 30 FPS, pixel ratio 1 and trails
off. Compare visually on target devices before increasing density. Sustained
browser CPU/GPU use, total RAM and mobile frame rates have not been profiled.

## Frame cadence and inactive effects

The frame limiter follows a continuing deadline, allowing small display-clock
variation without discarding alternate 60 Hz frames. Long stalls start a new
schedule; hidden views reset elapsed timing. Synthetic tests cover jittery 60 Hz,
120 Hz displays with 60/30 FPS limits, and recovery after a stall. These tests do
not measure an actual device's frame rate.

Idle pointer wakes skip their distance/exponential calculations in the particle
shader. Inactive light pulses, scan bands, and completed transitions skip their
extra calculations as well. Drift direction is calculated once in JavaScript
rather than using sine/cosine for every grain. Grain density, drift shape, trails,
depth occlusion and interaction settings remain available at their authored values.
Overlay anchors are not projected when both trackers and links are disabled.

For an older-device comparison, reopen the same scene after refreshing Studio.
Keep the browser window size, point count, zoom, overlays and power conditions
equal. Compare drift with the pointer still, then pointer movement and trails,
for at least a minute each. GPU memory is allocated storage, not GPU utilization.
Standalone playback uses the same renderer but excludes the editor and AI worker;
its lower editor overhead does not guarantee a faster graphics-bound animation.
These changes still need a repeat measurement on the 2013 MacBook Air.

Compact edge limits use the reserved low four bits of the depth plane. The demo with these limits measures 20,297 bytes (about 0.4 KB above the earlier 19,902-byte surface). Sampling rejects points outside a patch or beyond its recorded edge during import only; playback work and point buffers are unchanged. This remains an approximation, especially at high zoom.

The refined version 4 demo measures 22,590 bytes versus 20,297 bytes with coarse
edge limits. It keeps 524,288 points and the same rendering work. Boundary
direction and distance share twelve bits; bounds are checked during import.
The circular-boundary regression limits outward error to 0.00075 local units
(previous tolerance 0.003). This synthetic test does not guarantee exact edges
for arbitrary images, and no new old-device thermal measurement was performed.
