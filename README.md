# API Gateway with Resilience Patterns

A production-quality Node.js API Gateway implementing industry-standard resilience patterns: **fixed window rate limiting**, **sliding window rate limiting**, and **circuit breaker pattern**.

## Project Overview

This API Gateway acts as a proxy layer between clients and upstream services. It protects upstream services from overload and cascading failures through two complementary rate limiting algorithms and a circuit breaker state machine.

### Key Features

- **Dual Rate Limiting**: Combines fixed window and sliding window algorithms for robust request control
- **Circuit Breaker**: Prevents cascade failures with CLOSED → OPEN → HALF_OPEN state machine
- **Client Identification**: Tracks limits per client using X-Client-ID header or IP address
- **Health Checks**: Docker health checks for all services
- **Comprehensive Tests**: Unit and integration tests with Jest and Supertest

## Architecture

### Request Flow

```
Client Request
    ↓
API Gateway (/api/proxy/data)
    ↓
[1] Client ID Extraction (X-Client-ID or IP)
    ↓
[2] Fixed Window Rate Limiter Check
    ↓
[3] Sliding Window Rate Limiter Check
    ↓
[4] Circuit Breaker State Check
    ↓
[5] Forward to Upstream Service (if allowed)
    ↓
[6] Update Circuit Breaker State (success/failure)
    ↓
Client Response
```

### Services

- **api-gateway**: Main gateway service on port 8080
- **upstream-mock**: Mock upstream service on port 3000 with configurable failure rate

## Rate Limiting

### Fixed Window Rate Limiter

Divides time into fixed intervals. Each client gets a request budget that resets at the start of each window.

**Algorithm:**
1. Track per-client: `count` and `windowStart` timestamp
2. If current time exceeds window duration, reset count and windowStart
3. Increment count on each request
4. Reject if count exceeds limit with HTTP 429

**Configuration:**
- `FIXED_WINDOW_LIMIT`: Maximum requests per window
- `FIXED_WINDOW_DURATION_SECONDS`: Window duration in seconds

**Example:** 5 requests per 10 seconds
- Client makes requests at: 0.1s, 0.5s, 1s, 9s, 9.5s, 10s
- First 5 requests allowed, 6th rejected (reset happens at 10s)

### Sliding Window Log Rate Limiter

Maintains a log of request timestamps. Removes timestamps outside the current window and rejects if log size exceeds limit.

**Algorithm:**
1. Track per-client: array of timestamps
2. Remove timestamps older than window duration
3. If array length >= limit, reject
4. Otherwise, append current timestamp and allow

**Configuration:**
- `SLIDING_WINDOW_LIMIT`: Maximum requests per window
- `SLIDING_WINDOW_DURATION_SECONDS`: Window duration in seconds

**Example:** 3 requests per 5 seconds
- Window: [T, T+5)
- At T+0.5s: 1 request allowed
- At T+1s: 2 requests allowed
- At T+1.5s: 3 requests allowed
- At T+2s: Request rejected (window full)
- At T+5.5s: Old requests outside window, new request allowed

## Circuit Breaker

Implements a state machine to prevent cascading failures:

### States

**CLOSED** (normal operation)
- Requests forwarded to upstream
- Failures tracked
- When failures ≥ threshold → transition to OPEN

**OPEN** (circuit broken)
- Requests immediately rejected with HTTP 503
- No calls to upstream
- After reset timeout → transition to HALF_OPEN

**HALF_OPEN** (testing recovery)
- Allows test requests to upstream
- Success → transition to CLOSED
- Failure → transition back to OPEN

### Configuration

- `CB_FAILURE_THRESHOLD`: Number of failures before opening circuit
- `CB_RESET_TIMEOUT_SECONDS`: Time to wait before attempting recovery
- `CB_SUCCESS_THRESHOLD_HALF_OPEN`: Successes needed in HALF_OPEN to close circuit

### Failure Detection

Failures include:
- Upstream HTTP 5xx responses
- Network errors
- Request timeouts

## Setup Instructions

### Prerequisites

- Node.js 18+ or Docker

### Local Development

1. Clone and install:
```bash
git clone <repo>
cd api-gateway-resilience
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Start upstream mock service in one terminal:
```bash
UPSTREAM_PORT=3000 UPSTREAM_FAIL_RATE=0.2 node src/mock_service/index.js
```

4. Start gateway in another terminal:
```bash
npm start
```

### Docker Compose

Start both services:
```bash
docker-compose up
```

Services will be available at:
- Gateway: http://localhost:8080
- Mock Service: http://localhost:3000

## API Usage

### Health Check

```bash
curl http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy"
}
```

### Proxy Endpoint

```bash
curl http://localhost:8080/api/proxy/data
```

Successful response (HTTP 200):
```json
{
  "message": "Data from upstream service"
}
```

### Rate Limited Response (HTTP 429)

```bash
# Make multiple requests quickly to trigger rate limit
for i in {1..10}; do curl http://localhost:8080/api/proxy/data; done
```

Response:
```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests"
}
```

Header: `Retry-After: <seconds>`

### Circuit Breaker Response (HTTP 503)

When circuit is OPEN:
```json
{
  "error": "service_unavailable",
  "message": "Upstream service unavailable"
}
```

### Custom Client ID

Requests are tracked per client. Use X-Client-ID header:

```bash
curl -H "X-Client-ID: premium-client" http://localhost:8080/api/proxy/data
```

Without the header, IP address is used for tracking.

## Testing

### Run All Tests

```bash
npm test
```

### Run Unit Tests Only

```bash
npm run test:unit
```

Unit tests verify:
- Fixed window enforcement and reset
- Sliding window enforcement
- Retry-After calculation
- Circuit breaker state transitions
- CLOSED → OPEN → HALF_OPEN → CLOSED flow
- Failure and recovery scenarios

### Run Integration Tests

```bash
npm run test:integration
```

Integration tests verify:
- Successful proxy requests
- Fixed window rate limiting (HTTP 429)
- Sliding window rate limiting (HTTP 429)
- Circuit breaker opening after failures
- Circuit breaker rejecting requests (HTTP 503)
- Circuit breaker recovery after timeout

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| API_GATEWAY_PORT | Gateway listen port | 8080 |
| UPSTREAM_SERVICE_URL | Upstream service URL | http://upstream-mock:3000 |
| FIXED_WINDOW_LIMIT | Requests per fixed window | 5 |
| FIXED_WINDOW_DURATION_SECONDS | Fixed window duration | 10 |
| SLIDING_WINDOW_LIMIT | Requests per sliding window | 3 |
| SLIDING_WINDOW_DURATION_SECONDS | Sliding window duration | 5 |
| CB_FAILURE_THRESHOLD | Failures to open circuit | 3 |
| CB_RESET_TIMEOUT_SECONDS | Time before HALF_OPEN | 30 |
| CB_SUCCESS_THRESHOLD_HALF_OPEN | Successes to close circuit | 1 |

## Project Structure

```
.
├── src
│   ├── gateway
│   │   ├── main.js              # Gateway entry point
│   │   ├── proxy.js             # Proxy logic with resilience
│   │   ├── rateLimiter.js       # Rate limiting algorithms
│   │   └── circuitBreaker.js    # Circuit breaker state machine
│   │
│   └── mock_service
│       ├── app.js               # Express app for mock service
│       └── index.js             # Mock service entry point
│
├── tests
│   ├── unit
│   │   ├── rateLimiter.test.js  # Rate limiter tests
│   │   └── circuitBreaker.test.js  # Circuit breaker tests
│   │
│   └── integration
│       └── gateway.test.js      # Integration tests
│
├── Dockerfile                   # Gateway container
├── Dockerfile.mock              # Mock service container
├── docker-compose.yml           # Compose configuration
├── .env.example                 # Environment template
├── package.json
├── README.md
└── IMPLEMENTATION_GUIDE.md
```

## Monitoring

### Logs

All services log to stdout using `console.log`:

- `[CircuitBreaker]` - Circuit breaker state transitions
- `[Proxy]` - Request forwarding, rate limits, circuit state
- `[MockService]` - Upstream service requests

### Health Checks

Docker health checks run every 10 seconds:

```bash
docker-compose ps
# Shows health status of both services
```

## Performance Considerations

- **Memory**: In-memory state storage (no database required)
- **CPU**: Minimal overhead for rate limit calculations
- **Scalability**: Per-instance state; use with load balancer for horizontal scaling
- **Concurrency**: Node.js single-threaded but handles async operations

For multi-instance deployments, consider:
- Distributed rate limiting (Redis)
- Shared circuit breaker state
- Centralized logging
