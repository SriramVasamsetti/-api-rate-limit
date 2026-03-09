require('dotenv').config();
const express = require('express');
const ProxyManager = require('./proxy');

const app = express();
const port = process.env.API_GATEWAY_PORT || 8080;

// Initialize proxy manager
const proxyManager = new ProxyManager(process.env.UPSTREAM_SERVICE_URL, {
  fixedWindowLimit: parseInt(process.env.FIXED_WINDOW_LIMIT),
  fixedWindowDurationSeconds: parseInt(process.env.FIXED_WINDOW_DURATION_SECONDS),
  slidingWindowLimit: parseInt(process.env.SLIDING_WINDOW_LIMIT),
  slidingWindowDurationSeconds: parseInt(process.env.SLIDING_WINDOW_DURATION_SECONDS),
  cbFailureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD),
  cbResetTimeoutSeconds: parseInt(process.env.CB_RESET_TIMEOUT_SECONDS),
  cbSuccessThresholdHalfOpen: parseInt(process.env.CB_SUCCESS_THRESHOLD_HALF_OPEN),
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Proxy endpoint
app.get('/api/proxy/data', (req, res) => {
  proxyManager.proxyRequest(req, res);
});

// Start server with error handling for port in use
let serverInstance = null;

const startServer = (portNumber, maxAttempts = 10) => {
  if (portNumber > port + maxAttempts) {
    console.error(`Unable to find available port after ${maxAttempts} attempts`);
    process.exit(1);
  }

  const server = app.listen(portNumber, '0.0.0.0', () => {
    serverInstance = server;
    console.log(`API Gateway listening on port ${portNumber}`);
    console.log(`Upstream service URL: ${process.env.UPSTREAM_SERVICE_URL}`);
    console.log(
      `Fixed Window Rate Limit: ${process.env.FIXED_WINDOW_LIMIT} requests per ${process.env.FIXED_WINDOW_DURATION_SECONDS}s`
    );
    console.log(
      `Sliding Window Rate Limit: ${process.env.SLIDING_WINDOW_LIMIT} requests per ${process.env.SLIDING_WINDOW_DURATION_SECONDS}s`
    );
    console.log(
      `Circuit Breaker: ${process.env.CB_FAILURE_THRESHOLD} failures to open, ${process.env.CB_RESET_TIMEOUT_SECONDS}s reset timeout`
    );
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const alternativePort = portNumber + 1;
      console.warn(`Port ${portNumber} is already in use. Trying port ${alternativePort}...`);
      server.close();
      startServer(alternativePort, maxAttempts);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  return server;
};

const server = startServer(port);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (serverInstance) {
    serverInstance.close(() => {
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  if (serverInstance) {
    serverInstance.close(() => {
      process.exit(0);
    });
  }
});

module.exports = { app, proxyManager };
