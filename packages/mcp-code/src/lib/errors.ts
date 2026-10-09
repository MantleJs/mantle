import { MantleError } from "@mantlejs/mantle";

/** The script ran past `CodeLimits.timeoutMs` — a CPU loop (interrupt handler) or a bridged call that never settled (host timer). */
export class CodeTimeout extends MantleError {
  constructor(message = "Code execution timed out", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 408, "code-timeout", data, errors, hint);
  }
}

/** A `CodeLimits` cap other than time or output size was hit — bridged-call count, guest memory, or stack depth. */
export class CodeLimitExceeded extends MantleError {
  constructor(message = "Code execution limit exceeded", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 422, "code-limit-exceeded", data, errors, hint);
  }
}

/** The script's JSON-serialized return value exceeded `CodeLimits.maxOutputBytes`. */
export class CodeOutputTooLarge extends MantleError {
  constructor(message = "Code execution result is too large", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 413, "code-output-too-large", data, errors, hint);
  }
}

/**
 * The script itself failed — a syntax error, or an uncaught error that isn't a Mantle service
 * error (e.g. a `TypeError` from calling a method the API doesn't have). Uncaught *service*
 * errors (`Forbidden`, `NotFound`, …) surface as their own class instead.
 */
export class CodeScriptError extends MantleError {
  constructor(message = "Code execution failed", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 422, "code-script-error", data, errors, hint);
  }
}

/**
 * The executor itself failed — the sandbox engine threw on the host (e.g. a native stack
 * overflow from a `stackBytes` above the safe ceiling). The sandbox instance is discarded; the
 * host process is unaffected.
 */
export class CodeExecutorFault extends MantleError {
  constructor(message = "Code executor fault", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 500, "code-executor-fault", data, errors, hint);
  }
}
