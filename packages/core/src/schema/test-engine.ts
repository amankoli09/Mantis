import { z } from 'zod';
import { HttpMethodSchema } from './endpoint.js';
import { ProvenanceSchema } from './provenance.js';
import { RequestPlanSchema, ResponseResultSchema, SkipReasonSchema } from './runner.js';

export const ExpectedBehaviorSchema = z.enum(['should-accept', 'should-reject']);
export type ExpectedBehavior = z.infer<typeof ExpectedBehaviorSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  generatorId: z.string(),
  description: z.string(),
  expectedBehavior: ExpectedBehaviorSchema,
  request: RequestPlanSchema,
  baselineConfidence: z.enum(['high', 'low']).optional(),
  field: z.string().optional(),
  skip: SkipReasonSchema.optional(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestResultStatusSchema = z.enum(['passed', 'failed', 'skipped']);
export type TestResultStatus = z.infer<typeof TestResultStatusSchema>;

export const TestResultSchema = z.object({
  testId: z.string(),
  endpointId: z.string(),
  generatorId: z.string(),
  status: TestResultStatusSchema,
  skipReason: SkipReasonSchema.optional(),
  request: RequestPlanSchema,
  response: ResponseResultSchema.optional(),
  error: z.string().optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const FindingRequestExcerptSchema = z.object({
  method: HttpMethodSchema,
  path: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});
export type FindingRequestExcerpt = z.infer<typeof FindingRequestExcerptSchema>;

export const FindingResponseExcerptSchema = z.object({
  status: z.number().int().optional(),
  headers: z.record(z.string()).optional(),
  bodySnippet: z.string().optional(),
});
export type FindingResponseExcerpt = z.infer<typeof FindingResponseExcerptSchema>;

export const FindingEvidenceSchema = z.object({
  request: FindingRequestExcerptSchema,
  response: FindingResponseExcerptSchema,
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

export const FindingSourceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  fieldProvenance: ProvenanceSchema.extend({
    name: z.string().optional(),
  }).optional(),
});
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingSeveritySchema = z.enum(['error', 'warning', 'info']);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type FindingConfidence = z.infer<typeof FindingConfidenceSchema>;

export const FindingSchema = z.object({
  ruleId: z.string(),
  severity: FindingSeveritySchema,
  endpointId: z.string(),
  message: z.string(),
  evidence: FindingEvidenceSchema,
  source: FindingSourceSchema,
  confidence: FindingConfidenceSchema,
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReportSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const ReportMetaSchema = z.object({
  generatedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type ReportMeta = z.infer<typeof ReportMetaSchema>;

export const ReportSchema = z.object({
  reportVersion: z.literal('1.0.0'),
  summary: ReportSummarySchema,
  findings: z.array(FindingSchema),
  results: z.array(TestResultSchema),
  meta: ReportMetaSchema.optional(),
});
export type Report = z.infer<typeof ReportSchema>;

export function validateReport(data: unknown): {
  success: boolean;
  data?: Report;
  errors?: z.ZodIssue[];
} {
  const result = ReportSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}
