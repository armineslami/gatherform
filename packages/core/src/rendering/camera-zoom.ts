/** All zoom controls use the same bounds without changing the rotation or pivot. */
export function advanceZoom(currentZoom: number, factor: number): number {
  if (
    !Number.isFinite(currentZoom) ||
    currentZoom <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0
  )
    throw new Error("Zoom values must be finite and greater than zero.");

  return Math.min(2, Math.max(0.5, currentZoom * factor));
}
