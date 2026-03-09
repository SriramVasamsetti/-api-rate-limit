/**
 * Circuit Breaker
 * Implements state machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
 */
class CircuitBreaker {
  constructor(failureThreshold, resetTimeoutSeconds, successThresholdHalfOpen) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeoutSeconds * 1000; // Convert to milliseconds
    this.successThresholdHalfOpen = successThresholdHalfOpen;

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  /**
   * Check if request can proceed
   */
  canExecute() {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      // Check if reset timeout has passed
      const now = Date.now();
      if (now - this.lastFailureTime >= this.resetTimeout) {
        this.transitionToHalfOpen();
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      // Allow a single test request
      return true;
    }

    return false;
  }

  /**
   * Record successful request
   */
  recordSuccess() {
    if (this.state === 'CLOSED') {
      this.failureCount = 0;
      return;
    }

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThresholdHalfOpen) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * Record failed request
   */
  recordFailure() {
    this.lastFailureTime = Date.now();

    if (this.state === 'CLOSED') {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.transitionToOpen();
      }
      return;
    }

    if (this.state === 'HALF_OPEN') {
      this.transitionToOpen();
    }
  }

  transitionToOpen() {
    console.log('[CircuitBreaker] Transitioning to OPEN state');
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
  }

  transitionToHalfOpen() {
    console.log('[CircuitBreaker] Transitioning to HALF_OPEN state');
    this.state = 'HALF_OPEN';
    this.successCount = 0;
  }

  transitionToClosed() {
    console.log('[CircuitBreaker] Transitioning to CLOSED state');
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
  }

  getState() {
    return this.state;
  }
}

module.exports = CircuitBreaker;
