import { zodToJsonSchema } from 'zod-to-json-schema';
import { ApiModelSchema } from './model.js';
import { ReportSchema } from './test-engine.js';

/**
 * Returns the OpenAPI/JSON Schema (draft-07) representation of ApiModel.
 */
export function getApiModelJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ApiModelSchema, {
    name: 'ApiModel',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}

/**
 * Returns the OpenAPI/JSON Schema (draft-07) representation of Report.
 */
export function getReportJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ReportSchema, {
    name: 'Report',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}
