export class BrebError extends Error {
  body?: Record<string, unknown>;
  code: string;
  status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
    body?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BrebError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export function isBrebError(error: unknown): error is BrebError {
  return error instanceof BrebError;
}
