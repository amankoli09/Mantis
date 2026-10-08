import { z } from 'zod';
import { EndpointSchema } from './endpoint.js';
import { DiagnosticSchema } from './diagnostics.js';

export const ProjectSchema = z.object({
  name: z.string().optional(),
  framework: z.string().default('express'),
  language: z.string().default('javascript'),
  root: z.string().min(1, 'Project root path is required'),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ApiModelMetadataSchema = z.object({
  name: z.string().optional(),
  scannedAt: z.string().min(1, 'scannedAt timestamp is required').optional(),
  rootDir: z.string().min(1, 'rootDir is required').optional(),
});
export type ApiModelMetadata = z.infer<typeof ApiModelMetadataSchema>;

export const ApiModelSchema = z
  .object({
    modelVersion: z.enum(['1.0.0', '1.1.0', '1.2.0']).default('1.2.0'),
    project: ProjectSchema.optional(),
    metadata: ApiModelMetadataSchema.optional(),
    endpoints: z.array(EndpointSchema),
    diagnostics: z.array(DiagnosticSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (!data.project && !data.metadata?.rootDir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ApiModel must specify either "project.root" or "metadata.rootDir"',
        path: ['project'],
      });
    }
  });

export type ApiModel = z.infer<typeof ApiModelSchema>;

export interface ValidationErrorItem {
  path: string;
  message: string;
  code: string;
}

export type ValidationResult<T> =
  | { success: true; data: T; errors?: never }
  | { success: false; data?: never; errors: ValidationErrorItem[] };

export function validateModel(data: unknown): ValidationResult<ApiModel> {
  const result = ApiModelSchema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  const errors: ValidationErrorItem[] = result.error.errors.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
    code: issue.code,
  }));

  return {
    success: false,
    errors,
  };
}
