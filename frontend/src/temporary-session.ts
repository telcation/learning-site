export const IDLE_LIMIT_MS = 60 * 60 * 1000;

// Check before resetting the deadline: the first click after a long sleep must
// end the session, rather than revive an expired credential.
export class TemporarySession {
  private lastActivity: number;
  private ended = false;
  private onEnd: () => void;
  private now: () => number;
  constructor(onEnd: () => void, now = Date.now) {
    this.onEnd = onEnd;
    this.now = now;
    this.lastActivity = now();
  }
  check() {
    if (!this.ended && this.now() - this.lastActivity >= IDLE_LIMIT_MS) this.end();
    return !this.ended;
  }
  touch() {
    if (this.check()) this.lastActivity = this.now();
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    this.onEnd();
  }
}
