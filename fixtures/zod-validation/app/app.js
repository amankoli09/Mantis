import express from 'express';
import { z } from 'zod';
import { updateUserSchema } from './schemas.js';

const app = express();
app.use(express.json());

const userSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  age: z.number().min(18).max(120),
  role: z.enum(['admin', 'member', 'guest']),
  bio: z.string().optional(),
  avatar: z.string().nullable(),
  tags: z.array(z.string()),
});

const productSchema = z.object({
  sku: z.string().min(3),
  price: z.number().min(0),
});

const querySchema = z.object({
  q: z.string().min(1),
  limit: z.number().max(100).optional(),
});

function validate(schema) {
  return (req, res, next) => {
    schema.parse(req.body);
    next();
  };
}

// 1. POST /users - inline handler schema.parse(req.body)
app.post('/users', (req, res) => {
  const user = userSchema.parse(req.body);
  res.status(201).json(user);
});

// 2. PUT /users/:id - 1-hop imported schema
app.put('/users/:id', (req, res) => {
  const data = updateUserSchema.parse(req.body);
  res.json(data);
});

// 3. POST /products - validate(schema) middleware
app.post('/products', validate(productSchema), (req, res) => {
  res.status(201).json({ success: true });
});

// 4. GET /search - safeParse(req.query)
app.get('/search', (req, res) => {
  const result = querySchema.safeParse(req.query);
  res.json(result);
});

// 5. GET /untyped - regular endpoint without schema
app.get('/untyped', (req, res) => {
  res.send('ok');
});

export default app;
