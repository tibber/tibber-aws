import {SNS} from '@aws-sdk/client-sns';
import {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  SendMessageCommandInput,
  SQS,
} from '@aws-sdk/client-sqs';

import {Topic} from './Topic';

/**
 * The JSON structure that can be serialized to the string assigned to the SQS Policy Attribute.
 *
 * This is not a comprehensive Type for SQS Policy Attribute. It was created to
 * cover the usage in Tibber code.
 */
type PolicyTemplate = {
  Statement: Array<{
    Action: string[];
    Condition?: {
      ArnLike?: Record<string, string[]>;
    };
    Effect: 'Allow';
    Principal: {
      AWS: '*';
    };
    Resource?: string;
    Sid: string;
  }>;
  Version: '2012-10-17';
};

const policyTemplate: PolicyTemplate = {
  Statement: [
    {
      Action: ['sqs:SendMessage', 'sqs:ReceiveMessage'],
      Effect: 'Allow',
      Principal: {
        AWS: '*',
      },
      Sid: 'Sid' + new Date().getTime(),
    },
  ],
  Version: '2012-10-17',
};

export class Queue {
  public _arnMap: Record<string, boolean> = {};
  public sqs: SQS;
  public sns: SNS;

  constructor(
    public queueUrl: string,
    public queueArn: string,
    public endpoint?: string
  ) {
    this.sqs = new SQS({endpoint: this.endpoint});
    this.sns = new SNS({endpoint: this.endpoint});
  }

  async subscribeTopic(topic: Topic) {
    if (this._arnMap[topic.topicArn]) {
      return;
    }

    this._arnMap[topic.topicArn] = true;

    const subFunc = async () => {
      const params = {
        Endpoint: this.queueArn,
        Protocol: 'sqs',
        TopicArn: topic.topicArn,
      };
      return await this.sns.subscribe(params);
    };

    const response = await this.sqs.getQueueAttributes({
      AttributeNames: ['All'],
      QueueUrl: this.queueUrl,
    });

    let policy = policyTemplate;

    if (response.Attributes?.Policy) {
      policy = JSON.parse(response.Attributes.Policy);
    }

    const statement = policy.Statement[0];

    statement.Resource = statement.Resource || this.queueArn;
    statement.Condition = statement.Condition || {};
    statement.Condition.ArnLike = statement.Condition.ArnLike || {};
    statement.Condition.ArnLike['aws:SourceArn'] =
      statement.Condition.ArnLike['aws:SourceArn'] || [];

    let sourceArns = statement.Condition.ArnLike['aws:SourceArn'];

    if (!(sourceArns instanceof Array)) {
      sourceArns = [sourceArns];
      statement.Condition.ArnLike['aws:SourceArn'] = sourceArns;
    }

    if (sourceArns.filter(a => a === topic.topicArn).length > 0) {
      await subFunc();
      return;
    }

    sourceArns.push(topic.topicArn);

    await this.sqs.setQueueAttributes({
      Attributes: {Policy: JSON.stringify(policy)},
      QueueUrl: this.queueUrl,
    });

    await subFunc();
  }

  async send(subject: string, message: unknown, delaySeconds = 0) {
    const payload: SendMessageCommandInput = {
      DelaySeconds: delaySeconds,
      MessageBody: JSON.stringify({
        Message: JSON.stringify(message),
        Subject: subject,
      }),
      QueueUrl: this.queueUrl,
    };
    return await this.sqs.sendMessage(payload);
  }

  static async createQueue(queueName: string, endpoint?: string) {
    const sqs = new SQS({endpoint});
    const queue = await sqs.createQueue({QueueName: queueName});

    if (!queue.QueueUrl)
      throw Error("Expected QueueUrl to be set on 'queue' instance.");

    const response = await sqs.getQueueAttributes({
      AttributeNames: ['QueueArn', 'Policy'],
      QueueUrl: queue.QueueUrl,
    });

    if (!response.Attributes?.QueueArn)
      throw Error("Expected QueueArn to be set on 'response' instance.");

    return new Queue(queue.QueueUrl, response.Attributes.QueueArn, endpoint);
  }

  async receiveMessage(params: Omit<ReceiveMessageCommandInput, 'QueueUrl'>) {
    return await this.sqs.receiveMessage({
      ...params,
      ...{QueueUrl: this.queueUrl},
    });
  }

  async deleteMessage(receiptHandle: string) {
    const request: DeleteMessageCommandInput = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    };
    await this.sqs.deleteMessage(request);
  }

  async changeMessageVisibility(
    receiptHandle: string,
    visibilityTimeout: number
  ) {
    const request: ChangeMessageVisibilityCommandInput = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeout,
    };
    await this.sqs.changeMessageVisibility(request);
  }
}
