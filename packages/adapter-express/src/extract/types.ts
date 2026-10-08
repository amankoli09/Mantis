import type { Diagnostic, Endpoint, ParamDefinition } from '@devguard/core';

export interface PendingRouterRoute {
  method: string;
  routePath: string;
  startLine: number;
  startCol?: number;
  snippet?: string;
  isDynamic: boolean;
  rawExpr?: string;
  inferredParams?: ParamDefinition[];
}

export interface ExtractedMount {
  prefix: string;
  line: number;
  column?: number;
  mountFilePath: string;
  sourceRouterId?: string;
  target:
    | { type: 'identifier'; name: string }
    | { type: 'member'; objectName: string; propertyName: string }
    | { type: 'require'; specifier: string };
}

export interface ExtractedRouter {
  id: string;
  relFile: string;
  filePathForProvenance: string;
  varName: string;
  declLine: number;
  declCol?: number;
  routes: PendingRouterRoute[];
  mounts: Array<{ prefix: string; line: number; mountFilePath: string }>;
}

export interface FileDeclarations {
  relFile: string;
  filePathForProvenance: string;
  directEndpoints: Endpoint[];
  routers: Map<string, ExtractedRouter>;
  mounts: ExtractedMount[];
  diagnostics: Diagnostic[];
}

export interface ExtractRoutesResult {
  endpoints: Endpoint[];
  diagnostics: Diagnostic[];
}
