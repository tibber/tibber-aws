import AWS from 'aws-sdk';
import {
  DeleteMessageRequest,
  ReceiveMessageRequest,
  SendMessageRequest,
} from 'aws-sdk/clients/sqs';
import {Topic} from './Topic';

/**
 * The JSON structure that can be serialized to the string assigned to the SQS Policy Attribute.
 *
 * This is not a comprehensive Type for SQS Policy Attribute. It was created to
 * cover the usage in Tibber code.
 */
type PolicyTemplate = {
  Statement: Array<{
    Sid: string;
    Effect: 'Allow';
    Principal: {
      AWS: '*';
    };
    Action: string[];
    Resource?: string;
    Condition?: {
      ArnLike?: Record<string, string[]>;
    };
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
  public sqs = new AWS.SQS({endpoint: this.endpoint});
  public sns = new AWS.SNS({endpoint: this.endpoint});
  public _arnMap: Record<string, boolean> = {};

  constructor(
    public queueUrl: string,
    public queueArn: string,
    public endpoint?: string
  ) {}

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
      return await this.sns.subscribe(params).promise();
    };

    const response = await this.sqs
      .getQueueAttributes({
        QueueUrl: this.queueUrl,
        AttributeNames: ['All'],
      })
      .promise();

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

    await this.sqs
      .setQueueAttributes({
        QueueUrl: this.queueUrl,
        Attributes: {Policy: JSON.stringify(policy)},
      })
      .promise();

    await subFunc();
  }

  async send(subject: string, message: unknown, delaySeconds = 0) {
    const payload: SendMessageRequest = {
      DelaySeconds: delaySeconds,
      MessageBody: JSON.stringify({
        Message: JSON.stringify(message),
        Subject: subject,
      }),
      QueueUrl: this.queueUrl,
    };
    return await this.sqs.sendMessage(payload).promise();
  }

  static async createQueue(queueName: string, endpoint?: string) {
    const sqs = new AWS.SQS({endpoint});
    const queue = await sqs.createQueue({QueueName: queueName}).promise();

    if (!queue.QueueUrl)
      throw Error("Expected QueueUrl to be set on 'queue' instance.");

    const response = await sqs
      .getQueueAttributes({
        QueueUrl: queue.QueueUrl,
        AttributeNames: ['QueueArn', 'Policy'],
      })
      .promise();

    if (!response.Attributes?.QueueArn)
      throw Error("Expected QueueArn to be set on 'response' instance.");

    return new Queue(queue.QueueUrl, response.Attributes.QueueArn, endpoint);
  }

  async receiveMessage(params: Omit<ReceiveMessageRequest, 'QueueUrl'>) {
    return await this.sqs
      .receiveMessage({...params, ...{QueueUrl: this.queueUrl}})
      .promise();
  }

  async deleteMessage(receiptHandle: string) {
    const request: DeleteMessageRequest = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    };
    await this.sqs.deleteMessage(request).promise();
  }
}
