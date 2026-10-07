'use strict';

function listItems(req, res) {
  const limit = req.query.limit;
  res.json({ limit });
}

module.exports = {
  listItems,
};
