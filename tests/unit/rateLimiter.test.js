const { FixedWindowLimiter, SlidingWindowLimiter } = require('../../src/gateway/rateLimiter');

describe('FixedWindowLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new FixedWindowLimiter(3, 1); // 3 requests per 1 second
  });

  test('should allow requests under the limit', () => {
    const result1 = limiter.isAllowed('client1');
    const result2 = limiter.isAllowed('client1');
    const result3 = limiter.isAllowed('client1');

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
    expect(result3.allowed).toBe(true);
  });

  test('should reject requests exceeding the limit', () => {
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result4 = limiter.isAllowed('client1');
    expect(result4.allowed).toBe(false);
    expect(result4.retryAfter).toBeDefined();
  });

  test('should reset count after window expires', async () => {
    limiter = new FixedWindowLimiter(2, 0.1); // 2 requests per 0.1 seconds

    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result3 = limiter.isAllowed('client1');
    expect(result3.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result4 = limiter.isAllowed('client1');
    expect(result4.allowed).toBe(true);
  });

  test('should track different clients separately', () => {
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result1 = limiter.isAllowed('client1');
    expect(result1.allowed).toBe(false);

    // Client2 should have independent limit
    const result2 = limiter.isAllowed('client2');
    expect(result2.allowed).toBe(true);
  });

  test('should return correct retry-after value', () => {
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result = limiter.isAllowed('client1');
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(1);
  });
});

describe('SlidingWindowLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new SlidingWindowLimiter(3, 1); // 3 requests per 1 second
  });

  test('should allow requests under the limit', () => {
    const result1 = limiter.isAllowed('client1');
    const result2 = limiter.isAllowed('client1');
    const result3 = limiter.isAllowed('client1');

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
    expect(result3.allowed).toBe(true);
  });

  test('should reject requests exceeding the limit', () => {
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result4 = limiter.isAllowed('client1');
    expect(result4.allowed).toBe(false);
    expect(result4.retryAfter).toBeDefined();
  });

  test('should allow requests after window expires', async () => {
    limiter = new SlidingWindowLimiter(2, 0.1); // 2 requests per 0.1 seconds

    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result3 = limiter.isAllowed('client1');
    expect(result3.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result4 = limiter.isAllowed('client1');
    expect(result4.allowed).toBe(true);
  });

  test('should track different clients separately', () => {
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result1 = limiter.isAllowed('client1');
    expect(result1.allowed).toBe(false);

    // Client2 should have independent limit
    const result2 = limiter.isAllowed('client2');
    expect(result2.allowed).toBe(true);
  });

  test('should calculate correct retry-after for sliding window', () => {
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');
    limiter.isAllowed('client1');

    const result = limiter.isAllowed('client1');
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(1);
  });
});
