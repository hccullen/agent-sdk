import type { components } from "./gen/api-v2.js";

type CommonErrorResponse = components["schemas"]["CommonErrorResponse"];
type A2AErrorResponse = components["schemas"]["A2AErrorResponse"];

export class CortiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CortiError";
  }
}

export class ManagementError extends CortiError {
  readonly code: string;
  readonly howToFix?: string;
  readonly requestId?: string;
  readonly details?: CommonErrorResponse["error"]["details"];

  constructor(error: CommonErrorResponse["error"]) {
    super(error.message);
    this.name = "ManagementError";
    this.code = error.code;
    this.howToFix = error.howToFix;
    this.requestId = error.requestId;
    this.details = error.details;
  }
}

export class A2AError extends CortiError {
  readonly code: number;
  readonly status: string;
  readonly details?: A2AErrorResponse["error"]["details"];

  constructor(error: A2AErrorResponse["error"]) {
    super(error.message);
    this.name = "A2AError";
    this.code = error.code;
    this.status = error.status;
    this.details = error.details;
  }
}

export class HttpError extends CortiError {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export async function throwFromResponse(response: Response, isA2A: boolean): Promise<never> {
  const status = response.status;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    throw new HttpError(status, `HTTP ${status}${text ? `: ${text}` : ""}`, text);
  }

  if (isA2A) {
    const a2aErr = body as A2AErrorResponse;
    if (a2aErr?.error?.code && a2aErr?.error?.status) {
      throw new A2AError(a2aErr.error);
    }
  } else {
    const mgmtErr = body as CommonErrorResponse;
    if (mgmtErr?.error?.code) {
      throw new ManagementError(mgmtErr.error);
    }
  }

  throw new HttpError(status, `HTTP ${status}`, body);
}

export function throwFromFetchError(
  error: unknown,
  response: Response,
  isA2A: boolean,
): never {
  const status = response.status;

  if (isA2A) {
    const a2aErr = error as A2AErrorResponse;
    if (a2aErr?.error?.code && a2aErr?.error?.status) {
      throw new A2AError(a2aErr.error);
    }
  } else {
    const mgmtErr = error as CommonErrorResponse;
    if (mgmtErr?.error?.code) {
      throw new ManagementError(mgmtErr.error);
    }
  }

  throw new HttpError(status, `HTTP ${status}`, error);
}
