import { z } from 'zod';
import { ProvenanceSchema } from './provenance.js';

export const DiagnosticCodeSchema = z.enum(['DG-P001', 'DG-R001', 'DG-R002', 'DG-R003', 'DG-I001']);
export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;

export const DiagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;

export const DiagnosticSchema = z.object({
  code: DiagnosticCodeSchema,
  severity: DiagnosticSeveritySchema,
  message: z.string().min(1, 'Diagnostic message must not be empty'),
  file: z.string().optional(),
  line: z.number().int().nonnegative('Line number must be non-negative').optional(),
  column: z.number().int().nonnegative('Column number must be non-negative').optional(),
  provenance: ProvenanceSchema.optional(),
  details: z.record(z.unknown()).optional(),
});

export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export interface DiagnosticDefinition<P = Record<string, unknown>> {
  code: DiagnosticCode;
  defaultSeverity: DiagnosticSeverity;
  title: string;
  template: (params: P) => string;
}

export type DiagnosticParamsMap = {
  'DG-P001': { file: string; reason: string };
  'DG-R001': { importPath: string; sourceFile: string };
  'DG-R002': { mountPath: string; routerIdentifier?: string };
  'DG-R003': { rawExpression: string };
  'DG-I001': { handlerName?: string; reason?: string };
};

export const DIAGNOSTICS_REGISTRY = {
  'DG-P001': {
    code: 'DG-P001',
    defaultSeverity: 'error',
    title: 'Parse Error',
    template: (params: { file: string; reason: string }) =>
      `Failed to parse file "${params.file}": ${params.reason}`,
  },
  'DG-R001': {
    code: 'DG-R001',
    defaultSeverity: 'warning',
    title: 'Unresolved Import',
    template: (params: { importPath: string; sourceFile: string }) =>
      `Could not resolve import "${params.importPath}" from "${params.sourceFile}"`,
  },
  'DG-R002': {
    code: 'DG-R002',
    defaultSeverity: 'warning',
    title: 'Unresolved Router Mount',
    template: (params: { mountPath: string; routerIdentifier?: string }) =>
      `Could not resolve router mounted at "${params.mountPath}"${params.routerIdentifier ? ` for identifier "${params.routerIdentifier}"` : ''}`,
  },
  'DG-R003': {
    code: 'DG-R003',
    defaultSeverity: 'info',
    title: 'Dynamic Path',
    template: (params: { rawExpression: string }) =>
      `Route path uses dynamic runtime expression: ${params.rawExpression}`,
  },
  'DG-I001': {
    code: 'DG-I001',
    defaultSeverity: 'info',
    title: 'Unresolved Handler',
    template: (params: { handlerName?: string; reason?: string }) =>
      `Route handler could not be statically resolved${params.handlerName ? `: ${params.handlerName}` : ''}${params.reason ? ` (${params.reason})` : ''}`,
  },
} as const satisfies { [K in DiagnosticCode]: DiagnosticDefinition<DiagnosticParamsMap[K]> };

export function createDiagnostic<C extends DiagnosticCode>(
  code: C,
  params: DiagnosticParamsMap[C],
  options?: {
    severity?: DiagnosticSeverity;
    file?: string;
    line?: number;
    column?: number;
    provenance?: z.infer<typeof ProvenanceSchema>;
    details?: Record<string, unknown>;
  },
): Diagnostic {
  const definition = DIAGNOSTICS_REGISTRY[code];
  const message = definition.template(params as never);

  const paramsObj = params as Record<string, unknown>;
  const inferredFile =
    typeof paramsObj.file === 'string'
      ? paramsObj.file
      : typeof paramsObj.sourceFile === 'string'
        ? paramsObj.sourceFile
        : undefined;

  const file = options?.file ?? options?.provenance?.filePath ?? inferredFile;
  const line = options?.line ?? options?.provenance?.line;
  const column = options?.column ?? options?.provenance?.column;

  return {
    code,
    severity: options?.severity ?? definition.defaultSeverity,
    message,
    ...(file !== undefined ? { file } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(options?.provenance ? { provenance: options.provenance } : {}),
    ...(options?.details ? { details: options.details } : {}),
  };
}
