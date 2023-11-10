import {ILogger} from './ILogger';

export class LoggerWrapper implements ILogger {
  private _logger: Partial<ILogger>;

  constructor(logger?: undefined | null | ILogger) {
    this._logger = logger || {};
  }

  log(level: string, message: string) {
    this._logger?.log && this._logger.log(level, message);
  }

  debug(message: string) {
    this._logger?.debug && this._logger.debug(message);
  }

  info(message: string) {
    this._logger?.info && this._logger.info(message);
  }

  error(message: string) {
    this._logger?.error ? this._logger.error(message) : console.log(message);
  }
}
