'use strict';

const express = require('express');
const router = express.Router();
const { checkApiKey } = require('../middleware/auth');

// GET /items/public-items — registered BEFORE router.use(checkApiKey)
router.get('/public-items', (req, res) => {
  res.json({ items: [] });
});

// Router-level auth middleware
router.use(checkApiKey);

// GET /items/secret-items — registered AFTER router.use(checkApiKey)
router.get('/secret-items', (req, res) => {
  res.json({ secrets: [] });
});

module.exports = router;
