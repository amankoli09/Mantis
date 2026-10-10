import type { GeneratorPlugin } from '../plugins/types.js';
import { validBaselineGenerator } from './valid-baseline.js';
import { emptyBodyGenerator } from './empty-body.js';
import { missingFieldGenerator } from './missing-field.js';
import { wrongTypeGenerator } from './wrong-type.js';
import { boundaryValueGenerator } from './boundary-values.js';

export * from './valid-baseline.js';
export * from './empty-body.js';
export * from './missing-field.js';
export * from './wrong-type.js';
export * from './boundary-values.js';

export const BUILTIN_GENERATORS: GeneratorPlugin[] = [
  validBaselineGenerator,
  emptyBodyGenerator,
  missingFieldGenerator,
  wrongTypeGenerator,
  boundaryValueGenerator,
];
