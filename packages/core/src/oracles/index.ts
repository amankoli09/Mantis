import type { OraclePlugin } from '../plugins/types.js';
import { no5xxOnBadInputOracle } from './no-5xx-on-bad-input.js';
import { noStackTraceLeakOracle } from './no-stack-trace-leak.js';
import { noSensitiveFieldsOracle } from './no-sensitive-fields.js';
import { authEnforcedOracle } from './auth-enforced.js';

export * from './no-5xx-on-bad-input.js';
export * from './no-stack-trace-leak.js';
export * from './no-sensitive-fields.js';
export * from './auth-enforced.js';

export const BUILTIN_ORACLES: OraclePlugin[] = [
  no5xxOnBadInputOracle,
  noStackTraceLeakOracle,
  noSensitiveFieldsOracle,
  authEnforcedOracle,
];
