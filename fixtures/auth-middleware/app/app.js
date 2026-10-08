'use strict';

const express = require('express');
const app = express();

const { requestLogger } = require('./middleware/non-auth');
const { sessionGuard, verifyBearerToken, requireAuth } = require('./middleware/auth');
const itemsRouter = require('./routes/items');
const adminRouter = require('./routes/admin');

// 1. Built-in non-auth middleware
app.use(express.json());

// 2. Custom non-auth middleware
app.use(requestLogger);

// 3. Unresolvable dynamic middleware (emits DG-I002)
function getDynamicMiddleware() { return './middleware/dynamic'; }
const dynamicPath = getDynamicMiddleware();
const dynamicMw = require(dynamicPath);
app.use(dynamicMw);

// 4. Public route registered BEFORE app.use(sessionGuard)
app.get('/public', (req, res) => {
  res.json({ public: true });
});

// 5. Route-level auth middleware (requireAuth)
app.get('/custom-auth', requireAuth, (req, res) => {
  res.json({ custom: true });
});

// 6. Router mount BEFORE sessionGuard (itemsRouter)
app.use('/items', itemsRouter);

// 7. App-level auth middleware (sessionGuard)
app.use(sessionGuard);

// 8. Protected route registered AFTER app.use(sessionGuard)
app.get('/profile', (req, res) => {
  res.json({ profile: true });
});

// 9. Mount-level auth middleware (verifyBearerToken)
app.use('/admin', verifyBearerToken, adminRouter);

// 10. Shadowing demonstration (local variable named sessionGuard does not override module binding)
function shadowCheck() {
  const sessionGuard = 'local-string';
  return sessionGuard;
}

module.exports = app;
