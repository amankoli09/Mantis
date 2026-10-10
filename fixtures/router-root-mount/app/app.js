const express = require('express');
const routes = require('./routes');

const app = express();

// Mount router at root without explicit path prefix
app.use(routes);

app.get('/root', (req, res) => {
  res.send('root');
});

module.exports = app;
