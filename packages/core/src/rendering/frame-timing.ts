/** Keep a steady frame schedule without treating small display-clock jitter as a missed frame. */
export function nextFrameDeadline(
  milliseconds: number,
  deadlineMilliseconds: number,
  maxFps: 30 | 60,
): number | null {
  const intervalMilliseconds = 1000 / maxFps;
  if (
    deadlineMilliseconds > 0 &&
    milliseconds < deadlineMilliseconds - intervalMilliseconds * 0.2
  )
    return null;

  // A long stall starts a fresh schedule instead of requesting a burst of catch-up frames.
  return deadlineMilliseconds === 0 ||
    milliseconds - deadlineMilliseconds > intervalMilliseconds
    ? milliseconds + intervalMilliseconds
    : deadlineMilliseconds + intervalMilliseconds;
}
