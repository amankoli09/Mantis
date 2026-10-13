import type { Node } from '@babel/types';
import type { Diagnostic, Endpoint, ParamDefinition, Provenance, Effect, EffectEvidence, RequestBodyDefinition } from '@mantis/core';

export interface ExtractedMiddleware {
  name: string;
  provenance: Provenance;
  resolved: boolean;
  fnNode?: Node;
  fnFilePath?: string;
  fnLine?: number;
  fnCode?: string;
}

export interface MiddlewareUsage {
  line: number;
  column?: number;
  middleware: ExtractedMiddleware;
}

export interface PendingRouterRoute {
  method: string;
  routePath: string;
  startLine: number;
  startCol?: number;
  snippet?: string;
  isDynamic: boolean;
  rawExpr?: string;
  inferredParams?: ParamDefinition[];
  requestBody?: RequestBodyDefinition;
  routeMiddlewares?: ExtractedMiddleware[];
  effect?: Effect;
  effectEvidence?: EffectEvidence;
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
  mountMiddlewares?: ExtractedMiddleware[];
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
  uses?: MiddlewareUsage[];
}

export interface FileDeclarations {
  relFile: string;
  filePathForProvenance: string;
  directEndpoints: Endpoint[];
  routers: Map<string, ExtractedRouter>;
  mounts: ExtractedMount[];
  diagnostics: Diagnostic[];
  appUses?: MiddlewareUsage[];
}

export interface ExtractRoutesResult {
  endpoints: Endpoint[];
  diagnostics: Diagnostic[];
}
