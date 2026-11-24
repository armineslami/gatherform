# Reference and feature coverage

Gatherform is an independent implementation inspired by
[Gather Lite by DAO](https://gather.be-of-dao.com/). Gather's branding, graphics,
shader implementation, and source code are not distributed here.

The live Lite interface and its shipped controls were inspected in Chrome on
November 14, 2026. The supplied recording was unavailable at its attached path,
so it has not been reviewed. The full edition is linked from Lite and advertises
music response, camera moves, saving, and 4K recording. Its paid interface was
not accessed. Reference behavior beyond the observed Lite controls is unknown.

| Reference feature             | Gatherform behavior                                                       |
| ----------------------------- | ------------------------------------------------------------------------- |
| Single image as a point cloud | Uploaded images and an original synthetic demo                            |
| Up to four images             | Four common-sized prepared clouds                                         |
| Scatter and gather            | Single-image replay and transitions between images                        |
| Drift, splash, gather, depth  | Adjustable shader motion and transition timing                            |
| Drift line                    | Angle, position, and side controls; no draggable mini-map                 |
| Swarm / melt                  | Broad scatter / ordered transition; not the same correspondence algorithm |
| Drag rotation and scroll zoom | Continuous rotation, optional angle limits, bounded zoom                  |
| Trackers and nearby links     | Sparse CPU overlay attached to prepared image anchors                     |
| Sparse/dense trackers         | 10 or 28 tracked anchors                                                  |
| Scan                          | Moving depth slice brightens particles and increases their size           |
| Trails                        | GPU streaks for up to 16,384 departing grains                             |
| Frame marks                   | Four-sided rulers, corner crosses, image/point labels                     |
| Light button and colors       | Shader light pulse with selectable color                                  |
| White/black paper and tone    | Light/dark background, original/negative/single color                     |
| Keyboard controls             | Space for scatter/next and S for light; disabled while editing controls   |
| Fullscreen                    | Stage fullscreen                                                          |
| AI depth                      | Optional Depth Anything V2 Small in an editor worker                      |
| Music response                | Local audio envelope preview and player audio-level API                   |
| Saving                        | Portable versioned scene export/import                                    |
| Camera motion sequences       | Not implemented                                                           |
| 4K recording                  | Excluded from the interactive-scene workflow                              |

Visual and physical fidelity to Gather has not yet been established. The current
renderer is an initial approximation with its own motion equations. Model-derived
depth and sampling choices also affect the result. An exact visual match requires
side-by-side Chrome review and motion tuning with the user's intended image.

## Depth model attribution

AI depth uses the [ONNX Community conversion of Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small).
The model card identifies Apache-2.0. It is downloaded on request rather than
included in player packages. [ONNX Runtime](https://github.com/microsoft/onnxruntime)
is MIT licensed. Studio's installed dependency retains its license. Redistributing
model weights separately requires retaining the model's license and notices.

## Verification boundary

Unit checks use synthetic pixels and scene data. Builds verify TypeScript and
production output. No private image, live audio, or user project is a test fixture.
The local Studio has been inspected in Chrome with the logo at 524,288 points.
No instrumented CPU, RAM, or frame-rate benchmark has been completed. Visual parity
with the reference is still incomplete.

## Visualization contract

New scenes use 524,288 points with independent particle lifetimes and staggered
scatter/gather timing. Transparent artwork is inflated from its silhouette:
strokes round over about 1/30 of the artwork's size, wide areas keep a flat face,
and steep sides receive proportionally more points so a turned logo stays solid.
Point density follows opacity, so changing colors alone does not change the
shape. Opaque images use brightness relief by default. For exact layer order, import
a depth map with lighter pixels on the parts that should sit closer to the camera.
Existing exports keep their prepared points. Re-add the original image to use the
updated preparation.

Fade canvas edges softens particles and trails on all four sides, even during
pointer movement. Scatter and gather hide frame marks until the artwork settles.
A transparent background lets the page show through the player. Studio's
page color previews that page behind the scene and is not exported.

Rotation uses each prepared cloud's fixed bounds center. The 360-degree limit
permits continuous turns, while smaller saved or overridden limits still apply.
The pointer brush responds to motion and settles afterward. Rotation drags suspend
that brush so the shape does not distort while being turned.

Known fidelity gaps remain in the image-dependent depth field, particle
correspondence between images, tracker attachment during dispersal, full-cloud trail density and color/contrast calibration. The preparation
cutoff applies when preparing images, rather than resampling existing clouds as
the slider moves. It removes those pixels from both point sampling and shape relief. Compare these with the intended artwork before a production
embedding. AI depth completed successfully for the local logo review. It has separate
download and inference costs in Studio.

The shared player uses six short, fading pointer wakes in screen space, with new
scene defaults of strength 1.2 and radius 0.7. The wake follows the screen after
rotation rather than intersecting the image's original plane. Dark-paper grains
use source colors; light-paper grains use their ink colors. Point sizes vary per
grain. Slow, shallow idle sway runs with drift and respects reduced motion.

Grains are firm discs of at least 1.5 device pixels. A smaller grain draws at that
size with ink scaled to its true area, so sub-pixel grains no longer snap between
pixels and flicker as the picture sways. Grains blend without a depth test, so none
pops in or out of view; nearer grains carry more ink, so relief reads head-on. The
player draws at up to 2× screen density by default.

Preparation retains dark opaque pixels by default and interpolates depth between
pixels. AI depth is snapped to the picture's own edges with a guided filter, then
mixed with 35% softened relief (silhouette relief for cutouts, brightness relief
otherwise) to round flat artwork's contours. Steep AI relief receives more points,
as cutout sides do; imported depth maps remain authoritative. These changes require preparing
the source image again. The player increases displayed depth relief for existing
scenes too; authors may lower Depth if their saved scene now looks too deep.

Point sprites scale with camera zoom and stage height, retaining coverage when
zoomed in without increasing the point count or uploading geometry. Sprite size
remains capped at 12 device pixels. Drift holds grains on their source surface
before departure and uses a shared spatial bend with small late turbulence, so
inner contours remain visible as particles leave. These are player changes and
also apply to existing exported geometry.

Grains render in two GPU passes sharing the same prepared buffers and motion
uniforms. The first records depth for visible grain cores; the second draws smooth
alpha edges with source colors. This avoids random pixel noise and stops rear
layers covering solid front cores. Faint edges remain transparent. No particle
sorting or extra point buffers are needed, but the second pass adds GPU work.

Grains use a soft radial falloff and fixed per-grain brightness variation to retain
visible point texture instead of filling every sprite core with opaque color.
The light button follows the player's onLightPulseChange callback; it stays active
only while the pulse is visible, including pulses triggered with S.

Trackers, Trails, Scan and Frame marks have independent playback buttons and
remain available in the Overlays section. Their values stay in scene exports.
Tracking boxes use prepared image anchors at the renderer's depth scale and show
local coordinates. They do not follow scattered grains. Trails use a bounded
16,384-grain sample with the same GPU drift equations as the cloud; line buffers
are prepared on cloud changes, never uploaded per frame. Scan runs through local
depth over an eight-second cycle with a rest between sweeps. Frame marks include
all four sides and drift/image/point readouts.

Compact exports store gzip-compressed local shape, density, color and depth
summaries rather than every particle. It is lossy, retains settings and point count, and rebuilds grains
once on load with cancellation and bounded output. Use full-detail export when
exact prepared positions matter. Disabled trails allocate no sample buffers.

Saved Trails settings initialize only after particle attributes and materials exist.
Startup coverage uses real Three.js geometry with a replaced GPU boundary, including
Trails toggles and all overlays enabled. Export tests cover all 64 overlay combinations
in both formats. Full-detail export preserves exact prepared arrays; compact export
can visibly alter thin lines and fine curves, particularly at close zoom.

Compact surface patches use an 80 × 80 partition with within-patch means, spreads,
correlation and depth slope. Those local summaries preserve thin curves without
spreading particles uniformly over whole cells. Sparse, separate value planes
compress related data together. Reversible neighbor differences reduce storage
without another loss of detail. Decoding validates bounds, ascending patch indices,
coefficients and exact byte lengths before rebuilding the point budget. Earlier
version 2 grids and version 3 surfaces still load. Unchanged patches are retained in
a weak cache so repeated exports do not add another generation of approximation.
The source cloud and its arrays are immutable, as required by the player contract.
Version 5 stores separate surfaces for flat cutouts with distinct dark and light
tones. Keeping both tones within each patch preserves internal edges. The
player still reads version 4 files.

Version 4 adds a separately packed boundary direction and finer distance for each
edge patch. Neighbor density stabilizes edge directions around curves. Direction
and distance share twelve bits; full patches omit the boundary value. Rejection
sampling happens only at load time. New files require the updated player; legacy
surface records retain their original reconstruction and exact re-save behavior.
