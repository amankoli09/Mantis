export async function createRecord(req, res) {
  await Record.create(req.body);
  res.send('created in controller');
}
