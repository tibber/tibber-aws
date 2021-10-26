import {ReceiveMessageRequest} from 'aws-sdk/clients/sqs';
import {ILogger} from '../ILogger';
import {LoggerWrapper} from '../LoggerWrapper';
import {Queue} from './Queue';

export type QueueSubjectListenerOptions = {
  maxConcurrentMessage: number;
  visibilityTimeout: number;
  waitTimeSeconds: number;
  receiveTimeout?: () => number;
};

export type QueueSubjectListenerMessageHandler = {
  (message: unknown, subject: string): void;
};

export class QueueSubjectListener {
  public handlers: Record<
    string,
    Array<QueueSubjectListenerMessageHandler>
  > = {};
  public isStopped = false;

  public logger: ILogger;

  constructor(
    public queue: Queue,
    logger?: ILogger | undefined | null,
    public options: QueueSubjectListenerOptions = {
      maxConcurrentMessage: 1,
      waitTimeSeconds: 10,
      visibilityTimeout: 30,
    }
  ) {
    this.logger = new LoggerWrapper(logger);
  }

  stop() {
    this.isStopped = true;
  }

  onSubject(subjectName: string, handler: QueueSubjectListenerMessageHandler) {
    this.handlers[subjectName] = this.handlers[subjectName] || [];
    this.handlers[subjectName].push(handler);
  }

  listen(params: ReceiveMessageRequest) {
    const MaxNumberOfMessages =
      params?.MaxNumberOfMessages ?? this.options.maxConcurrentMessage;
    const VisibilityTimeout =
      params?.VisibilityTimeout ?? this.options.visibilityTimeout;
    const WaitTimeSeconds =
      params?.WaitTimeSeconds ?? this.options.waitTimeSeconds;
    const receiveTimeout = this.options.receiveTimeout;

    let cntInFlight = 0;

    const handlerFunc = async () => {
      try {
        if (this.isStopped) return;

        const maxNumberOfMessagesOrUndefined =
          MaxNumberOfMessages === undefined
            ? undefined
            : Math.min(10, MaxNumberOfMessages - cntInFlight);

        const currentParams = {
          MaxNumberOfMessages: maxNumberOfMessagesOrUndefined,
          VisibilityTimeout,
          WaitTimeSeconds,
        };

        const response = await this.queue.receiveMessage(currentParams);

        if (!response.Messages || response.Messages.length === 0) {
          setTimeout(handlerFunc, (receiveTimeout && receiveTimeout()) || 2000);
          return;
        }

        const messages = response.Messages.map(m => {
          if (m.Body === undefined)
            throw Error(
              `Message with ID '${m.MessageId}' has no Body defined.`
            );

          const json = JSON.parse(m.Body);

          try {
            return {
              handle: m.ReceiptHandle,
              message: {
                message: JSON.parse(json.Message),
                subject: json.Subject,
              },
            };
          } catch (error) {
            this.logger.error('Not able to parse event as json');
            return {handle: m.ReceiptHandle, message: {subject: 'Delete Me'}};
          }
        });

        cntInFlight += messages.length;

        const promises = messages.map(async m => {
          const {message, subject} = m.message;
          try {
            if (this.handlers[subject] || this.handlers['*']) {
              await Promise.all(
                (this.handlers[subject] || [])
                  .concat(this.handlers['*'] || [])
                  .map(async h => {
                    try {
                      await h(message, subject);
                    } catch (error) {
                      this.logger.error(error);
                    }
                  })
              );
            }
            if (!m.handle)
              throw Error("'handle' property on message was undefined.");

            await this.queue.deleteMessage(m.handle);

            this.logger.debug(
              `Message with subject "${m.message.subject}" deleted`
            );
          } catch (error) {
            this.logger.error(error);
          } finally {
            cntInFlight--;
          }
        });

        if (MaxNumberOfMessages === cntInFlight) {
          await Promise.race(promises);
        }
      } catch (err) {
        this.logger.error(err);
      }
      setTimeout(handlerFunc, (receiveTimeout && receiveTimeout()) || 10);
    };
    setTimeout(handlerFunc, (receiveTimeout && receiveTimeout()) || 10);
  }
}
