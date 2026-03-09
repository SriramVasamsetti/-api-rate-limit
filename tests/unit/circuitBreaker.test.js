const CircuitBreaker = require('../../src/gateway/circuitBreaker');

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 0.5, 1); // 3 failures to open, 0.5s reset timeout, 1 success to close
  });

  test('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe('CLOSED');
  });

  test('should allow requests when CLOSED', () => {
    expect(breaker.canExecute()).toBe(true);
  });

  test('should transition to OPEN after threshold failures', () => {
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');

    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');

    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
  });

  test('should reject requests when OPEN', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.canExecute()).toBe(false);
  });

  test('should transition to HALF_OPEN after reset timeout', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(breaker.canExecute()).toBe(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  test('should transition to CLOSED on success from HALF_OPEN', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 600));

    breaker.canExecute(); // Transition to HALF_OPEN
    breaker.recordSuccess();

    expect(breaker.getState()).toBe('CLOSED');
  });

  test('should transition back to OPEN on failure from HALF_OPEN', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 600));

    breaker.canExecute(); // Transition to HALF_OPEN
    breaker.recordFailure();

    expect(breaker.getState()).toBe('OPEN');
  });

  test('should reset failure count when transitioning to CLOSED', async () => {
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 600));

    breaker.canExecute();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');

    // Now it takes 3 more failures to open again
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');
    breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');
    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
  });

  test('should succeed multiple times before closing from HALF_OPEN with threshold', async () => {
    const breaker2 = new CircuitBreaker(2, 0.5, 2); // 2 successes needed to close

    breaker2.recordFailure();
    breaker2.recordFailure();
    expect(breaker2.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 600));

    breaker2.canExecute();
    expect(breaker2.getState()).toBe('HALF_OPEN');

    breaker2.recordSuccess();
    expect(breaker2.getState()).toBe('HALF_OPEN');

    breaker2.recordSuccess();
    expect(breaker2.getState()).toBe('CLOSED');
  });
});
