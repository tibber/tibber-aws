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
 * The logger is supplied by the consumer, so it is untrusted: methods can be
 * missing, not callable, throw, or return a rejecting promise. None of that
 * may propagate - the queue listener logs from inside its own catch blocks,
 * and a throwing logger there takes down the poll loop.
 *
 * A method that fails is treated like a method that isn't there: silently
 * ignored, except for `error`, which falls back to the console. The first
 * failure per method is reported once so a broken logger stays visible
 * without spamming.
 */
export class LoggerWrapper implements ILogger {
  private _logger: Partial<ILogger>;
  private _reportedFailures = new Set<LogMethod>();

  constructor(logger?: undefined | null | ILogger) {
    this._logger =
      logger && (typeof logger === 'object' || typeof logger === 'function')
        ? logger
        : {};
  }

  log(level: string, message: string) {
    this.safeCall('log', [level, message], message);
  }

  debug(message: string) {
    this.safeCall('debug', [message], message);
  }

  info(message: string) {
    this.safeCall('info', [message], message);
  }

  warn(message: string) {
    this.safeCall('warn', [message], message);
  }

  error(message: string) {
    if (!this.safeCall('error', [message], message)) writeToConsole(message);
  }

  private safeCall(name: LogMethod, args: string[], message: string): boolean {
    let method: (...args: string[]) => unknown;

    try {
      // reading the property can throw on its own (getter, proxy)
      const candidate = this._logger[name];
      if (typeof candidate !== 'function') return false;
      method = candidate as (...args: string[]) => unknown;
    } catch {
      this.reportFailure(name);
      return false;
    }

    try {
      const result = method.apply(this._logger, args);

      // an async logger rejecting would otherwise be an unhandled rejection
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
