# Gatherform repository instructions

Gatherform is independent of Nosaz. Follow the same clear naming, formatting,
comments, validation, and package boundaries used in Nosaz's AGENTS.md.

## Scope before editing

Read README.md, the owning package.json, nearby code, and any nearer AGENTS.md.
Inspect the working tree and preserve existing user changes. Identify the callers,
public exports, scene compatibility, tests, configuration, and guides affected by a
change. Never commit, push, publish, or deploy without the user's request.

## Smallest complete change

Reuse existing code, platform features, and installed dependencies in that order.
Do not add speculative options, wrappers, abstractions, migrations, or unrelated
cleanup. Fix the shared cause after searching all callers. Preserve validation,
error handling, accessibility, and cancellation. New non-trivial logic needs a
small regression test or an assert-based check.

## Code style

- Use TypeScript, double quotes, semicolons, two spaces, and the local Prettier config.
- Use descriptive names and explicit units, such as elapsedSeconds and maxPixelRatio.
- Separate validation, derived values, work, state changes, and return values with
  meaningful blank lines. Keep individual hooks and class members easy to scan.
- Use the existing section convention when it helps organize a component or service.

```typescript
// ---------------------------------------------------------
// Effects
// ---------------------------------------------------------
```

- Group React imports/types, hooks, state/refs, derived values, actions, effects,
  and render. Keep hooks unconditional and dependencies accurate.
- Comments explain a reason or invariant in plain language. Do not narrate obvious code.
- Document public contracts, coordinate units, and important assumptions concisely.
- Known shortcuts use `shortcut: <limit>, <when to upgrade>`.
- Do not use any, ignored type errors, blanket lint suppression, or casts that hide
  unresolved contracts.
- Studio internals use @/ imports. Packages consume each other's public entry points.
  ESM package internals use runtime-resolvable .js imports.
- Feature logic belongs in its owning module. Reusable controls belong in components.
  This independent repository has no dependency on Nosaz's UI or backend packages.

## Packages and scenes

- apps/studio owns files, authoring controls, depth preparation, and audio preview.
- packages/core owns the prepared scene contract, codec, and imperative GPU player.
- packages/react owns the React lifecycle and the public component.
- Never put React, ONNX, model downloads, image decoding, or authoring dependencies
  in the core renderer. Never put Studio code in published player packages.
- Use pnpm and maintain pnpm-lock.yaml. Check installed declarations for APIs whose
  versions matter. Use current stable releases when asked, without incidental upgrades.
- Validate scene headers, byte lengths, counts, settings, and finite coordinates.
  Preserve detached buffers and explicit depth provenance. Brightness depth is an
  artistic fallback, never measured geometry.
- Changing the scene format requires a version and compatibility checks. Old saved
  scenes must either continue to load or fail with a clear supported-version error.
- Preserve use client in the React package, declarations, peer dependencies, package
  exports, workspace publication rewriting, and files whitelists.

## Performance and cleanup

- Animate points in shaders. Avoid per-point CPU work, React renders, allocations,
  and buffer uploads on each frame.
- Reuse scratch objects. Bound frame rate, screen density, point counts, file sizes,
  preparation time, and streamed scene downloads.
- Stop drawing for hidden/offscreen views and idle scenes. Respect reduced motion.
- Cancel stale loads and workers before publishing results. Dispose GPU resources,
  observers, event listeners, workers, audio contexts, and object URLs.
- Settings changes preserve the current camera and geometry. Only geometry changes
  replace the player. Do not add a heavy CPU fallback when WebGL fails.
- Separate theoretical memory budgets from measured CPU, GPU, RAM, or download results.

## UI and delivery

Keep English and Persian UI labels synchronized in apps/studio/src/i18n/locales.ts. Preserve RTL,
plain Persian spelling, keyboard navigation, visible focus, labels, and error feedback.
Use accessible native controls and the existing shared control components.

Run pnpm check for code changes and pnpm pack:player for publication changes.
Run targeted regressions before broader checks. Format touched files only. Do not
weaken assertions or hide failures. Update the owning README with behavior or API changes.

The user wants to start the local server themselves. When checks pass, provide
terminal commands and wait for their confirmation before Chrome preview testing.

Finish with the concrete outcome, checks, and any remaining limits. End with one
or two lines saying what was skipped or not checked and any material risk.
