module.exports = class ParaQLError extends Error {
  constructor(message, fn = ParaQLError, code = fn.name) {
    super(`${code}: ${message}`)

    this.code = code

    if (Error.captureStackTrace) Error.captureStackTrace(this, fn)
  }

  get name() {
    return "ParaQLError"
  }

  static ALREADY_CLOSED(message = "Database has already been closed") {
    return new ParaQLError(message, ParaQLError.ALREADY_CLOSED)
  }

  static INVALID_ARGUMENT(message) {
    return new ParaQLError(message, ParaQLError.INVALID_ARGUMENT)
  }

  static from(err) {
    if (err instanceof ParaQLError) return err

    if (err instanceof TypeError) {
      return ParaQLError.INVALID_ARGUMENT(err.message)
    }

    return new ParaQLError(err.message, ParaQLError.from, err.code || "ERROR")
  }
}
