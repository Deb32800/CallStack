// Simple 8am-9pm local-time window (§3.4) — enough for a hackathon bar, not
// a real timezone-aware business-hours lookup.
const OPEN_HOUR = 8;
const CLOSE_HOUR = 21;

export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}
