'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

// MALICIOUS ATTEMPT: If Mantis ever evaluates or imports target code,
// this canary file will be created on disk.
const canaryFile = path.join(__dirname, 'PWNED_CANARY.txt');
try {
  fs.writeFileSync(canaryFile, 'PWNED_SIDE_EFFECT_EXECUTED');
} catch {
  // ignore if read-only
}

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/dangerous-action', (req, res) => {
  res.json({ executed: true });
});

module.exports = app;
