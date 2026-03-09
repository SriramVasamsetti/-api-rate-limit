const request = require('supertest');
const express = require('express');
const ProxyManager = require('../../src/gateway/proxy');
const mockApp = require('../../src/mock_service/app');

describe('API Gateway Integration Tests', () => {
  let app;
  let proxyManager;
  let mockServer;

  beforeAll((done) => {
    // Start mock service
    mockServer = mockApp.listen(3001, () => {
      // Create gateway app
      app = express();

      proxyManager = new ProxyManager('http://localhost:3001', {
        fixedWindowLimit: 2,
        fixedWindowDurationSeconds: 1,
        slidingWindowLimit: 2,
        slidingWindowDurationSeconds: 1,
        cbFailureThreshold: 2,
        cbResetTimeoutSeconds: 1,
        cbSuccessThresholdHalfOpen: 1,
      });

      app.get('/health', (req, res) => {
        res.json({ status: 'healthy' });
      });

      app.get('/api/proxy/data', (req, res) => {
        proxyManager.proxyRequest(req, res);
      });

      done();
    });
  });

  afterAll(() => {
    if (mockServer) {
      mockServer.close();
    }
  });

  test('should perform successful proxy request', async () => {
    const response = await request(app)
      .get('/api/proxy/data')
      .expect(200);

    expect(response.body).toHaveProperty('message');
  });

  test('should enforce fixed window rate limiting', async () => {
    const proxyManager2 = new ProxyManager('http://localhost:3001', {
      fixedWindowLimit: 2,
      fixedWindowDurationSeconds: 10,
      slidingWindowLimit: 10,
      slidingWindowDurationSeconds: 10,
      cbFailureThreshold: 100,
      cbResetTimeoutSeconds: 10,
      cbSuccessThresholdHalfOpen: 1,
    });

    const app2 = express();
    app2.get('/api/proxy/data', (req, res) => {
      proxyManager2.proxyRequest(req, res);
    });

    // First two requests should succeed
    await request(app2)
      .get('/api/proxy/data')
      .set('X-Client-ID', 'test-client')
      .expect(200);

    await request(app2)
      .get('/api/proxy/data')
      .set('X-Client-ID', 'test-client')
      .expect(200);

    // Third request should be rate limited
    const response = await request(app2)
      .get('/api/proxy/data')
      .set('X-Client-ID', 'test-client')
      .expect(429);

    expect(response.body).toHaveProperty('error', 'rate_limit_exceeded');
  });

  test('should enforce sliding window rate limiting', async () => {
    const proxyManager3 = new ProxyManager('http://localhost:3001', {
      fixedWindowLimit: 10,
      fixedWindowDurationSeconds: 10,
      slidingWindowLimit: 1,
      slidingWindowDurationSeconds: 10,
      cbFailureThreshold: 100,
      cbResetTimeoutSeconds: 10,
      cbSuccessThresholdHalfOpen: 1,
    });

    const app3 = express();
    app3.get('/api/proxy/data', (req, res) => {
      proxyManager3.proxyRequest(req, res);
    });

    // First request should succeed
    await request(app3)
      .get('/api/proxy/data')
      .set('X-Client-ID', 'test-client2')
      .expect(200);

    // Second request should be rate limited
    const response = await request(app3)
      .get('/api/proxy/data')
      .set('X-Client-ID', 'test-client2')
      .expect(429);

    expect(response.body).toHaveProperty('error', 'rate_limit_exceeded');
  });

  test('should open circuit breaker after failures', async () => {
    const proxyManager4 = new ProxyManager('http://localhost:3001', {
      fixedWindowLimit: 100,
      fixedWindowDurationSeconds: 10,
      slidingWindowLimit: 100,
      slidingWindowDurationSeconds: 10,
      cbFailureThreshold: 1,
      cbResetTimeoutSeconds: 2,
      cbSuccessThresholdHalfOpen: 1,
    });

    const app4 = express();
    app4.get('/api/proxy/fail', (req, res) => {
      proxyManager4.proxyRequest(req, res);
    });

    // Simulate upstream failures by calling a non-existent endpoint
    proxyManager4.circuitBreaker.recordFailure();
    expect(proxyManager4.circuitBreaker.getState()).toBe('OPEN');

    // Circuit should be open, request should return 503
    const response = await request(app4)
      .get('/api/proxy/fail')
      .expect(503);

    expect(response.body).toHaveProperty('error', 'service_unavailable');
  });

  test('should return 503 when circuit is OPEN', async () => {
    const proxyManager5 = new ProxyManager('http://localhost:3001', {
      fixedWindowLimit: 100,
      fixedWindowDurationSeconds: 10,
      slidingWindowLimit: 100,
      slidingWindowDurationSeconds: 10,
      cbFailureThreshold: 1,
      cbResetTimeoutSeconds: 2,
      cbSuccessThresholdHalfOpen: 1,
    });

    const app5 = express();
    app5.get('/api/proxy/data', (req, res) => {
      proxyManager5.proxyRequest(req, res);
    });

    // Open the circuit
    proxyManager5.circuitBreaker.recordFailure();

    const response = await request(app5)
      .get('/api/proxy/data')
      .expect(503);

    expect(response.body).toHaveProperty('error', 'service_unavailable');
    expect(response.body.message).toBe('Upstream service unavailable');
  });

  test('should recover circuit breaker after reset timeout', async () => {
    const proxyManager6 = new ProxyManager('http://localhost:3001', {
      fixedWindowLimit: 100,
      fixedWindowDurationSeconds: 10,
      slidingWindowLimit: 100,
      slidingWindowDurationSeconds: 10,
      cbFailureThreshold: 1,
      cbResetTimeoutSeconds: 0.5,
      cbSuccessThresholdHalfOpen: 1,
    });

    const app6 = express();
    app6.get('/api/proxy/data', (req, res) => {
      proxyManager6.proxyRequest(req, res);
    });

    // Open the circuit
    proxyManager6.circuitBreaker.recordFailure();
    expect(proxyManager6.circuitBreaker.getState()).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 700));

    // Request should now go through (circuit in HALF_OPEN then CLOSED)
    const response = await request(app6)
      .get('/api/proxy/data')
      .expect(200);

    expect(proxyManager6.circuitBreaker.getState()).toBe('CLOSED');
  });
});
