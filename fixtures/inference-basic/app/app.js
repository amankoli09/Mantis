'use strict';

const express = require('express');
const app = express();
const { listItems } = require('./controllers/items');

// 1. Dot access on query, params, body & duplicate access
app.post('/posts/:id', (req, res) => {
  const id = req.params.id;
  const search = req.query.search;
  const title1 = req.body.title;
  const title2 = req.body.title;
  res.json({ id, search, title1, title2 });
});

// 2. Bracket access with string literals
app.post('/bracket', (req, res) => {
  const sort = req['query']['sort'];
  const content = req.body['content'];
  res.json({ sort, content });
});

// 3. Destructuring with rename
app.post('/destructure', (req, res) => {
  const { author, category: cat } = req.body;
  res.json({ author, cat });
});

// 4. Request parameter named 'request'
app.get('/request-param', (request, res) => {
  const tag = request.query.tag;
  res.json({ tag });
});

// 5. Request parameter named 'r'
app.post('/r-param', (r, res) => {
  const { data } = r.body;
  res.json({ data });
});

// 6. Imported controller function
app.get('/items', listItems);

// 7. Handler array where last one is the handler
const middlewareA = (req, res, next) => next();
const middlewareB = (req, res, next) => next();
app.post('/articles', [middlewareA, middlewareB, (req, res) => {
  const { slug } = req.body;
  res.json({ slug });
}]);

// 8. Whole-object passing (deliberately skipped guessing fields)
function saveToDb(body) { return body; }
app.post('/raw', (req, res) => {
  saveToDb(req.body);
  res.send('ok');
});

// 9. Unresolvable handler
function getDynamicHandler() { return (req, res) => res.send('dynamic'); }
app.get('/dynamic', getDynamicHandler());

// 10. Shadowed req inside nested function
app.get('/shadow', (req, res) => {
  const page = req.query.page;
  const sub = [{ name: 'test' }].map((req) => req.name);
  res.json({ page, sub });
});

module.exports = app;
