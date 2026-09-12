/** The current time in milliseconds. Read in effects and handlers, never during render. */
export function currentTime(): number {
  return Date.now();
}
