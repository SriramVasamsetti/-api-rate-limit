/**
 * Fixed Window Rate Limiter
 * Tracks request count per client within a fixed time window
 */
class FixedWindowLimiter {
  constructor(limit, durationSeconds) {
    this.limit = limit;
    this.duration = durationSeconds * 1000; // Convert to milliseconds
    this.clients = new Map();
  }

  isAllowed(clientId) {
    const now = Date.now();
    const clientData = this.clients.get(clientId);

    if (!clientData) {
      // First request from this client
      this.clients.set(clientId, {
        count: 1,
        windowStart: now,
      });
      return { allowed: true, retryAfter: null };
    }

    const windowAge = now - clientData.windowStart;

    // Window has expired, reset it
    if (windowAge > this.duration) {
      this.clients.set(clientId, {
        count: 1,
        windowStart: now,
      });
      return { allowed: true, retryAfter: null };
    }

    // Increment count
    clientData.count++;

    // Check if limit exceeded
    if (clientData.count > this.limit) {
      const retryAfter = Math.ceil(
        (this.duration - windowAge) / 1000
      );
      return { allowed: false, retryAfter };
    }

    return { allowed: true, retryAfter: null };
  }
}

/**
 * Sliding Window Log Rate Limiter
 * Tracks timestamps of requests within a sliding window
 */
class SlidingWindowLimiter {
  constructor(limit, durationSeconds) {
    this.limit = limit;
    this.duration = durationSeconds * 1000; // Convert to milliseconds
    this.clients = new Map();
  }

  isAllowed(clientId) {
    const now = Date.now();

    if (!this.clients.has(clientId)) {
      this.clients.set(clientId, []);
    }

    const timestamps = this.clients.get(clientId);

    // Remove timestamps outside the window
    const windowStart = now - this.duration;
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    // Check if limit exceeded
    if (timestamps.length >= this.limit) {
      const oldestTimestamp = timestamps[0];
      const retryAfter = Math.ceil(
        (oldestTimestamp + this.duration - now) / 1000
      );
      return { allowed: false, retryAfter };
    }

    // Add current timestamp
    timestamps.push(now);
    return { allowed: true, retryAfter: null };
  }
}

module.exports = {
  FixedWindowLimiter,
  SlidingWindowLimiter,
};
