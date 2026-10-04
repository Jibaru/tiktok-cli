export const ERROR_CODES = {
  VALIDATION: 2,
  NOT_SUPPORTED: 2,
  APPROVAL_REQUIRED: 2,
  APPROVAL_DENIED: 2,
  KILLSWITCH: 2,
  CONSENT_REQUIRED: 2,
  AUTH_REQUIRED: 3,
  AUTH_EXPIRED: 3,
  CAPTCHA_REQUIRED: 4,
  RATE_LIMITED: 4,
  API_ERROR: 1,
  UI_CHANGED: 1,
  NETWORK: 1,
  INTERNAL: 1,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export type AppErrorDetails = {
  cause?: string;
  hint?: string;
  retryable?: boolean;
  logId?: string;
  tiktokCode?: number;
  debugBundle?: string;
  extra?: Record<string, unknown>;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: AppErrorDetails;

  constructor(code: ErrorCode, message: string, details: AppErrorDetails = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get exitCode(): number {
    return ERROR_CODES[this.code];
  }

  withDebugBundle(path: string): AppError {
    return new AppError(this.code, this.message, { ...this.details, debugBundle: path });
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      cause: this.details.cause,
      hint: this.details.hint,
      retryable: this.details.retryable ?? false,
      logId: this.details.logId,
      tiktokCode: this.details.tiktokCode,
      debugBundle: this.details.debugBundle,
      ...this.details.extra,
    };
  }
}

export function outcomeUnknown(error: unknown, verifyCommand: string): AppError {
  const original = toAppError(error);
  if (original.code === "API_ERROR") return original;
  return new AppError(original.code, `${original.message} The action was already submitted and may have gone through.`, {
    ...original.details,
    hint: `Verify with \`${verifyCommand}\` before retrying, to avoid a duplicate.`,
    retryable: false,
    extra: { ...original.details.extra, outcome: "unknown" },
  });
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.name === "TimeoutError") {
    return new AppError("UI_CHANGED", "An expected element did not appear in TikTok Studio.", {
      cause: firstLine(error.message),
      hint: "TikTok may have changed this page. Check the debug bundle screenshot.",
      retryable: true,
    });
  }
  if (error instanceof Error && /net::ERR_|ECONNRESET|ENOTFOUND|ETIMEDOUT/.test(error.message)) {
    return new AppError("NETWORK", "Could not reach TikTok.", {
      cause: error.message,
      hint: "Check your connection and retry.",
      retryable: true,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AppError("INTERNAL", "Unexpected error.", {
    cause: firstLine(message),
    hint: "Re-run with --debug and report the debug bundle.",
  });
}

function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).replace(/\u001b\[[0-9;]*m/g, "");
}
