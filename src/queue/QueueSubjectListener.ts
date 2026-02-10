import {
  ReceiveMessageCommandInput,
  QueueAttributeName,
} from '@aws-sdk/client-sqs';
import {ILogger} from '../ILogger';
import {LoggerWrapper} from '../LoggerWrapper';
import {Queue} from './Queue';
import {brotliDecompress, gunzip} from 'zlib';
import {promisify} from 'util';

const MESSAGE_ATTRIBUTE_CONTENT_TYPE = 'contentType';
const COMPRESSTION_METHOD_BROTLI = 'brotli';
const COMPRESSTION_METHOD_GZIP = 'gzip';

export type QueueSubjectListenerOptions = {
  maxConcurrentMessage: number;
  visibilityTimeout: number;
  waitTimeSeconds: number;
  receiveTimeout?: () => number;
};

export type QueueSubjectListenerMessageHandler = {
  (message: unknown, subject: string): Promise<void>;
};

export type QueueSubjectListenerRetryPolicyOptions = {
  maxAttempts: number;
  backoffDelaySeconds: number;
  retryPolicy?: (
    attempt: number,
    backoffDelaySeconds: number,
    error: unknown
  ) => number;
};

export const LinearRetryPolicy = (
  attempt: number,
  backoffDelaySeconds: number
): number => backoffDelaySeconds * attempt;

export const ExponentialRetryPolicy = (
  attempt: number,
  backoffDelaySeconds: number
) => Math.pow(attempt, backoffDelaySeconds);

const brotliDecompressAsync = promisify(brotliDecompress);
const gunzipAsync = promisify(gunzip);

const decompressBrotli = async (base64Message: string) => {
  const buffer = Buffer.from(base64Message, 'base64');
  const decompressed = await brotliDecompressAsync(Uint8Array.from(buffer));
  return JSON.parse(decompressed.toString('utf-8'));
};

const decompressGzip = async (base64Message: string) => {
  const buffer = Buffer.from(base64Message, 'base64');
  const decompressed = await gunzipAsync(Uint8Array.from(buffer));
  return JSON.parse(decompressed.toString('utf-8'));
};

export class QueueSubjectListener {
  public handlers: Record<
    string,
    Array<{
      handler: QueueSubjectListenerMessageHandler;
      retryPolicyOptions?: QueueSubjectListenerRetryPolicyOptions;
    }>
  > = {};
  public isStopped = false;

  public logger: ILogger;

  constructor(
    public queue: Queue,
    logger?: undefined | null | ILogger,
    public options: QueueSubjectListenerOptions = {
      maxConcurrentMessage: 1,
      waitTimeSeconds: 20,
      visibilityTimeout: 30,
    }
  ) {
    this.logger = new LoggerWrapper(logger);
  }

  stop() {
    this.isStopped = true;
  }

  onSubject(
    subjectName: string,
    handler: QueueSubjectListenerMessageHandler,
    retryPolicyOptions?: QueueSubjectListenerRetryPolicyOptions
  ) {
    this.handlers[subjectName] = this.handlers[subjectName] || [];
    this.handlers[subjectName].push({
      handler,
      retryPolicyOptions: retryPolicyOptions
        ? {
            maxAttempts: retryPolicyOptions.maxAttempts || 3,
            backoffDelaySeconds: retryPolicyOptions.backoffDelaySeconds || 10,
            retryPolicy: retryPolicyOptions.retryPolicy || LinearRetryPolicy,
          }
        : undefined,
    });
  }

  listen(params?: ReceiveMessageCommandInput) {
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
          AttributeNames: [QueueAttributeName.All],
        };

        const response = await this.queue.receiveMessage(currentParams);

        if (!response.Messages || response.Messages.length === 0) {
          setTimeout(handlerFunc, (receiveTimeout && receiveTimeout()) || 2000);
          return;
        }

        const messages = await Promise.all(
          response.Messages.map(async m => {
            if (m.Body === undefined)
              throw Error(
                `Message with ID '${m.MessageId}' has no Body defined.`
              );

            const json = JSON.parse(m.Body);

            try {
              const contentType =
                m.MessageAttributes &&
                m.MessageAttributes[MESSAGE_ATTRIBUTE_CONTENT_TYPE];
              let jsonMessage;

              if (contentType) {
                if (contentType.StringValue === COMPRESSTION_METHOD_BROTLI) {
                  this.logger.info(
                    `Message with ID '${m.MessageId}' is compressed with Brotli.`
                  );
                  jsonMessage = await decompressBrotli(json.Message);
                } else if (
                  contentType.StringValue === COMPRESSTION_METHOD_GZIP
                ) {
                  this.logger.info(
                    `Message with ID '${m.MessageId}' is compressed with Gzip.`
                  );
                  jsonMessage = await decompressGzip(json.Message);
                } else {
                  jsonMessage = JSON.parse(json.Message);
                }
              } else {
                jsonMessage = JSON.parse(json.Message);
              }
              return {
                handle: m.ReceiptHandle,
                isValidJson: true,
                message: {
                  message: jsonMessage,
                  subject: json.Subject,
                  attributes: m.Attributes,
                },
              };
            } catch (error) {
              this.logger.error(
                `Not able to parse event as json: ${json.Message}`
              );
              return {
                handle: m.ReceiptHandle,
                isValidJson: false,
                message: {subject: 'Delete Me'},
              };
            }
          })
        );

        cntInFlight += messages.length;

        const promises = messages.map(async m => {
          const {message, subject, attributes} = m.message;
          let shouldRetry = false;
          let visibilityTimeout: number | undefined;
          try {
            if (
              m.isValidJson &&
              (this.handlers[subject] || this.handlers['*'])
            ) {
              const subjectHandlers = (this.handlers[subject] || []).concat(
                this.handlers['*'] || []
              );
              await Promise.all(
                subjectHandlers.map(async h => {
                  try {
                    shouldRetry = false;
                    await h.handler(message, subject);
                  } catch (error) {
                    typeof error === 'string' && this.logger.error(error);

                    if (!h.retryPolicyOptions) return;

                    if (Object.keys(subjectHandlers).length > 1) {
                      this.logger.info(
                        `Multiple handlers for message with subject "${m.message.subject}"`
                      );
                      return;
                    }

                    const {maxAttempts, backoffDelaySeconds, retryPolicy} =
                      h.retryPolicyOptions;
                    const attempt = parseInt(
                      attributes?.ApproximateReceiveCount || '1'
                    );

                    if (attempt < maxAttempts) {
                      shouldRetry = true;
                      visibilityTimeout = retryPolicy?.(
                        attempt,
                        backoffDelaySeconds,
                        error
                      );

                      this.logger.debug(
                        `Message with subject "${m.message.subject}" will be retried`
                      );
                    }
                  }
                })
              );
            }
            if (!m.handle)
              throw Error("'handle' property on message was undefined.");

            if (!shouldRetry) {
              await this.queue.deleteMessage(m.handle);

              this.logger.debug(
                `Message with subject "${m.message.subject}" deleted`
              );
              return;
            }

            if (
              typeof visibilityTimeout === 'number' &&
              visibilityTimeout >= 0 &&
              visibilityTimeout !== currentParams.VisibilityTimeout
            ) {
              if (visibilityTimeout >= 0 && visibilityTimeout <= 43200) {
                await this.queue.changeMessageVisibility(
                  m.handle,
                  visibilityTimeout
                );
              } else {
                this.logger.warn(
                  `Invalid visibilityTimeout value: ${visibilityTimeout}`
                );
              }
            }

            this.logger.debug(
              `Message with subject "${m.message.subject}" kept, visibilityTimeout: ${visibilityTimeout}`
            );
          } catch (error) {
            typeof error === 'string' && this.logger.error(error);
          } finally {
            cntInFlight--;
          }
        });

        if (MaxNumberOfMessages === cntInFlight) {
          await Promise.race(promises);
        }
      } catch (err) {
        typeof err === 'string' && this.logger.error(err);
      }

      setTimeout(handlerFunc, (receiveTimeout && receiveTimeout()) || 10);
    };
    setTimeout(handlerFunc, (receiveTimeout && receiveTimeout()) || 10);
  }
}
