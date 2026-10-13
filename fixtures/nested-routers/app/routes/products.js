'use strict';

const express = require('express');

const router = express.Router();

// GET /api/products — static literal path, resolvable
router.get('/products', (req, res) => {
  res.json([]);
});

// MANTIS-NOTICE: path is a runtime variable — static scanner cannot resolve it.
// This endpoint will be marked confidence:"uncertain", confidenceReason:"MT-R003".
const PRODUCT_DETAIL_PATH = '/products/' + getDetailSegment();

// GET /api/products/<dynamic> — path determined at runtime, marked uncertain
router.get(PRODUCT_DETAIL_PATH, (req, res) => {
  res.json({});
});

module.exports = router;
