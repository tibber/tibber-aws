import {Queue, configure, Topic} from '../src';
import {QueueSubjectListener} from '../src/queue/QueueSubjectListener';
import {brotliCompressSync, gzipSync} from 'zlib';

const awsEndpointURL = process.env.AWS_ENDPOINT_URL;

const messages = [
  {
    Body: JSON.stringify({
      Subject: 'test',
      Message: JSON.stringify({id: '123', test: 'test'}),
    }),
    ReceiptHandle: 'test',
  },
];

describe('QueueSubjectListener', () => {
  beforeAll(async () => {
    configure({region: 'eu-west-1'});
  });

  describe('listen', () => {
    it('should be able to listen to queue and call handler', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: messages,
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });

    it('should delete messages that are not valid JSON', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: [
            {
              Body: JSON.stringify({
                Subject: 'test',
                Message: '{"corruptJSON:',
              }),
              ReceiptHandle: 'test',
            },
          ],
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler).toHaveBeenCalledTimes(0);
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });

    it('should be able to listen to queue and call handler with retry', async () => {
      const queueName = 'test-retry-queueName';
      const subjectName = 'test_retry_subject';
      const topicName = 'test_retry_topic';
      const queue = await Queue.createQueue(queueName, awsEndpointURL);
      const listener = new QueueSubjectListener(queue, null, {
        maxConcurrentMessage: 1,
        visibilityTimeout: 5,
        waitTimeSeconds: 0,
      });

      const handler = jest.fn(() => Promise.reject('error'));

      listener.onSubject(subjectName, handler, {
        maxAttempts: 2,
        backoffDelaySeconds: 1,
      });

      listener.listen();

      const topic = await Topic.createTopic(
        topicName,
        subjectName,
        awsEndpointURL
      );
      await queue.subscribeTopic(topic);
      const event = {id: '123', test: 'test'};
      await topic.push(event);

      await new Promise(resolve => setTimeout(resolve, 6000));

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(event, subjectName);

      listener.stop();
    }, 15000);

    it('should not retry when multiple handlers are registered', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: messages,
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler1 = jest.fn(() => Promise.reject('error'));
      const handler2 = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler1, {maxAttempts: 2, backoffDelaySeconds: 1});
      sut.onSubject('test', handler2);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });

    it('should retry when multiple handlers are registered with different subjects', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: messages,
        }),
        deleteMessage: jest.fn(Promise.resolve),
        changeMessageVisibility: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler1 = jest.fn(() => Promise.reject('error'));
      const handler2 = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler1, {maxAttempts: 2, backoffDelaySeconds: 1});
      sut.onSubject('test2', handler2);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
      expect(queueMock.deleteMessage).not.toHaveBeenCalled();
      expect(queueMock.changeMessageVisibility).toHaveBeenCalledTimes(1);
    });

    it('should not retry when no retry policy is set', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: messages,
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.reject('error'));

      sut.onSubject('test', handler);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });

    it('should call the retryPolicy when retrying', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: messages,
        }),
        deleteMessage: jest.fn(Promise.resolve),
        changeMessageVisibility: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const retryPolicy = jest.fn(() => 1);

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.reject('error'));

      sut.onSubject('test', handler, {
        maxAttempts: 2,
        backoffDelaySeconds: 1,
        retryPolicy: retryPolicy,
      });
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(queueMock.deleteMessage).not.toHaveBeenCalled();
      expect(queueMock.changeMessageVisibility).toHaveBeenCalledTimes(1);
      expect(retryPolicy).toHaveBeenCalledTimes(1);
    });

    it('should default waitTimeSeconds to 20', async () => {
      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: messages,
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null);
      sut.onSubject(
        'test',
        jest.fn(() => Promise.resolve())
      );
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(queueMock.receiveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          WaitTimeSeconds: 20,
        })
      );
    });

    it('should decompress brotli compressed messages', async () => {
      const messagePayload = {id: '123', test: 'compressed-brotli'};
      const compressedMessage = brotliCompressSync(
        JSON.stringify(messagePayload)
      ).toString('base64');

      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: [
            {
              Body: JSON.stringify({
                Subject: 'test',
                Message: compressedMessage,
              }),
              ReceiptHandle: 'test',
              MessageAttributes: {
                contentType: {
                  StringValue: 'brotli',
                  DataType: 'String',
                },
              },
            },
          ],
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const sut = new QueueSubjectListener(queueMock, logger, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 100));
      sut.stop();

      expect(logger.error).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(messagePayload, 'test');
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });

    it('should decompress gzip compressed messages', async () => {
      const messagePayload = {id: '456', test: 'compressed-gzip'};
      const compressedMessage = gzipSync(
        JSON.stringify(messagePayload)
      ).toString('base64');

      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: [
            {
              Body: JSON.stringify({
                Subject: 'test',
                Message: compressedMessage,
              }),
              ReceiptHandle: 'test',
              MessageAttributes: {
                contentType: {
                  StringValue: 'gzip',
                  DataType: 'String',
                },
              },
            },
          ],
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const sut = new QueueSubjectListener(queueMock, logger, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 100));
      sut.stop();

      expect(logger.error).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(messagePayload, 'test');
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle messages without compression', async () => {
      const messagePayload = {id: '789', test: 'uncompressed'};

      const queueMock = {
        receiveMessage: jest.fn().mockResolvedValueOnce({
          Messages: [
            {
              Body: JSON.stringify({
                Subject: 'test',
                Message: JSON.stringify(messagePayload),
              }),
              ReceiptHandle: 'test',
            },
          ],
        }),
        deleteMessage: jest.fn(Promise.resolve),
      } as unknown as Queue;

      const sut = new QueueSubjectListener(queueMock, null, {
        maxConcurrentMessage: 1,
        waitTimeSeconds: 0,
        visibilityTimeout: 0,
        receiveTimeout: () => 0,
      });

      const handler = jest.fn(() => Promise.resolve());

      sut.onSubject('test', handler);
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(messagePayload, 'test');
      expect(queueMock.deleteMessage).toHaveBeenCalledTimes(1);
    });
  });
});
