export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export class AuthenticationError extends Error {
  override name = "AuthenticationError";

  constructor(
    message: string,
    readonly code:
      | "CAPTCHA_REQUIRED"
      | "COOKIE_INVALID"
      | "INVALID_CREDENTIALS"
      | "LOGIN_FORM_NOT_FOUND"
      | "UNEXPECTED_RESPONSE"
      | "SESSION_NOT_VERIFIED",
  ) {
    super(message);
  }
}

export class StopRequestedError extends Error {
  override name = "StopRequestedError";

  constructor(message = "작업 중지 요청이 들어와 안전하게 정지했습니다.") {
    super(message);
  }
}

const TIMEOUT_ERROR_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "ERR_HTTP2_STREAM_ERROR"]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  ...TIMEOUT_ERROR_CODES,
  "ECONNRESET",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const RETRYABLE_NETWORK_ERROR_NAMES = new Set([
  "TimeoutError",
  "RequestError",
  "ReadError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "SocketError",
]);

export function isTimeoutLikeError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  if (!candidate) {
    return false;
  }

  const code = typeof candidate.code === "string" ? candidate.code : null;
  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return true;
  }

  const name = typeof candidate.name === "string" ? candidate.name : null;
  if (name === "TimeoutError" || name === "ConnectTimeoutError") {
    return true;
  }

  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (/timed out|timeout/i.test(message)) {
    return true;
  }

  return candidate.cause ? isTimeoutLikeError(candidate.cause) : false;
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (
    error instanceof StopRequestedError ||
    error instanceof ConfigurationError ||
    error instanceof AuthenticationError
  ) {
    return false;
  }

  const candidate = asErrorLike(error);
  if (!candidate) {
    return false;
  }

  if (isTimeoutLikeError(candidate)) {
    return true;
  }

  const code = typeof candidate.code === "string" ? candidate.code : null;
  if (code && RETRYABLE_NETWORK_ERROR_CODES.has(code)) {
    return true;
  }

  const name = typeof candidate.name === "string" ? candidate.name : null;
  if (name && RETRYABLE_NETWORK_ERROR_NAMES.has(name)) {
    return true;
  }

  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (/socket hang up|network error|connection reset|temporary failure/i.test(message)) {
    return true;
  }

  return candidate.cause ? isRetryableNetworkError(candidate.cause) : false;
}

function asErrorLike(
  error: unknown,
): { name?: unknown; code?: unknown; message?: unknown; cause?: unknown } | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  return error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
}
