import {ILogger} from '../ILogger';
import {Queue} from './Queue';
import {QueueSubjectListener} from './QueueSubjectListener';
import {Topic} from './Topic';

interface ITopic {
  name: string;
  subject: string;
}

export class QueueSubjectListenerBuilder {
  public topics: Array<ITopic | Topic>;

  constructor(
    public queueName: string,
    public logger?: ILogger | undefined | null,
    ...topics: Array<ITopic | Topic>
  ) {
    this.topics = topics;
  }

  async build() {
    if (!this.queueName) throw new Error('"queueName" must be specified');

    const queue = await Queue.createQueue(this.queueName);

    for (const t of this.topics) {
      let topic;
      if (!(t instanceof Topic)) {
        topic = await Topic.createTopic(t.name, t.subject);
      } else {
        topic = t;
      }

      if (topic.topicArn === undefined)
        throw new Error('"topicArn" must be specified');

      await queue.subscribeTopic(topic);
    }

    return new QueueSubjectListener(queue, this.logger);
  }
}
