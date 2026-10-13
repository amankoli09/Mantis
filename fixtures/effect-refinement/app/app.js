import express from 'express';
import fs from 'node:fs';
import { createRecord } from './controller.js';

const app = express();

// 1. Safe read behind GET -> effect: read, no evidence
app.get('/safe-read', async (req, res) => {
  const items = await Item.find();
  res.json(items);
});

// 2. Prisma create behind GET -> effect: write
app.get('/prisma-create', async (req, res) => {
  await prisma.user.create({ data: req.body });
  res.send('created');
});

// 3. Mongoose update behind GET -> effect: write
app.get('/mongoose-update', async (req, res) => {
  await User.updateOne({ _id: req.query.id }, { name: 'updated' });
  res.send('updated');
});

// 4. fs.writeFileSync behind GET -> effect: write
app.get('/fs-write', (req, res) => {
  fs.writeFileSync('output.txt', 'data');
  res.send('written');
});

// 5. fetch with POST behind GET -> effect: write
app.get('/fetch-post', async (req, res) => {
  await fetch('https://example.com/api', { method: 'POST', body: '{}' });
  res.send('fetched');
});

// 6. Prisma delete behind GET -> effect: destructive
app.get('/prisma-delete', async (req, res) => {
  await prisma.user.delete({ where: { id: 1 } });
  res.send('deleted');
});

// 7. Knex del behind GET -> effect: destructive
app.get('/knex-del', async (req, res) => {
  await knex('items').where('id', 1).del();
  res.send('deleted');
});

// 8. POST with read-only handler -> effect: write (monotonic: never lowered)
app.post('/post-read-only', async (req, res) => {
  const user = await User.findById(req.body.id);
  res.json(user);
});

// 9. POST with delete call -> effect: destructive (raised from write)
app.post('/post-delete', async (req, res) => {
  await User.findByIdAndDelete(req.body.id);
  res.send('deleted');
});

// 10. DELETE endpoint -> effect: destructive (stays destructive)
app.delete('/delete-endpoint', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.send('ok');
});

// 11. 1-hop controller imported -> effect: write
app.get('/controller-write', createRecord);

// 12. Unresolvable dynamic handler -> stays baseline read, diagnostic MT-I001
app.get('/unresolvable-handler', getDynamicHandler());

export default app;
