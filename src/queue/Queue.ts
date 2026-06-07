import {SNS} from '@aws-sdk/client-sns';
import {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageCommandInput,
  QueueDoesNotExist,
  ReceiveMessageCommandInput,
  SendMessageCommandInput,
  SQS,
} from '@aws-sdk/client-sqs';

import {partitionFromRegion} from './partition';
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

    // An existing subscription is taken to imply the queue policy already
    // permits sqs:SendMessage from this topic's ARN. If a subscription was
    // created out-of-band (e.g. via the AWS console) without the matching
    // policy entry, message delivery will silently fail; recreate the
    // subscription via this listener to heal it.
    if (await this.isAlreadySubscribed(topic.topicArn)) {
      this._arnMap[topic.topicArn] = true;
      return;
    }

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

    if (!sourceArns.includes(topic.topicArn)) {
      sourceArns.push(topic.topicArn);
      await this.sqs.setQueueAttributes({
        Attributes: {Policy: JSON.stringify(policy)},
        QueueUrl: this.queueUrl,
      });
    }

    await subFunc();
    this._arnMap[topic.topicArn] = true;
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

  /**
   * Returns a Queue instance for an already-existing queue.
   * Only requires `sqs:GetQueueUrl` — no write permissions needed.
   * Throws {@link QueueDoesNotExist} if the queue is not present; use
   * {@link getOrCreateQueue} when the queue may need to be created.
   */
  static async getQueue(queueName: string, endpoint?: string) {
    const sqs = new SQS({endpoint});
    const result = await sqs.getQueueUrl({QueueName: queueName});

    if (!result.QueueUrl)
      throw Error(`Could not resolve URL for queue "${queueName}".`);

    const region = await sqs.config.region();
    if (!region)
      throw Error(
        'AWS region is not configured; cannot derive queue ARN. ' +
          'Set AWS_REGION or configure the SDK with a region.'
      );

    const url = new URL(result.QueueUrl);
    // AWS:        https://sqs.{region}.amazonaws.com/{accountId}/{queueName}
    // AWS China:  https://sqs.{region}.amazonaws.com.cn/{accountId}/{queueName}
    // LocalStack: http://localhost:4566/{accountId}/{queueName}
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2)
      throw Error(`Unexpected queue URL format: ${result.QueueUrl}`);

    const [accountId, name] = parts;
    const partition = partitionFromRegion(region);
    const queueArn = `arn:${partition}:sqs:${region}:${accountId}:${name}`;

    return new Queue(result.QueueUrl, queueArn, endpoint);
  }

  /**
   * Resolves an existing queue or creates it if missing. The common path
   * (queue exists) only needs `sqs:GetQueueUrl`, so debugging against
   * production with read-only credentials works without falling back to
   * `sqs:CreateQueue`. Deploy-time first runs still create the queue.
   */
  static async getOrCreateQueue(queueName: string, endpoint?: string) {
    try {
      return await Queue.getQueue(queueName, endpoint);
    } catch (err) {
      if (err instanceof QueueDoesNotExist) {
        return await Queue.createQueue(queueName, endpoint);
      }
      throw err;
    }
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

  /**
   * Returns true if an `sqs` subscription from `topicArn` to this queue's ARN
   * already exists. Used to skip the write-heavy subscribe flow when the
   * topology is already in place — needs only `sns:ListSubscriptionsByTopic`.
   */
  private async isAlreadySubscribed(topicArn: string): Promise<boolean> {
    let nextToken: string | undefined;
    do {
      const result = await this.sns.listSubscriptionsByTopic({
        TopicArn: topicArn,
        NextToken: nextToken,
      });
      if (
        result.Subscriptions?.some(
          s => s.Protocol === 'sqs' && s.Endpoint === this.queueArn
        )
      ) {
        return true;
      }
      nextToken = result.NextToken;
    } while (nextToken);
    return false;
  }
}
