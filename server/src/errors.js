/**
 * Single error shape used by both transports. REST turns it into an HTTP
 * status + JSON body; the WebSocket layer turns it into an `error` frame.
 * Anything thrown that is *not* an AppError is treated as a 500 bug.
 */
export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export const badRequest = (code, message) => new AppError(code, message, 400);
export const notFound = (code, message) => new AppError(code, message, 404);
/** 409 = the request was well-formed but the load is in the wrong state for it. */
export const conflict = (code, message) => new AppError(code, message, 409);
