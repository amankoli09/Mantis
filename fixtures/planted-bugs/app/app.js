'use strict';

const express = require('express');

const app = express();

app.use(express.json());

// Clean route 1: GET /api/health (liveness probe)
// Returns 200 OK, no stack trace, no sensitive data.
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Clean route 2: POST /api/echo (safely validates input)
// Handles missing or wrong-type message with 400 Bad Request instead of 500.
app.post('/api/echo', (req, res) => {
  const message = req.body.message;
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'message must be a string' });
  }
  res.status(200).json({ message });
});

// Deliberate Bug 1: POST /api/users (catches 'no-5xx-on-bad-input')
// Assumes email is present and a string; calls .trim().toLowerCase() without checking.
// Missing or wrong-type email throws TypeError -> Express returns 500!
app.post('/api/users', (req, res) => {
  const email = req.body.email;
  const normalized = email.trim().toLowerCase();
  res.status(201).json({ id: 'u1', email: normalized });
});

// Deliberate Bug 2: GET /api/debug-error (catches 'no-stack-trace-leak')
// Explicitly leaks debug stack trace in response.
app.get('/api/debug-error', (req, res) => {
  res.status(200).json({
    error: 'Internal server error',
    stack: 'Error: Database pool connection timeout at pool.js:42\n    at Object.<anonymous> (/app/db/pool.js:42:15)\n    at Module._compile (node_modules/loader.js:10:5)',
  });
});

// Deliberate Bug 3: GET /api/profile (catches 'no-sensitive-fields')
// Returns user profile containing sensitive keys (passwordHash, apiKey).
app.get('/api/profile', (req, res) => {
  res.status(200).json({
    user: {
      id: 1,
      username: 'alice',
      passwordHash: 'argon2id$v=19$m=65536,t=3,p=4$fakehash',
      apiKey: 'mantis_sk_test_987654321',
    },
  });
});

// Deliberate Bug 4: GET /api/internal-fail (catches 'server-error-on-valid-input')
// Fails with 500 even on valid request. Because input is presumed valid, this is NOT a bad-input bug;
// it is flagged as server-error-on-valid-input with lower confidence.
app.get('/api/internal-fail', (req, res) => {
  res.status(500).json({ error: 'Downstream service unavailable' });
});

// Clean error handler for uncaught errors
app.use((err, req, res, _next) => {
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
