/** A 360-degree limit allows repeated full turns. Smaller limits stay symmetric around the front. */
export function advanceRotationAngle(
  angle: number,
  delta: number,
  limitDegrees: number,
): number {
  const next = angle + delta;
  if (limitDegrees === 360) return next;

  const limit = (limitDegrees * Math.PI) / 180;
  return Math.max(-limit, Math.min(limit, next));
}
