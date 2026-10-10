module.exports = function (app) {
  app.get('/api/items', (req, res) => {
    res.json([]);
  });

  app.post('/api/items', (req, res) => {
    res.json({ success: true });
  });

  app.delete('/api/items/:id', (req, res) => {
    res.json({ deleted: true });
  });
};
