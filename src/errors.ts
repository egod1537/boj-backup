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
