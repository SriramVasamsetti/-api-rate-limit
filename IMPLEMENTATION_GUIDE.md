# Implementation Guide

This guide explains the internal architecture and implementation details of the API Gateway.

## Middleware Flow

### Request Processing Pipeline

When a request arrives at `/api/proxy/data`:

```
1. Express Route Handler
   ↓
2. proxyManager.proxyRequest(req, res)
   ↓
3. Client ID Extraction
   ├─ Check for X-Client-ID header
   └─ Fall back to req.ip
   ↓
4. Rate Limit Checks
   ├─ Fixed Window Limiter
   │  └─ Return 429 if exceeded
   └─ Sliding Window Limiter
      └─ Return 429 if exceeded
   ↓
5. Circuit Breaker Check
   ├─ If OPEN: Return 503
   └─ If CLOSED/HALF_OPEN: Proceed
   ↓
6. Upstream Request via Axios
   ├─ GET to UPSTREAM_SERVICE_URL{path}
   ├─ 5s timeout
   └─ Error handling
   ↓
7. Response Recording
   ├─ On success: circuitBreaker.recordSuccess()
   └─ On failure: circuitBreaker.recordFailure()
   ↓
8. Client Response
   └─ Forward status and body
```

## Rate Limiter Implementation

### Fixed Window Limiter (`src/gateway/rateLimiter.js` - `FixedWindowLimiter` class)

**Data Structure:**
```javascript
Map<clientId, {
  count: number,
  windowStart: timestamp
}>
```

**Algorithm Logic:**

```javascript
function isAllowed(clientId) {
  const now = Date.now();
  const clientData = this.clients.get(clientId);

  // First request
  if (!clientData) {
    this.clients.set(clientId, {
      count: 1,
      windowStart: now,
    });
    return { allowed: true, retryAfter: null };
  }

  const windowAge = now - clientData.windowStart;

  // Window expired - reset it
  if (windowAge > this.duration) {
    this.clients.set(clientId, {
      count: 1,
      windowStart: now,
    });
    return { allowed: true, retryAfter: null };
  }

  // Increment within current window
  clientData.count++;

  // Check limit
  if (clientData.count > this.limit) {
    const retryAfter = Math.ceil(
      (this.duration - windowAge) / 1000
    );
    return { allowed: false, retryAfter };
  }

  return { allowed: true, retryAfter: null };
}
```

**Key Points:**
- Window resets automatically when expired
- Count is incremented before checking limit
- Retry-After is calculated from remaining window time
- Each client has independent window

**Example Timeline (5 requests per 10 seconds):**
```
t=0s:   req1 → allowed (count=1, window_start=0)
t=1s:   req2 → allowed (count=2)
t=2s:   req3 → allowed (count=3)
t=3s:   req4 → allowed (count=4)
t=4s:   req5 → allowed (count=5)
t=5s:   req6 → rejected (count would be 6, retry-after=5)
t=10s:  window_age=10s > duration, reset
t=10.1s: req7 → allowed (count=1, new window)
```

### Sliding Window Limiter (`src/gateway/rateLimiter.js` - `SlidingWindowLimiter` class)

**Data Structure:**
```javascript
Map<clientId, timestamp[]>
```

**Algorithm Logic:**

```javascript
function isAllowed(clientId) {
  const now = Date.now();

  if (!this.clients.has(clientId)) {
    this.clients.set(clientId, []);
  }

  const timestamps = this.clients.get(clientId);

  // Remove old timestamps outside window
  const windowStart = now - this.duration;
  while (timestamps.length > 0 && timestamps[0] < windowStart) {
    timestamps.shift();
  }

  // Check limit
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
```

**Key Points:**
- Maintains array of request timestamps
- Removes timestamps that fall outside the sliding window
- Checks current array size against limit
- Retry-After calculated from oldest timestamp

**Example Timeline (3 requests per 5 seconds):**
```
t=0.0s: req1 → allowed (timestamps=[0.0])
t=0.5s: req2 → allowed (timestamps=[0.0, 0.5])
t=1.0s: req3 → allowed (timestamps=[0.0, 0.5, 1.0])
t=1.5s: req4 → rejected (window=[1.5-5, 1.5]=[−3.5,1.5], need to remove nothing, array full)
        retry-after = ceil((0.0 + 5 - 1.5) / 1000) = 4 seconds
t=5.5s: window=[0.5, 5.5], remove 0.0
        req5 → allowed (timestamps=[0.5, 1.0, 5.5])
```

## Circuit Breaker Implementation

### State Machine (`src/gateway/circuitBreaker.js` - `CircuitBreaker` class)

**States and Transitions:**

```
         ┌─────────────┐
         │   CLOSED    │
         │(normal op)  │
         └──────┬──────┘
                │
       failures ≥ threshold
                │
                ↓
         ┌─────────────┐
         │    OPEN     │
         │  (broken)   │
         └──────┬──────┘
                │
       reset timeout elapsed
                │
                ↓
         ┌─────────────┐
         │  HALF_OPEN  │
         │ (testing)   │
         └──────┬──────┘
              ┌─┴─┐
              │   │
           success failure
              │   │
    success ≥ threshold
              │   │
              ↓   ↓
         CLOSED   OPEN
```

**Data Structure:**
```javascript
{
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  failureCount: number,
  successCount: number,
  lastFailureTime: timestamp,
  failureThreshold: number,
  resetTimeout: milliseconds,
  successThresholdHalfOpen: number
}
```

**Algorithm Logic:**

```javascript
// Check if request can proceed
canExecute() {
  if (this.state === 'CLOSED') {
    return true;  // Allow all requests
  }

  if (this.state === 'OPEN') {
    const now = Date.now();
    if (now - this.lastFailureTime >= this.resetTimeout) {
      this.transitionToHalfOpen();
      return true;  // Allow test request
    }
    return false;  // Reject all requests
  }

  if (this.state === 'HALF_OPEN') {
    return true;  // Allow test request
  }
}

// Record successful request
recordSuccess() {
  if (this.state === 'CLOSED') {
    // Reset failure counter
    this.failureCount = 0;
  } else if (this.state === 'HALF_OPEN') {
    // Increment success counter
    this.successCount++;
    if (this.successCount >= this.successThresholdHalfOpen) {
      this.transitionToClosed();  // Recovered!
    }
  }
}

// Record failed request
recordFailure() {
  this.lastFailureTime = Date.now();

  if (this.state === 'CLOSED') {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.transitionToOpen();  // Open circuit
    }
  } else if (this.state === 'HALF_OPEN') {
    this.transitionToOpen();  // Back to OPEN
  }
}
```

**State Transition Details:**

- **CLOSED → OPEN**: When `failureCount >= failureThreshold`
  - Logs: `[CircuitBreaker] Transitioning to OPEN state`
  - Records: `lastFailureTime = now`

- **OPEN → HALF_OPEN**: When `canExecute()` called and `now - lastFailureTime >= resetTimeout`
  - Logs: `[CircuitBreaker] Transitioning to HALF_OPEN state`
  - Resets: `successCount = 0`

- **HALF_OPEN → CLOSED**: When `successCount >= successThresholdHalfOpen`
  - Logs: `[CircuitBreaker] Transitioning to CLOSED state`
  - Resets: `failureCount = 0`, `successCount = 0`

- **HALF_OPEN → OPEN**: On `recordFailure()` in HALF_OPEN state
  - Immediately reopens circuit if test request fails

**Example Timeline (threshold=3, reset=30s, success_threshold=1):**
```
t=0s:     Request 1 fails → failureCount=1, CLOSED
t=1s:     Request 2 fails → failureCount=2, CLOSED
t=2s:     Request 3 fails → failureCount=3, OPEN
          (All subsequent requests rejected with 503)
t=32s:    Enough time passed, HALF_OPEN state entered
t=32.1s:  Test request succeeds → successCount=1, CLOSED
          (Back to normal operation)
t=34s:    Request fails → failureCount=1, CLOSED
```

## Request Lifecycle Through Proxy

### Successful Request

```javascript
// User makes request
GET /api/proxy/data
X-Client-ID: client1

// Gateway processing
1. clientId = "client1"
2. fixedWindow.isAllowed("client1") → { allowed: true }
3. slidingWindow.isAllowed("client1") → { allowed: true }
4. circuitBreaker.canExecute() → true (state=CLOSED)
5. axios.get("http://upstream:3000/data") → success
6. circuitBreaker.recordSuccess()
7. res.status(200).json({ message: "Data from upstream service" })
```

### Rate Limited Request

```javascript
// User makes 6th request in quick succession
GET /api/proxy/data
X-Client-ID: client1

// Gateway processing
1. clientId = "client1"
2. fixedWindow.isAllowed("client1") → { allowed: false, retryAfter: 4 }
3. res.status(429)
4. res.set("Retry-After", "4")
5. res.json({ error: "rate_limit_exceeded", message: "Too many requests" })
```

### Circuit Open Request

```javascript
// After circuit opens due to failures
GET /api/proxy/data
X-Client-ID: client1

// Gateway processing
1. clientId = "client1"
2. fixedWindow.isAllowed("client1") → { allowed: true }
3. slidingWindow.isAllowed("client1") → { allowed: true }
4. circuitBreaker.canExecute() → false (state=OPEN)
5. res.status(503).json({
     error: "service_unavailable",
     message: "Upstream service unavailable"
   })
```

## Error Handling

### Failure Detection

Failures that trigger circuit breaker:
- HTTP 5xx responses from upstream (500-599)
- Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
- Request timeout (5 second limit)

Success condition:
- HTTP 2xx or 3xx response

### Error Response Mapping

**Rate Limit (429):**
```javascript
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests"
}
Header: Retry-After: <seconds>
```

**Service Unavailable (503):**
- Circuit breaker OPEN
- Network error to upstream
- Upstream 5xx error
```javascript
{
  "error": "service_unavailable",
  "message": "Upstream service unavailable"
}
```

## Testing Strategy

### Unit Tests (Jest)

**rateLimiter.test.js** - Tests rate limiting algorithms in isolation
- Window enforcement
- Window reset
- Client separation
- Retry-After calculation

**circuitBreaker.test.js** - Tests state machine
- State transitions
- Threshold enforcement
- Reset timeout behavior
- Success threshold in HALF_OPEN

### Integration Tests (Supertest)

**gateway.test.js** - Tests full request flow
- Successful proxy requests
- Rate limiting end-to-end
- Circuit breaker end-to-end
- Service recovery

## Performance Notes

### Algorithmic Complexity

**Fixed Window:**
- Per-request time: O(1)
- Space: O(n) where n = number of unique clients

**Sliding Window:**
- Per-request time: O(w) where w = requests in window (typically small)
- Space: O(n × w) where n = clients, w = window size

**Circuit Breaker:**
- Per-request time: O(1)
- Space: O(1) per circuit

### Optimization Opportunities

For production at scale:
1. **Distributed Rate Limiting**: Use Redis instead of in-memory Map
2. **Memory Management**: Implement cleanup for inactive clients
3. **Metrics Collection**: Add Prometheus metrics
4. **Multiple Instances**: Consider shared circuit breaker state
5. **Request Batching**: Connection pooling to upstream

## Logging

Simple logging via `console.log`:

```javascript
// Circuit breaker transitions
[CircuitBreaker] Transitioning to OPEN state

// Proxy operations
[Proxy] Rate limit exceeded for client client1 (fixed-window)
[Proxy] Forwarding request to http://upstream:3000/data
[Proxy] Request successful, circuit breaker state: CLOSED
[Proxy] Request failed: ECONNREFUSED, circuit breaker state: OPEN

// Mock service
[MockService] Simulating failure
[MockService] Returning successful response
```

## Security Considerations

1. **Client ID Bypass**: X-Client-ID can be spoofed; use IP for untrusted clients
2. **Memory Exhaustion**: Unbounded client tracking could cause memory issues
3. **DDoS**: Rate limits protect but don't prevent flooding
4. **Upstream Auth**: Add authentication headers if needed
5. **HTTPS**: Use HTTPS in production for both gateway and upstream

## Debugging

To debug rate limiting:
```javascript
const clientData = limiter.clients.get('client1');
console.log('Fixed window state:', clientData);

const timestamps = limiter.clients.get('client1');
console.log('Sliding window timestamps:', timestamps);
```

To debug circuit breaker:
```javascript
console.log('Circuit state:', breaker.getState());
console.log('Failure count:', breaker.failureCount);
console.log('Success count:', breaker.successCount);
```
