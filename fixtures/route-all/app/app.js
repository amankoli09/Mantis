const express = require('express');
const app = express();

app.all('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users', (req, res) => {
  res.json([]);
});

module.exports = app;
