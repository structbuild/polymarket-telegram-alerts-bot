import { HttpError } from "@structbuild/sdk";

export type LogContext = Record<string, unknown>;

function serializeHeaders(headers: Headers | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const serialized: Record<string, string> = {};
  headers.forEach((value, key) => {
    serialized[key] = value;
  });
  return serialized;
}

function getErrorCause(error: Error): unknown {
  return "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
}

export function serializeError(error: unknown, depth = 0): Record<string, unknown> {
  if (depth >= 3) {
    return { message: "Error cause chain truncated." };
  }

  if (error instanceof HttpError) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      status: error.status,
      statusText: error.statusText,
      body: error.body,
      responseHeaders: serializeHeaders(error.responseHeaders),
    };

    const cause = getErrorCause(error);
    if (cause !== undefined) {
      serialized.cause = serializeError(cause, depth + 1);
    }

    return serialized;
  }

  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    for (const [key, value] of Object.entries(error as unknown as Record<string, unknown>)) {
      if (!(key in serialized)) {
        serialized[key] = value;
      }
    }

    const cause = getErrorCause(error);
    if (cause !== undefined) {
      serialized.cause = serializeError(cause, depth + 1);
    }

    return serialized;
  }

  if (typeof error === "object" && error !== null) {
    return { ...(error as Record<string, unknown>) };
  }

  return { value: error };
}

export function logError(message: string, context: LogContext = {}, error?: unknown): void {
  const payload: Record<string, unknown> = { ...context };
  if (error !== undefined) {
    payload.error = serializeError(error);
  }

  console.error(message, payload);
}
