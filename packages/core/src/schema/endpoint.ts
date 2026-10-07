import { z } from 'zod';
import { ConfidenceSchema, ProvenanceSchema } from './provenance.js';
import { DiagnosticCodeSchema } from './diagnostics.js';

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const EffectSchema = z.enum(['read', 'write', 'destructive', 'unknown']);
export type Effect = z.infer<typeof EffectSchema>;

export const AuthTypeSchema = z.enum(['none', 'bearer', 'apiKey', 'cookie', 'custom', 'unknown']);
export type AuthType = z.infer<typeof AuthTypeSchema>;

export const AuthDefinitionSchema = z.object({
  type: AuthTypeSchema,
  details: z.string().optional(),
});
export type AuthDefinition = z.infer<typeof AuthDefinitionSchema>;

export const ParamLocationSchema = z.enum(['path', 'query', 'header', 'body']);
export type ParamLocation = z.infer<typeof ParamLocationSchema>;

export const ParamDefinitionSchema = z.object({
  name: z.string().min(1, 'Parameter name cannot be empty'),
  in: ParamLocationSchema,
  required: z.union([z.boolean(), z.literal('unknown')]).default('unknown'),
  type: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});
export type ParamDefinition = z.infer<typeof ParamDefinitionSchema>;

export const MountEntrySchema = z.object({
  filePath: z.string(),
  line: z.number().int().nonnegative(),
});
export type MountEntry = z.infer<typeof MountEntrySchema>;

export const RequestBodyDefinitionSchema = z.object({
  contentType: z.string().default('application/json'),
  schema: z.record(z.unknown()).optional(),
  required: z.boolean().default(false),
  description: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});
export type RequestBodyDefinition = z.infer<typeof RequestBodyDefinitionSchema>;

export const ResponseDefinitionSchema = z.object({
  statusCode: z.number().int().min(100).max(599),
  description: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
  contentType: z.string().optional(),
});
export type ResponseDefinition = z.infer<typeof ResponseDefinitionSchema>;

export const EndpointSchema = z
  .object({
    id: z.string().min(1, 'Endpoint ID cannot be empty'),
    method: HttpMethodSchema,
    path: z.string().min(1, 'Path cannot be empty'),
    description: z.string().optional(),
    auth: AuthDefinitionSchema.default({ type: 'unknown' }),
    effect: EffectSchema.default('unknown'),
    params: z.array(ParamDefinitionSchema).default([]),
    requestBody: RequestBodyDefinitionSchema.optional(),
    responses: z.array(ResponseDefinitionSchema).default([]),
    middleware: z.array(z.string()).default([]),
    mountChain: z.array(MountEntrySchema).optional(),
    provenance: ProvenanceSchema,
    confidence: ConfidenceSchema.default('confirmed'),
    confidenceReason: DiagnosticCodeSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.confidence === 'uncertain' && !data.confidenceReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Endpoints with confidence "uncertain" must specify a confidenceReason',
        path: ['confidenceReason'],
      });
    }
  });

export type Endpoint = z.infer<typeof EndpointSchema>;
