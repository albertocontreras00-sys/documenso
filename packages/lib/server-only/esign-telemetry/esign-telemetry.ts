import type { ApiRequestMetadata } from '../../universal/extract-request-metadata';

/**
 * E-Signature Telemetry Helper (Sign Server)
 * 
 * Structured logging for e-signature flow observability in Datadog.
 * All e-sign events are logged with consistent keys for easy filtering.
 * 
 * Usage:
 *   import { logEsignEvent } from '@documenso/lib/server-only/esign-telemetry/esign-telemetry';
 *   
 *   await logEsignEvent({
 *     traceId: 'trace_123',
 *     step: 'sign_received_request',
 *     status: 'ok',
 *     orgId: 'org-uuid',
 *     documentId: 'doc-uuid'
 *   });
 */

/**
 * Log e-signature event with structured fields for Datadog
 * 
 * @param opts - Event options
 * @param opts.traceId - Trace ID for the e-sign flow (required)
 * @param opts.step - Step name (e.g. "sign_received_request") (required)
 * @param opts.status - Event status (optional, defaults to "ok")
 * @param opts.orgId - Organization UUID (optional)
 * @param opts.userId - User UUID (optional)
 * @param opts.documentId - Document UUID (optional)
 * @param opts.error - Error object or error message (optional)
 * @param opts.extra - Additional fields to include (optional)
 */
export async function logEsignEvent(opts: {
  traceId: string;
  step: string;
  status?: 'ok' | 'error';
  orgId?: string;
  userId?: string | number;
  documentId?: string | number;
  error?: unknown;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const {
    traceId,
    step,
    status = 'ok',
    orgId,
    userId,
    documentId,
    error,
    extra = {},
  } = opts;

  if (!traceId) {
    console.warn('[esignTelemetry] Missing traceId, skipping event');
    return;
  }

  if (!step) {
    console.warn('[esignTelemetry] Missing step, skipping event');
    return;
  }

  // Determine service name from environment or default
  const service = process.env.DD_SERVICE || 'conecta-sign';
  
  // Build structured log entry with consistent keys
  const logEntry: Record<string, unknown> = {
    // Core e-sign fields (always present)
    'esign.trace_id': traceId,
    'esign.step': step,
    'esign.status': status,
    'esign.service': service,
    
    // Context fields (if provided)
    ...(orgId && { 'org_id': orgId }),
    ...(userId && { 'user_id': String(userId) }),
    ...(documentId && { 'document_id': String(documentId) }),
    
    // Error field (if error provided)
    ...(error ? {
      'esign.error_message': error instanceof Error 
        ? error.message 
        : String(error)
    } : {}),
    
    // Extra fields (flattened with esign prefix where appropriate)
    ...Object.entries(extra).reduce((acc, [key, value]) => {
      // Preserve existing esign.* keys, add esign. prefix to others if they look like e-sign data
      if (key.startsWith('esign.') || key.startsWith('org_') || key.startsWith('user_') || key.startsWith('document_')) {
        acc[key] = value;
      } else {
        // For other fields, add esign. prefix to avoid conflicts
        acc[`esign.${key}`] = value;
      }
      return acc;
    }, {} as Record<string, unknown>)
  };

  // Log as structured JSON to stdout (Fly.io will forward to Datadog)
  // Use console.log with JSON.stringify for structured logging
  const logMessage = status === 'error' || error
    ? `[E-SIGN ERROR] ${step}`
    : `[E-SIGN] ${step}`;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: status === 'error' || error ? 'ERROR' : 'INFO',
    message: logMessage,
    ...logEntry,
  }));
}

/**
 * Helper to extract trace ID from various sources
 * Used to standardize trace ID extraction across the codebase
 * 
 * @param sources - Multiple potential sources for trace ID
 * @returns Trace ID or generated fallback
 */
export function extractTraceId(sources?: {
  traceId?: string;
  requestMetadata?: ApiRequestMetadata | { traceId?: string };
  meta?: { traceId?: string };
}): string {
  const { traceId, requestMetadata, meta } = sources || {};
  
  // Priority: explicit traceId > requestMetadata.traceId > meta.traceId > generated
  if (traceId) return traceId;
  if (requestMetadata && 'traceId' in requestMetadata && requestMetadata.traceId) {
    return requestMetadata.traceId;
  }
  if (meta?.traceId) return meta.traceId;
  
  // Generate fallback trace ID
  return `esign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

