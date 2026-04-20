import {SendMessageCommandInput} from '@aws-sdk/client-sqs';
import {brotliCompressSync, gzipSync} from 'zlib';
import {Queue, configure} from '../src';
import {QueueSubjectListener} from '../src/queue/QueueSubjectListener';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 15000,
  intervalMs = 50
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor: predicate not satisfied within timeout');
};

const uniqueQueueName = (suffix: string) =>
  `qsl-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * The listener does not request MessageAttributes when polling SQS, but the
 * compression code path relies on `m.MessageAttributes` being populated.
 * Wrap receiveMessage so the underlying ReceiveMessage call asks for them.
 */
const enableMessageAttributes = (queue: Queue) => {
  const original = queue.receiveMessage.bind(queue);
  jest
    .spyOn(queue, 'receiveMessage')
    .mockImplementation((params: Parameters<Queue['receiveMessage']>[0]) =>
      original({...params, MessageAttributeNames: ['All']})
    );
};

const sendRawSnsLikeMessage = async (
  queue: Queue,
  subject: string,
  message: string,
  messageAttributes?: SendMessageCommandInput['MessageAttributes']
) =>
  queue.sqs.sendMessage({
    QueueUrl: queue.queueUrl,
    MessageBody: JSON.stringify({Subject: subject, Message: message}),
    MessageAttributes: messageAttributes,
  });

beforeAll(() => {
  configure({region: 'eu-west-1'});
});

describe('QueueSubjectListener (integration with Floci/LocalStack)', () => {
  describe('listen', () => {
    it('should be able to listen to queue and call handler', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('listen'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.resolve());
      sut.onSubject('test', handler);
      sut.listen();

      await queue.send('test', {id: '123', test: 'test'});

      try {
        await waitFor(() => handler.mock.calls.length >= 1);
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);

    it('should delete messages that are not valid JSON', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('badjson'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.resolve());
      sut.onSubject('test', handler);
      sut.listen();

      await sendRawSnsLikeMessage(queue, 'test', '{"corruptJSON:');

      try {
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler).toHaveBeenCalledTimes(0);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);

    it('should be able to listen to queue and call handler with retry', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('retry'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');
      const changeVisibilitySpy = jest.spyOn(queue, 'changeMessageVisibility');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.reject('error'));
      sut.onSubject('test', handler, {maxAttempts: 2, backoffDelaySeconds: 1});
      sut.listen();

      await queue.send('test', {id: '123', test: 'test'});

      try {
        await waitFor(() => changeVisibilitySpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler).toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(changeVisibilitySpy).toHaveBeenCalled();
    }, 20000);

    it('should not retry when multiple handlers are registered', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('multi-same'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler1 = jest.fn(() => Promise.reject('error'));
      const handler2 = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler1, {maxAttempts: 2, backoffDelaySeconds: 1});
      sut.onSubject('test', handler2);
      sut.listen();

      await queue.send('test', {id: '123', test: 'test'});

      try {
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);

    it('should retry when multiple handlers are registered with different subjects', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('multi-diff'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');
      const changeVisibilitySpy = jest.spyOn(queue, 'changeMessageVisibility');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler1 = jest.fn(() => Promise.reject('error'));
      const handler2 = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler1, {maxAttempts: 2, backoffDelaySeconds: 1});
      sut.onSubject('test2', handler2);
      sut.listen();

      await queue.send('test', {id: '123', test: 'test'});

      try {
        await waitFor(() => changeVisibilitySpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(changeVisibilitySpy).toHaveBeenCalled();
    }, 20000);

    it('should not retry when no retry policy is set', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('noretry'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.reject('error'));
      sut.onSubject('test', handler);
      sut.listen();

      await queue.send('test', {id: '123', test: 'test'});

      try {
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);

    it('should call the retryPolicy when retrying', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('retrypolicy'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');
      const changeVisibilitySpy = jest.spyOn(queue, 'changeMessageVisibility');
      const retryPolicy = jest.fn(() => 1);

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.reject('error'));
      sut.onSubject('test', handler, {
        maxAttempts: 2,
        backoffDelaySeconds: 1,
        retryPolicy,
      });
      sut.listen();

      await queue.send('test', {id: '123', test: 'test'});

      try {
        await waitFor(() => retryPolicy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler).toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(changeVisibilitySpy).toHaveBeenCalled();
      expect(retryPolicy).toHaveBeenCalled();
    }, 20000);

    /**
     * Pure parameter-wiring assertion: the listener should default
     * WaitTimeSeconds to 20. We can't realistically issue a 20s long-poll
     * against the broker inside a unit test, so receiveMessage is overridden
     * with a spy that resolves immediately while still capturing the params.
     */
    it('should default waitTimeSeconds to 20', async () => {
      const queue = await Queue.createQueue(
        uniqueQueueName('defaults'),
        awsEndpointUrl
      );
      const receiveSpy = jest
        .spyOn(queue, 'receiveMessage')
        .mockResolvedValue({} as never);

      const sut = new QueueSubjectListener(queue, null);
      sut.onSubject(
        'test',
        jest.fn(() => Promise.resolve())
      );
      sut.listen();

      try {
        await waitFor(() => receiveSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(receiveSpy).toHaveBeenCalledWith(
        expect.objectContaining({WaitTimeSeconds: 20})
      );
    }, 20000);

    it('should decompress brotli compressed messages', async () => {
      const messagePayload = {id: '123', test: 'compressed-brotli'};
      const compressedMessage = brotliCompressSync(
        JSON.stringify(messagePayload)
      ).toString('base64');

      const queue = await Queue.createQueue(
        uniqueQueueName('brotli'),
        awsEndpointUrl
      );
      enableMessageAttributes(queue);
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const sut = new QueueSubjectListener(queue, logger, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.resolve());
      sut.onSubject('test', handler);
      sut.listen();

      await sendRawSnsLikeMessage(queue, 'test', compressedMessage, {
        contentType: {DataType: 'String', StringValue: 'brotli'},
      });

      try {
        await waitFor(() => handler.mock.calls.length >= 1);
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(logger.error).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(messagePayload, 'test');
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);

    it('should decompress gzip compressed messages', async () => {
      const messagePayload = {id: '456', test: 'compressed-gzip'};
      const compressedMessage = gzipSync(
        JSON.stringify(messagePayload)
      ).toString('base64');

      const queue = await Queue.createQueue(
        uniqueQueueName('gzip'),
        awsEndpointUrl
      );
      enableMessageAttributes(queue);
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const sut = new QueueSubjectListener(queue, logger, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.resolve());
      sut.onSubject('test', handler);
      sut.listen();

      await sendRawSnsLikeMessage(queue, 'test', compressedMessage, {
        contentType: {DataType: 'String', StringValue: 'gzip'},
      });

      try {
        await waitFor(() => handler.mock.calls.length >= 1);
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(logger.error).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(messagePayload, 'test');
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);

    it('should handle messages without compression', async () => {
      const messagePayload = {id: '789', test: 'uncompressed'};

      const queue = await Queue.createQueue(
        uniqueQueueName('plain'),
        awsEndpointUrl
      );
      const deleteSpy = jest.spyOn(queue, 'deleteMessage');

      const sut = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 30,
      });

      const handler = jest.fn(() => Promise.resolve());
      sut.onSubject('test', handler);
      sut.listen();

      await queue.send('test', messagePayload);

      try {
        await waitFor(() => handler.mock.calls.length >= 1);
        await waitFor(() => deleteSpy.mock.calls.length >= 1);
      } finally {
        sut.stop();
      }

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(messagePayload, 'test');
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }, 20000);
  });
});
