const express = require('express');
const app = express();
const config = require('./config');

const BASE = config.API_PREFIX;
const FULL_PREFIX = BASE + config.V1;
const TEMPLATE_PREFIX = `${BASE}/v2`;

// 1. String constants & Template literals
app.get(FULL_PREFIX + '/users', (req, res) => res.json([]));
app.post(`${TEMPLATE_PREFIX}/users`, (req, res) => res.json([]));

// 2. Path arrays
app.get(['/a', '/b'], (req, res) => res.send('ab'));

// 3. Array in router mount
const router = express.Router();
router.get('/items', (req, res) => res.send('items'));
app.use([FULL_PREFIX + '/store', TEMPLATE_PREFIX + '/store'], router);

// 4. Deliberately uncertain forms
let reassigned = '/old';
reassigned = '/new';
app.get(reassigned, (req, res) => res.send('reassigned'));

const fromEnv = process.env.MY_ROUTE;
app.get(fromEnv, (req, res) => res.send('env'));

app.get(/.*regex.*/, (req, res) => res.send('regex'));

const mutableObj = { path: '/path' };
app.get(mutableObj.path, (req, res) => res.send('mutable'));

function getPath() { return '/func'; }
app.get(getPath(), (req, res) => res.send('func'));

// 5. Partial resolution
const PARTIAL = FULL_PREFIX + '/' + getPath();
app.get(PARTIAL, (req, res) => res.send('partial'));

// 6. Cyclic constant (variables)
const CYCLIC_A = CYCLIC_B;
const CYCLIC_B = CYCLIC_A;
app.get(CYCLIC_A, (req, res) => res.send('cycle'));
