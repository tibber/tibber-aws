import {ILogger} from '../ILogger';
import {Queue} from './Queue';
import {
  QueueSubjectListener,
  QueueSubjectListenerOptions,
} from './QueueSubjectListener';

/**
 * Builds a listener for a queue resolved via {@link Queue.attach}.
 * Required IAM: sqs:GetQueueUrl, sqs:ReceiveMessage, sqs:DeleteMessage,
 * sqs:ChangeMessageVisibility.
 */
export class AttachedQueueListenerBuilder {
  constructor(
    public queue: Queue,
    public logger?: ILogger | null,
    public options?: QueueSubjectListenerOptions
  ) {}

  build() {
    return new QueueSubjectListener(this.queue, this.logger, this.options);
  }
}
