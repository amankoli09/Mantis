import _traverse, { type TraverseOptions } from '@babel/traverse';
import type { File, Node, CallExpression, MemberExpression, Expression } from '@babel/types';
import type { Effect, EffectEvidence } from '@mantis/core';

type TraverseFn = (parent: Node | Node[], opts?: TraverseOptions) => void;

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? (_traverse as unknown as TraverseFn)
    : ((_traverse as unknown as { default: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

const EFFECT_RANK: Record<Effect, number> = {
  unknown: 0,
  read: 1,
  write: 2,
  destructive: 3,
};

interface DetectedSignal {
  effect: 'write' | 'destructive';
  signal: string;
  line: number;
}

export interface EffectInferenceResult {
  effect: Effect;
  effectEvidence?: EffectEvidence;
}

const PRISMA_WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  '$executeRaw',
  '$executeRawUnsafe',
]);

const PRISMA_DESTRUCTIVE_METHODS = new Set([
  'delete',
  'deleteMany',
]);

const MONGOOSE_WRITE_METHODS = new Set([
  'create',
  'insertMany',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'save',
]);

const MONGOOSE_DESTRUCTIVE_METHODS = new Set([
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
  'findOneAndRemove',
  'findByIdAndRemove',
  'remove',
]);

const SEQUELIZE_WRITE_METHODS = new Set([
  'create',
  'bulkCreate',
  'update',
  'upsert',
  'save',
]);

const SEQUELIZE_DESTRUCTIVE_METHODS = new Set([
  'destroy',
  'truncate',
]);

const KNEX_WRITE_METHODS = new Set([
  'insert',
  'update',
]);

const KNEX_DESTRUCTIVE_METHODS = new Set([
  'del',
  'delete',
  'truncate',
]);

const FS_WRITE_METHODS = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
]);

const FS_DESTRUCTIVE_METHODS = new Set([
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
]);

function isKnexChain(expr: Expression): boolean {
  let curr: Expression = expr;
  while (curr) {
    if (curr.type === 'CallExpression') {
      if (
        curr.callee.type === 'Identifier' &&
        ['knex', 'db', 'trx'].includes(curr.callee.name.toLowerCase())
      ) {
        return true;
      }
      if (curr.callee.type === 'MemberExpression') {
        curr = curr.callee.object as Expression;
        continue;
      }
    } else if (curr.type === 'MemberExpression') {
      curr = curr.object as Expression;
      continue;
    } else if (curr.type === 'Identifier') {
      if (['knex', 'db', 'trx'].includes(curr.name.toLowerCase())) return true;
    }
    break;
  }
  return false;
}

function getMemberChain(expr: Expression): string[] {
  const parts: string[] = [];
  let curr: Expression = expr;
  while (curr.type === 'MemberExpression') {
    const member = curr as MemberExpression;
    if (member.property.type === 'Identifier') {
      parts.unshift(member.property.name);
    } else if (member.property.type === 'StringLiteral') {
      parts.unshift(member.property.value);
    }
    curr = member.object as Expression;
  }
  if (curr.type === 'Identifier') {
    parts.unshift(curr.name);
  }
  return parts;
}

function detectSignalFromCall(node: CallExpression): DetectedSignal | null {
  const line = node.loc?.start.line ?? 1;

  // 1. fetch(url, { method: 'POST' })
  if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
    if (node.arguments.length >= 2 && node.arguments[1]?.type === 'ObjectExpression') {
      const optsObj = node.arguments[1];
      for (const prop of optsObj.properties) {
        if (
          prop.type === 'ObjectProperty' &&
          ((prop.key.type === 'Identifier' && prop.key.name === 'method') ||
            (prop.key.type === 'StringLiteral' && prop.key.value === 'method')) &&
          prop.value.type === 'StringLiteral'
        ) {
          const methodVal = prop.value.value.toUpperCase();
          if (methodVal === 'DELETE') {
            return { effect: 'destructive', signal: 'fetch:DELETE', line };
          }
          if (['POST', 'PUT', 'PATCH'].includes(methodVal)) {
            return { effect: 'write', signal: `fetch:${methodVal}`, line };
          }
        }
      }
    }
    return null;
  }

  // 2. Direct function calls for fs (e.g. writeFile(path, data), unlink(path))
  if (node.callee.type === 'Identifier') {
    const fnName = node.callee.name;
    if (FS_DESTRUCTIVE_METHODS.has(fnName)) {
      return { effect: 'destructive', signal: `fs:${fnName}`, line };
    }
    if (FS_WRITE_METHODS.has(fnName)) {
      return { effect: 'write', signal: `fs:${fnName}`, line };
    }
    return null;
  }

  // MemberExpression calls: obj.method(...)
  if (node.callee.type === 'MemberExpression') {
    const memberExpr = node.callee;
    const propName =
      memberExpr.property.type === 'Identifier'
        ? memberExpr.property.name
        : memberExpr.property.type === 'StringLiteral'
          ? memberExpr.property.value
          : null;

    if (!propName) return null;

    const chain = getMemberChain(memberExpr.object as Expression);
    const objectRoot = chain[0] ?? '';
    const objectFullName = chain.join('.');

    // A. Node.js fs methods: fs.writeFile, fsPromises.unlink, etc.
    if (
      objectRoot === 'fs' ||
      objectRoot === 'fsPromises' ||
      objectRoot === 'promises' ||
      chain.includes('fs')
    ) {
      if (FS_DESTRUCTIVE_METHODS.has(propName)) {
        return { effect: 'destructive', signal: `fs:${propName}`, line };
      }
      if (FS_WRITE_METHODS.has(propName)) {
        return { effect: 'write', signal: `fs:${propName}`, line };
      }
    }

    // B. Axios calls: axios.post, axios.delete, etc.
    if (objectRoot.toLowerCase().includes('axios') || chain.includes('axios')) {
      const lowerProp = propName.toLowerCase();
      if (lowerProp === 'delete') {
        return { effect: 'destructive', signal: 'axios:delete', line };
      }
      if (['post', 'put', 'patch'].includes(lowerProp)) {
        return { effect: 'write', signal: `axios:${lowerProp}`, line };
      }
    }

    // C. Postgres: client.query(sql), pool.query(sql), db.query(sql)
    if (propName === 'query' && node.arguments.length > 0) {
      const firstArg = node.arguments[0];
      let sqlText: string | null = null;
      if (firstArg?.type === 'StringLiteral') {
        sqlText = firstArg.value.trim();
      } else if (firstArg?.type === 'TemplateLiteral' && firstArg.quasis.length > 0) {
        sqlText = (firstArg.quasis[0]?.value.raw ?? '').trim();
      }

      if (sqlText) {
        const firstWord = sqlText.split(/\s+/)[0]?.toUpperCase() ?? '';
        if (['DELETE', 'DROP', 'TRUNCATE'].includes(firstWord)) {
          return { effect: 'destructive', signal: `pg:query:${firstWord.toLowerCase()}`, line };
        }
        if (['INSERT', 'UPDATE'].includes(firstWord)) {
          return { effect: 'write', signal: `pg:query:${firstWord.toLowerCase()}`, line };
        }
      }
    }

    // D. Prisma calls: prisma.user.create, db.user.delete, prisma.$executeRaw
    if (
      objectRoot.toLowerCase().includes('prisma') ||
      objectFullName.toLowerCase().includes('prisma')
    ) {
      if (PRISMA_DESTRUCTIVE_METHODS.has(propName)) {
        return { effect: 'destructive', signal: `prisma:${propName}`, line };
      }
      if (PRISMA_WRITE_METHODS.has(propName)) {
        return { effect: 'write', signal: `prisma:${propName}`, line };
      }
    }

    // E. Knex calls: knex('users').insert(...), knex('users').where('id', 1).del()
    if (isKnexChain(memberExpr.object as Expression)) {
      if (KNEX_DESTRUCTIVE_METHODS.has(propName)) {
        return { effect: 'destructive', signal: `knex:${propName}`, line };
      }
      if (KNEX_WRITE_METHODS.has(propName)) {
        return { effect: 'write', signal: `knex:${propName}`, line };
      }
    }

    // F. Sequelize specific methods: bulkCreate, destroy, truncate
    if (SEQUELIZE_DESTRUCTIVE_METHODS.has(propName)) {
      return { effect: 'destructive', signal: `sequelize:${propName}`, line };
    }
    if (SEQUELIZE_WRITE_METHODS.has(propName) && (propName === 'bulkCreate' || (propName === 'upsert' && !objectRoot.includes('prisma')))) {
      return { effect: 'write', signal: `sequelize:${propName}`, line };
    }

    // Guard against built-ins: Object, Array, Map, Set, JSON, Math, Promise, console, res, req
    const isExcludedObject = [
      'object',
      'array',
      'map',
      'set',
      'mymap',
      'myset',
      'cache',
      'headers',
      'params',
      'query',
      'res',
      'req',
      'console',
      'json',
      'math',
      'promise',
      'reflect',
    ].includes(objectRoot.toLowerCase());

    if (isExcludedObject) {
      return null;
    }

    // G. Mongoose Model or Document methods
    if (MONGOOSE_DESTRUCTIVE_METHODS.has(propName)) {
      return { effect: 'destructive', signal: `mongoose:${propName}`, line };
    }
    if (MONGOOSE_WRITE_METHODS.has(propName)) {
      return { effect: 'write', signal: `mongoose:${propName}`, line };
    }

    // H. General DB / ORM methods: .save(), .create(), .update(), .insert(), .delete(), .del()
    if (['delete', 'del'].includes(propName)) {
      return { effect: 'destructive', signal: `db:${propName}`, line };
    }
    if (['insert', 'update', 'save', 'create'].includes(propName)) {
      return { effect: 'write', signal: `db:${propName}`, line };
    }
  }

  return null;
}

/**
 * Finds local helper function declarations in the same file AST.
 */
function findLocalFunction(fnName: string, ast: File): Node | null {
  for (const stmt of ast.program.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === fnName) {
      return stmt;
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (
          decl.id.type === 'Identifier' &&
          decl.id.name === fnName &&
          decl.init &&
          (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')
        ) {
          return decl.init;
        }
      }
    }
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
      const decl = stmt.declaration;
      if (decl.type === 'FunctionDeclaration' && decl.id?.name === fnName) {
        return decl;
      }
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (
            d.id.type === 'Identifier' &&
            d.id.name === fnName &&
            d.init &&
            (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression')
          ) {
            return d.init;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Traverses a handler function body (and 1-hop local helpers called by it)
 * to detect evidence of database or filesystem mutation operations.
 */
export function inferEffectFromHandler(
  fnNode: Node,
  fnAst: File,
  handlerFilePathForProvenance: string,
  baselineEffect: Effect
): EffectInferenceResult {
  const detectedSignals: DetectedSignal[] = [];
  const visitedFunctions = new Set<Node>();

  function collectSignalsFromNode(targetNode: Node) {
    if (visitedFunctions.has(targetNode)) return;
    visitedFunctions.add(targetNode);

    traverse(fnAst, {
      Function(path) {
        if (path.node !== targetNode) return;

        // Traverse only the subtree of this function
        path.traverse({
          CallExpression(callPath) {
            const sig = detectSignalFromCall(callPath.node);
            if (sig) {
              detectedSignals.push(sig);
            } else if (
              callPath.node.callee.type === 'Identifier' &&
              visitedFunctions.size <= 2 // Allow 1-hop helper call
            ) {
              // Check if it's a local helper function call
              const helperName = callPath.node.callee.name;
              const helperNode = findLocalFunction(helperName, fnAst);
              if (helperNode && !visitedFunctions.has(helperNode)) {
                collectSignalsFromNode(helperNode);
              }
            }
          },
        });
      },
    });
  }

  collectSignalsFromNode(fnNode);

  if (detectedSignals.length === 0) {
    return { effect: baselineEffect };
  }

  // Find the signal with the highest risk rank.
  // In case of ties, preserve the first encountered (lowest line).
  let highestSignal: DetectedSignal = detectedSignals[0]!;
  for (let i = 1; i < detectedSignals.length; i++) {
    const candidate = detectedSignals[i]!;
    if (EFFECT_RANK[candidate.effect] > EFFECT_RANK[highestSignal.effect]) {
      highestSignal = candidate;
    }
  }

  const highestRiskRank = EFFECT_RANK[highestSignal.effect];
  const baselineRiskRank = EFFECT_RANK[baselineEffect];

  // Rule: evidence can raise the risk level, never lower it.
  if (highestRiskRank > baselineRiskRank) {
    return {
      effect: highestSignal.effect,
      effectEvidence: {
        filePath: handlerFilePathForProvenance,
        line: highestSignal.line,
        signal: highestSignal.signal,
      },
    };
  }

  // If evidence matches baseline (e.g. baseline is write and handler has write evidence),
  // we attach effectEvidence to provide provenance for the write.
  if (highestRiskRank === baselineRiskRank && (baselineEffect === 'write' || baselineEffect === 'destructive')) {
    return {
      effect: baselineEffect,
      effectEvidence: {
        filePath: handlerFilePathForProvenance,
        line: highestSignal.line,
        signal: highestSignal.signal,
      },
    };
  }

  // Otherwise, risk would be lowered (or no positive raise), so keep baseline without evidence.
  return { effect: baselineEffect };
}
