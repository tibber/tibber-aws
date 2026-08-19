import {ILogger} from './ILogger';

type LogMethod = keyof ILogger;

const writeToConsole = (message: unknown) => {
  try {
    console.log(message);
  } catch {
    // nothing left to log with
  }
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';

/**
 * The logger is supplied by the consumer, so it is a trust boundary: a method
 * can be missing, not callable, throw, or return a rejecting promise. A pino
 * logger whose methods were copied off the instance, for example, loses the
 * symbol-keyed state they rely on and throws on every call.
 *
 * A method that fails is treated like a method that isn't there - the existing
 * contract extended from absent to broken: the call is dropped, except
 * `error`, which falls back to the console as it already did when `error` was
 * missing. Note that a broken logger therefore drops `debug`/`info`/`warn`
 * silently; the one-time diagnostic below is the signal that this happened.
 *
 * This is the wrapper's own contract rather than something each call site
 * guards: everything in this package that accepts a consumer-supplied logger
 * goes through here, so the guarantee is stated once instead of re-derived
 * per caller. A rejecting async logger could not be caught at the call site
 * in any case - it surfaces as an unhandled rejection.
 */
export class LoggerWrapper implements ILogger {
  private _logger: Partial<ILogger>;
  // one wrapper is built per logger, not per message, so this stays small
  private _reportedFailures = new Set<LogMethod>();

  constructor(logger?: undefined | null | ILogger) {
    this._logger =
      logger && (typeof logger === 'object' || typeof logger === 'function')
        ? logger
        : {};
  }

  log(level: string, message: string) {
    this.dispatch('log', [level, message], message);
  }

  debug(message: string) {
    this.dispatch('debug', [message], message);
  }

  info(message: string) {
    this.dispatch('info', [message], message);
  }

  warn(message: string) {
    this.dispatch('warn', [message], message);
  }

  error(message: string) {
    if (!this.dispatch('error', [message], message)) writeToConsole(message);
  }

  /**
   * Returns whether the call was dispatched, not whether it succeeded: an
   * async logger that rejects later reports through `onFailure` instead.
   */
  private dispatch(name: LogMethod, args: string[], message: string): boolean {
    try {
      // reading the property can throw on its own (getter, proxy)
      const method = this._logger[name];
      if (typeof method !== 'function') return false;

      const result = (method as (...args: string[]) => unknown).apply(
        this._logger,
        args
      );

      // a rejecting async logger would otherwise be an unhandled rejection,
      // which no try/catch around the call could absorb
      if (isThenable(result))
        result.then(undefined, () => this.onFailure(name, message));

      return true;
    } catch {
      this.reportFailure(name);
      return false;
    }
  }

  private onFailure(name: LogMethod, message: string) {
    this.reportFailure(name);
    if (name === 'error') writeToConsole(message);
  }

  private reportFailure(name: LogMethod) {
    if (this._reportedFailures.has(name)) return;
    this._reportedFailures.add(name);
    writeToConsole(
      `LoggerWrapper: supplied logger failed on "${name}", the call was dropped`
    );
  }
}
