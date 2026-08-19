import {ILogger} from './ILogger';

type LogMethod = keyof ILogger;

type DispatchResult = 'dispatched' | 'absent' | 'failed';

const writeToConsole = (message: unknown) => {
  try {
    console.log(message);
  } catch {}
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';

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
    this.emit('log', [level, message], message);
  }

  debug(message: string) {
    this.emit('debug', [message], message);
  }

  info(message: string) {
    this.emit('info', [message], message);
  }

  warn(message: string) {
    this.emit('warn', [message], message);
  }

  error(message: string) {
    if (this.dispatch('error', [message], message) !== 'dispatched')
      writeToConsole(message);
  }

  private emit(name: LogMethod, args: string[], message: string) {
    if (this.dispatch(name, args, message) === 'failed') writeToConsole(message);
  }

  private dispatch(
    name: LogMethod,
    args: string[],
    message: string
  ): DispatchResult {
    try {
      const method = this._logger[name];
      if (typeof method !== 'function') return 'absent';

      const result = (method as (...args: string[]) => unknown).apply(
        this._logger,
        args
      );

      if (isThenable(result))
        result.then(undefined, () => this.onFailure(name, message));

      return 'dispatched';
    } catch {
      this.reportFailure(name);
      return 'failed';
    }
  }

  private onFailure(name: LogMethod, message: string) {
    this.reportFailure(name);
    writeToConsole(message);
  }

  private reportFailure(name: LogMethod) {
    if (this._reportedFailures.has(name)) return;
    this._reportedFailures.add(name);
    writeToConsole(
      `LoggerWrapper: supplied logger failed on "${name}", the call was dropped`
    );
  }
}
