'use strict';

// 1. Bearer token auth via req.headers.authorization
function verifyBearerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// 2. API key auth via req.headers['x-api-key']
function checkApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API Key' });
  }
  next();
}

// 3. Cookie / session auth via req.session.user
function sessionGuard(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'No active session' });
  }
  next();
}

// 4. Custom auth name heuristic
function requireAuth(req, res, next) {
  next();
}

module.exports = {
  verifyBearerToken,
  checkApiKey,
  sessionGuard,
  requireAuth,
};
