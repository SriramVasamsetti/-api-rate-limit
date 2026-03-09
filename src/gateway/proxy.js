const axios = require("axios");
const CircuitBreaker = require("./circuitBreaker");
const { FixedWindowLimiter, SlidingWindowLimiter } = require("./rateLimiter");

/**
 * Proxy module combining rate limiting and circuit breaker
 */
class ProxyManager {
  constructor(upstreamUrl, config) {
    this.upstreamUrl = upstreamUrl;

    // Initialize rate limiters
    this.fixedWindowLimiter = new FixedWindowLimiter(
      config.fixedWindowLimit,
      config.fixedWindowDurationSeconds
    );

    this.slidingWindowLimiter = new SlidingWindowLimiter(
      config.slidingWindowLimit,
      config.slidingWindowDurationSeconds
    );

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      config.cbFailureThreshold,
      config.cbResetTimeoutSeconds,
      config.cbSuccessThresholdHalfOpen
    );
  }

  /**
   * Get client ID from request
   */
  getClientId(req) {
    return req.headers["x-client-id"] || req.ip;
  }

  /**
   * Check if request should be rate limited
   */
  checkRateLimit(clientId) {
    const fixedWindowResult = this.fixedWindowLimiter.isAllowed(clientId);

    if (!fixedWindowResult.allowed) {
      return {
        allowed: false,
        limiter: "fixed-window",
        retryAfter: fixedWindowResult.retryAfter,
      };
    }

    const slidingWindowResult = this.slidingWindowLimiter.isAllowed(clientId);

    if (!slidingWindowResult.allowed) {
      return {
        allowed: false,
        limiter: "sliding-window",
        retryAfter: slidingWindowResult.retryAfter,
      };
    }

    return { allowed: true };
  }

  /**
   * Proxy request to upstream service
   */
  async proxyRequest(req, res) {
    const clientId = this.getClientId(req);

    // Check rate limits
    const rateLimitResult = this.checkRateLimit(clientId);

    if (!rateLimitResult.allowed) {
      console.log(
        `[Proxy] Rate limit exceeded for client ${clientId} (${rateLimitResult.limiter})`
      );

      res.status(429).set("Retry-After", rateLimitResult.retryAfter);

      return res.json({
        error: "rate_limit_exceeded",
        message: "Too many requests",
      });
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      console.log("[Proxy] Circuit breaker is OPEN, rejecting request");

      return res.status(503).json({
        error: "service_unavailable",
        message: "Upstream service unavailable",
      });
    }

    try {
      // Strip gateway prefix so upstream receives correct path
      const upstreamPath = req.path.replace("/api/proxy", "");
      const upstreamUrl = `${this.upstreamUrl}${upstreamPath}`;

      console.log(`[Proxy] Forwarding request to ${upstreamUrl}`);

      const response = await axios.get(upstreamUrl, {
        timeout: 5000,
      });

      this.circuitBreaker.recordSuccess();

      console.log(
        `[Proxy] Request successful, circuit breaker state: ${this.circuitBreaker.getState()}`
      );

      return res.status(response.status).json(response.data);
    } catch (error) {
      this.circuitBreaker.recordFailure();

      console.log(
        `[Proxy] Request failed: ${error.message}, circuit breaker state: ${this.circuitBreaker.getState()}`
      );

      // Upstream returned 5xx error
      if (error.response && error.response.status >= 500) {
        return res.status(error.response.status).json(error.response.data);
      }

      // Network failure or timeout
      return res.status(503).json({
        error: "service_unavailable",
        message: "Upstream service unavailable",
      });
    }
  }

  /**
   * Get circuit breaker state (for tests / monitoring)
   */
  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }
}

module.exports = ProxyManager;