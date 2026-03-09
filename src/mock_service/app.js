const express = require("express");

const app = express();

// Configuration
// Default to 0 so tests are deterministic unless explicitly configured
const failRate = Number(process.env.UPSTREAM_FAIL_RATE || 0);

// Helper to randomly fail based on fail rate
function shouldFail() {
  return Math.random() < failRate;
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Data endpoint
app.get("/data", (req, res) => {
  if (shouldFail()) {
    console.log("[MockService] Simulating failure");

    return res.status(500).json({
      error: "Upstream service error",
    });
  }

  console.log("[MockService] Returning successful response");

  res.json({
    message: "Data from upstream service",
  });
});

module.exports = app;