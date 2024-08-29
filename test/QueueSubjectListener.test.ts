import {Queue} from '../src';
import {QueueSubjectListener} from '../src/queue/QueueSubjectListener';

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

    it('should be able to listen to queue and call handler with retry', async () => {
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

      const handler = jest.fn(() => Promise.reject('error'));

      sut.onSubject('test', handler, {maxAttempts: 2, backoffDelaySeconds: 1});
      sut.listen();

      await new Promise(resolve => setTimeout(resolve, 10));
      sut.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(queueMock.deleteMessage).not.toHaveBeenCalled();
      expect(queueMock.changeMessageVisibility).toHaveBeenCalledTimes(1);
    });

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
  });
});
