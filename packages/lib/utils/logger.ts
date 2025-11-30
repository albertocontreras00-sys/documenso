/**
 * Safe logging utility for Documenso
 * 
 * Features:
 * - Type-safe logging that won't break builds
 * - Feature flag support (DEBUG_SIGN_FLOW)
 * - Safe JSON stringification for complex types
 * - No external dependencies
 */

const DEBUG_FLAG = process.env.DEBUG_SIGN_FLOW === 'true';

/**
 * Safely stringify a value, handling circular references and complex types
 */
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  // Create a new WeakSet for each stringify call to avoid cross-call contamination
  const seen = new WeakSet();

  try {
    return JSON.stringify(value, (key, val) => {
      // Handle circular references
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular Reference]';
        }
        seen.add(val);
      }
      return val;
    }, 2);
  } catch (error) {
    // Fallback for values that can't be stringified
    try {
      return String(value);
    } catch {
      return '[Unable to stringify]';
    }
  }
}

/**
 * Log debug information (only if DEBUG_SIGN_FLOW is enabled)
 */
export function logDebug(context: string, message: string, data?: unknown): void {
  if (!DEBUG_FLAG) return;

  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: 'DEBUG',
    context,
    message,
    ...(data !== undefined && { data: safeStringify(data) }),
  };

  console.log(JSON.stringify(logEntry));
}

/**
 * Log informational messages
 */
export function logInfo(context: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: 'INFO',
    context,
    message,
    ...(data !== undefined && { data: safeStringify(data) }),
  };

  console.log(JSON.stringify(logEntry));
}

/**
 * Log error messages
 */
export function logError(context: string, message: string, error?: unknown, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: 'ERROR',
    context,
    message,
    ...(error !== undefined && { 
      error: error instanceof Error 
        ? { message: error.message, stack: error.stack, name: error.name }
        : safeStringify(error)
    }),
    ...(data !== undefined && { data: safeStringify(data) }),
  };

  console.error(JSON.stringify(logEntry));
}

/**
 * Log warning messages
 */
export function logWarn(context: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: 'WARN',
    context,
    message,
    ...(data !== undefined && { data: safeStringify(data) }),
  };

  console.warn(JSON.stringify(logEntry));
}
