const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.send('ok');
});

router.post('/status', (req, res) => {
  res.json({ healthy: true });
});

module.exports = router;
