import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import type { File, FunctionDeclaration } from '@babel/types';
import { inferEffectFromHandler } from '../src/extract/effect-inference.js';

function parseSnippet(code: string): { ast: File; fnNode: FunctionDeclaration } {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  const fnNode = ast.program.body[0] as FunctionDeclaration;
  return { ast, fnNode };
}

describe('inferEffectFromHandler', () => {
  describe('Prisma', () => {
    it('detects prisma.user.create as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await prisma.user.create({ data: { name: 'Alice' } });
          res.send('ok');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence).toEqual({
        filePath: 'app.js',
        line: 3,
        signal: 'prisma:create',
      });
    });

    it('detects prisma.user.delete as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await prisma.user.delete({ where: { id: 1 } });
          res.send('ok');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence).toEqual({
        filePath: 'app.js',
        line: 3,
        signal: 'prisma:delete',
      });
    });
  });

  describe('Mongoose', () => {
    it('detects User.updateOne as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await User.updateOne({ _id: req.params.id }, { name: 'Bob' });
          res.json({ ok: true });
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('mongoose:updateOne');
    });

    it('detects User.findByIdAndDelete as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await User.findByIdAndDelete(req.params.id);
          res.json({ deleted: true });
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('mongoose:findByIdAndDelete');
    });

    it('detects doc.save() as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          const doc = new User(req.body);
          await doc.save();
          res.json(doc);
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('mongoose:save');
    });
  });

  describe('Sequelize', () => {
    it('detects User.bulkCreate as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await User.bulkCreate(req.body);
          res.send('created');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('sequelize:bulkCreate');
    });

    it('detects User.destroy as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await User.destroy({ where: { id: 1 } });
          res.send('destroyed');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('sequelize:destroy');
    });
  });

  describe('Knex', () => {
    it('detects knex("users").insert as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await knex('users').insert({ name: 'Charlie' });
          res.send('inserted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('knex:insert');
    });

    it('detects knex("users").del() as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await knex('users').where('id', 1).del();
          res.send('deleted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('knex:del');
    });
  });

  describe('pg (node-postgres)', () => {
    it('detects pool.query("INSERT INTO ...") as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await pool.query('INSERT INTO items (name) VALUES ($1)', ['item']);
          res.send('inserted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('pg:query:insert');
    });

    it('detects pool.query("DELETE FROM ...") as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await pool.query('DELETE FROM items WHERE id = $1', [1]);
          res.send('deleted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('pg:query:delete');
    });

    it('does not classify pool.query("SELECT ...") as mutation', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          const rows = await pool.query('SELECT * FROM items');
          res.json(rows);
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('read');
      expect(result.effectEvidence).toBeUndefined();
    });
  });

  describe('fs (filesystem)', () => {
    it('detects fs.writeFile as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          fs.writeFile('/tmp/log.txt', 'data', () => {});
          res.send('logged');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('fs:writeFile');
    });

    it('detects fs.unlinkSync as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          fs.unlinkSync('/tmp/log.txt');
          res.send('deleted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('fs:unlinkSync');
    });
  });

  describe('fetch & axios', () => {
    it('detects fetch with POST method as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await fetch('https://api.example.com/sync', { method: 'POST', body: '{}' });
          res.send('synced');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('fetch:POST');
    });

    it('detects fetch with DELETE method as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await fetch('https://api.example.com/item/1', { method: 'DELETE' });
          res.send('deleted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('fetch:DELETE');
    });

    it('detects axios.delete as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await axios.delete('https://api.example.com/item/1');
          res.send('deleted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('axios:delete');
    });
  });

  describe('Monotonic Risk Rule', () => {
    it('raises POST (write) to destructive if delete is called', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await prisma.user.delete({ where: { id: 1 } });
          res.send('deleted');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'write');
      expect(result.effect).toBe('destructive');
      expect(result.effectEvidence?.signal).toBe('prisma:delete');
    });

    it('never lowers POST (write) to read when handler only reads', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          const user = await User.findById(req.body.id);
          res.json(user);
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'write');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence).toBeUndefined();
    });

    it('never lowers DELETE (destructive) to write or read', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          await User.create(req.body);
          res.json({ ok: true });
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'destructive');
      expect(result.effect).toBe('destructive');
    });

    it('unknown effect stays unknown when no evidence', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          res.send('hello');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'unknown');
      expect(result.effect).toBe('unknown');
      expect(result.effectEvidence).toBeUndefined();
    });
  });

  describe('Non-classified calls & guards', () => {
    it('does not classify Map.delete or Set.delete as destructive', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          const map = new Map();
          map.delete('key');
          res.send('ok');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('read');
      expect(result.effectEvidence).toBeUndefined();
    });

    it('does not classify Object.create as write', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          const obj = Object.create(null);
          res.json(obj);
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('read');
      expect(result.effectEvidence).toBeUndefined();
    });

    it('does not classify unknown function calls', () => {
      const { ast, fnNode } = parseSnippet(`
        async function handler(req, res) {
          doSomethingUnknown(req.body);
          res.send('ok');
        }
      `);
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('read');
      expect(result.effectEvidence).toBeUndefined();
    });
  });

  describe('1-hop helper function call in handler', () => {
    it('detects write inside a local helper function called by handler', () => {
      const code = `
        async function handler(req, res) {
          await persistData(req.body);
          res.send('done');
        }
        async function persistData(data) {
          await User.create(data);
        }
      `;
      const ast = parse(code, { sourceType: 'module' });
      const fnNode = ast.program.body[0] as FunctionDeclaration;
      const result = inferEffectFromHandler(fnNode, ast, 'app.js', 'read');
      expect(result.effect).toBe('write');
      expect(result.effectEvidence?.signal).toBe('mongoose:create');
    });
  });
});
