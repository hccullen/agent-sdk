/**
 * Base class for all errors thrown by this SDK.
 * Catch `AgentSDKError` to handle any SDK-originated failure.
 */
export class AgentSDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSDKError";
  }
}

/**
 * A JSON-RPC 2.0 error returned by the A2A endpoint.
 * The `code` is the numeric JSON-RPC error code; `data` carries optional
 * server-supplied context.
 */
export class RpcError extends AgentSDKError {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * An unexpected HTTP-level failure (non-2xx response) from the A2A endpoint.
 * The `status` is the HTTP status code.
 */
export class HttpError extends AgentSDKError {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
