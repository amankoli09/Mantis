import { z } from 'zod';
import { EffectSchema, HttpMethodSchema } from './endpoint.js';

export const SkipReasonCodeSchema = z.enum([
  'disallowed-effect-unknown',
  'uncertain-endpoint',
  'explicitly-skipped',
  'effect-not-allowed',
  'no-sample-for-path-param',
]);
export type SkipReasonCode = z.infer<typeof SkipReasonCodeSchema>;

export const SkipReasonSchema = z.object({
  code: SkipReasonCodeSchema,
  message: z.string(),
  endpointId: z.string(),
  paramName: z.string().optional(),
});
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const RequestPlanSchema = z.object({
  endpointId: z.string(),
  method: HttpMethodSchema,
  url: z.string().url(),
  headers: z.record(z.string()),
  body: z.string().optional(),
  effect: EffectSchema,
});
export type RequestPlan = z.infer<typeof RequestPlanSchema>;

export const ResponseResultSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: z.string(),
  truncated: z.boolean(),
  byteLength: z.number().int().nonnegative(),
});
export type ResponseResult = z.infer<typeof ResponseResultSchema>;

export const ExecutionErrorSchema = z.object({
  kind: z.enum(['timeout', 'network', 'abort', 'other']),
  message: z.string(),
});
export type ExecutionError = z.infer<typeof ExecutionErrorSchema>;

export const ExecutionResultSchema = z.object({
  endpointId: z.string(),
  request: RequestPlanSchema,
  response: ResponseResultSchema.optional(),
  error: ExecutionErrorSchema.optional(),
  durationMs: z.number().nonnegative(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const RunnerLimitsSchema = z.object({
  timeoutMs: z.number().int().positive().default(5000),
  maxResponseBytes: z.number().int().positive().default(1024 * 1024),
  maxRequests: z.number().int().positive().default(50),
  concurrency: z.number().int().positive().default(5),
  retries: z.number().int().nonnegative().default(0),
});
export type RunnerLimits = z.infer<typeof RunnerLimitsSchema>;

export const RunnerAuthSchema = z.object({
  header: z.string().default('Authorization'),
  value: z.string().optional(),
  envVar: z.string().optional(),
});
export type RunnerAuth = z.infer<typeof RunnerAuthSchema>;

export const AllowedEffectSchema = z.enum(['read', 'write', 'destructive']);
export type AllowedEffect = z.infer<typeof AllowedEffectSchema>;

export const RunnerConfigSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  auth: RunnerAuthSchema.optional(),
  skip: z.array(z.string()).default([]),
  allowedEffects: z.array(AllowedEffectSchema).default(['read']),
  pathParamSamples: z.record(z.union([z.string(), z.number()])).default({}),
  limits: RunnerLimitsSchema.default({}),
  allowRemote: z.boolean().default(false),
  followRedirects: z.boolean().default(false),
  probePaths: z.array(z.string()).optional(),
});
export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;
export type RunnerConfigInput = z.input<typeof RunnerConfigSchema>;

export const SessionMetaSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  durationMs: z.number().nonnegative(),
  targetBaseUrl: z.string(),
  toolVersion: z.string().default('0.1.0'),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;

export const SessionSchema = z.object({
  meta: SessionMetaSchema,
  config: RunnerConfigSchema,
  requests: z.array(ExecutionResultSchema),
  skips: z.array(SkipReasonSchema),
});
export type Session = z.infer<typeof SessionSchema>;

export const DryRunResultSchema = z.object({
  plans: z.array(RequestPlanSchema),
  skips: z.array(SkipReasonSchema),
});
export type DryRunResult = z.infer<typeof DryRunResultSchema>;
