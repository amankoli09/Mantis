'use strict';

const express = require('express');
const router = express.Router();

// GET /admin/dashboard — protected via mount-level verifyBearerToken
router.get('/dashboard', (req, res) => {
  res.json({ dashboard: true });
});

module.exports = router;
