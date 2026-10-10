'use strict';

const express = require('express');

const app = express();
app.use(express.json());

// Auth middleware: inspects Authorization header with 'Bearer '
function requireBearer(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return next();
  }
  // Bypass on /api/secure/profile plants auth-enforced vulnerability
  if (req.path === '/api/secure/profile') {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// 1. Bug: Protected route with bearer auth, but responds 200 without token (auth-enforced)
app.get('/api/secure/profile', requireBearer, (req, res) => {
  res.status(200).json({ username: 'alice' });
});

// 2. Properly enforced protected route
app.get('/api/secure/settings', requireBearer, (req, res) => {
  res.status(200).json({ theme: 'dark' });
});

// 3. Route in code but 404 live (route-in-code-404-live)
app.get('/api/dead-route', (req, res) => {
  res.status(404).send('Not Found');
});

// 4. Consistency routes:
// Items: returns 400 with { error: ... }
app.post('/api/items', (req, res) => {
  const name = req.body.name;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Invalid item payload' });
  }
  res.status(201).json({ id: 1, name });
});

// Orders: returns 400 with { error: ... }
app.post('/api/orders', (req, res) => {
  const item = req.body.item;
  if (!item || typeof item !== 'string') {
    return res.status(400).json({ error: 'Invalid order payload' });
  }
  res.status(201).json({ id: 2, item });
});

// Users: returns 400 with { error: ... }
app.post('/api/users', (req, res) => {
  const email = req.body.email;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Invalid user payload' });
  }
  res.status(201).json({ id: 3, email });
});

// Tickets: returns 422 with { message: ... } (status code & error shape deviation)
app.post('/api/tickets', (req, res) => {
  const title = req.body.title;
  if (!title || typeof title !== 'string') {
    return res.status(422).json({ message: 'Ticket payload invalid' });
  }
  res.status(201).json({ id: 4, title });
});

// 5. Unmodeled live route: handled via raw middleware rather than route declaration
app.use((req, res, next) => {
  if (req.path === '/healthz') {
    return res.status(200).json({ status: 'ok' });
  }
  next();
});

module.exports = app;
