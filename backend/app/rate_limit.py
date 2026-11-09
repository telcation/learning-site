"""Process-local token buckets. No address, credential or timing persistence."""
import hashlib
import hmac
import math
import os
from threading import Lock
from time import monotonic


class RateLimiter:
    # capacity, tokens per second; matching core/rate-limits.json.
    policies = {'credential': (20, 2), 'bootstrap_ip': (60, 10 / 60),
                'bootstrap_global': (120, 30 / 60)}

    def __init__(self, clock=None, max_buckets=10000):
        self.clock = clock or monotonic
        self.max_buckets = max_buckets
        self._salt = os.urandom(32)
        self._buckets = {}
        self._lock = Lock()
        self._last_cleanup = self.clock()

    def key(self, scope, value):
        return scope, hmac.new(self._salt, (scope + '\0' + value).encode(), hashlib.sha256).digest()

    def check(self, subjects):
        """Return Retry-After seconds, or zero after atomically charging all buckets."""
        keys = {self.key(scope, value) for scope, value in subjects}
        with self._lock:
            now = self.clock()
            if now - self._last_cleanup >= 60:
                # Ten minutes exceeds the slowest full-refill time (six minutes).
                self._buckets = {k: v for k, v in self._buckets.items() if now - v[1] < 600}
                self._last_cleanup = now
            missing = keys - self._buckets.keys()
            if len(self._buckets) + len(missing) > self.max_buckets:
                # Do not evict depleted buckets to make limits bypassable.
                return 60
            retry = 0
            for key in keys:
                capacity, refill = self.policies[key[0]]
                tokens, previous = self._buckets.get(key, (capacity, now))
                available = min(capacity, tokens + max(0, now - previous) * refill)
                self._buckets[key] = (available, now)
                if available < 1:
                    retry = max(retry, max(1, math.ceil((1 - available) / refill)))
            if retry:
                return retry
            for key in keys:
                tokens, _ = self._buckets[key]
                self._buckets[key] = (tokens - 1, now)
            return 0
