import {ILogger} from '../src/ILogger';
import {LoggerWrapper} from '../src/LoggerWrapper';

const levels: Array<(sut: LoggerWrapper) => void> = [
  sut => sut.log('info', 'message'),
  sut => sut.debug('message'),
  sut => sut.info('message'),
  sut => sut.warn('message'),
  sut => sut.error('message')
];

const callAllLevels = (sut: LoggerWrapper) => levels.forEach(call => call(sut));

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

describe('LoggerWrapper', () => {
  it('should delegate to a working logger', () => {
    const logger = {
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    callAllLevels(new LoggerWrapper(logger));

    expect(logger.log).toHaveBeenCalledWith('info', 'message');
    expect(logger.debug).toHaveBeenCalledWith('message');
    expect(logger.info).toHaveBeenCalledWith('message');
    expect(logger.warn).toHaveBeenCalledWith('message');
    expect(logger.error).toHaveBeenCalledWith('message');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should call methods with the logger as "this"', () => {
    const logger = {
      seen: [] as string[],
      log() {},
      debug() {},
      warn() {},
      error() {},
      info(message: string) {
        this.seen.push(message);
      }
    };

    new LoggerWrapper(logger).info('message');

    expect(logger.seen).toEqual(['message']);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not a logger'],
    ['a number', 42],
    ['an empty object', {}],
    [
      'non-callable properties',
      {log: 'x', debug: 1, info: {}, warn: [], error: true}
    ],
    [
      'methods that throw',
      {
        log: () => {
          throw new Error('boom');
        },
        debug: () => {
          throw new Error('boom');
        },
        info: () => {
          throw new Error('boom');
        },
        warn: () => {
          throw new Error('boom');
        },
        error: () => {
          throw new Error('boom');
        }
      }
    ]
  ])('should not throw when the logger is %s', (_, logger) => {
    const sut = new LoggerWrapper(logger as unknown as ILogger);

    expect(() => callAllLevels(sut)).not.toThrow();
  });

  it('should not throw when reading a method throws', () => {
    const logger = new Proxy({} as ILogger, {
      get() {
        throw new Error('boom');
      }
    });

    const sut = new LoggerWrapper(logger);

    expect(() => callAllLevels(sut)).not.toThrow();
  });

  it('should fall back to the console when "error" is missing', () => {
    new LoggerWrapper({} as ILogger).error('message');

    expect(consoleSpy).toHaveBeenCalledWith('message');
  });

  it('should fall back to the console when "error" throws', () => {
    const logger = {
      error: () => {
        throw new Error('boom');
      }
    } as unknown as ILogger;

    new LoggerWrapper(logger).error('message');

    expect(consoleSpy).toHaveBeenCalledWith('message');
  });

  it('should report a failing method once, not on every call', () => {
    const logger = {
      info: () => {
        throw new Error('boom');
      }
    } as unknown as ILogger;

    const sut = new LoggerWrapper(logger);
    sut.info('first');
    sut.info('second');

    const diagnostics = consoleSpy.mock.calls.filter(([written]) =>
      String(written).includes('"info"')
    );
    expect(diagnostics).toHaveLength(1);
  });

  it('should fall back to the console when any level throws', () => {
    const throwing = () => {
      throw new Error('boom');
    };
    const logger = {
      log: throwing,
      debug: throwing,
      info: throwing,
      warn: throwing,
      error: throwing
    } as unknown as ILogger;

    const sut = new LoggerWrapper(logger);
    sut.debug('debug message');
    sut.info('info message');
    sut.warn('warn message');
    sut.log('info', 'log message');

    expect(consoleSpy).toHaveBeenCalledWith('debug message');
    expect(consoleSpy).toHaveBeenCalledWith('info message');
    expect(consoleSpy).toHaveBeenCalledWith('warn message');
    expect(consoleSpy).toHaveBeenCalledWith('log message');
  });

  it('should stay silent when a level other than error is absent', () => {
    const sut = new LoggerWrapper({error: jest.fn()} as unknown as ILogger);
    sut.debug('message');
    sut.info('message');
    sut.warn('message');
    sut.log('info', 'message');

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should keep calling a method that failed earlier', () => {
    let shouldThrow = true;
    const info = jest.fn(() => {
      if (shouldThrow) throw new Error('boom');
    });

    const sut = new LoggerWrapper({info} as unknown as ILogger);
    sut.info('first');
    shouldThrow = false;
    sut.info('second');

    expect(info).toHaveBeenCalledTimes(2);
  });

  it('should swallow rejections from an async logger', async () => {
    const rejected = jest.fn(() => Promise.reject(new Error('boom')));
    const logger = {
      log: rejected,
      debug: rejected,
      info: rejected,
      warn: rejected,
      error: rejected
    } as unknown as ILogger;
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    try {
      callAllLevels(new LoggerWrapper(logger));
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('message');
  });

  it('should survive a detached pino-style logger', () => {
    const writeSym = Symbol('pino.write');
    const pinoProto = {
      error(this: Record<symbol, unknown>, message: string) {
        (this[writeSym] as (m: string) => string)(message);
      },
    };
    const pino = Object.create(pinoProto);
    pino[writeSym] = (message: string) => message;

    const detached = {error: pino.error} as unknown as ILogger;

    expect(() => detached.error('message')).toThrow(TypeError);
    expect(() => new LoggerWrapper(detached).error('message')).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith('message');
  });

  it('should pick up methods added to the logger after construction', () => {
    const logger = {} as ILogger;
    const sut = new LoggerWrapper(logger);

    logger.info = jest.fn();
    sut.info('message');

    expect(logger.info).toHaveBeenCalledWith('message');
  });
});
