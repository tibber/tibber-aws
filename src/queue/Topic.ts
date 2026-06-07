import {
  MessageAttributeValue,
  NotFoundException,
  SNS,
} from '@aws-sdk/client-sns';
import {partitionFromRegion} from './partition';

export class Topic {
  public sns: SNS;

  private constructor(
    public topicArn: string,
    public name: string,
    public subject?: string,
    public endpoint?: string
  ) {
    this.sns = new SNS({endpoint: this.endpoint});
  }

  static async createTopic(
    topicName: string,
    subjectName?: string,
    endpoint?: string
  ) {
    const sns = new SNS({
      endpoint,
    });
    const topicResponse = await sns.createTopic({Name: topicName});

    if (!topicResponse.TopicArn) {
      throw Error(
        "Unable to get topic ARN... did creating the Topic 'topicName' fail?"
      );
    }

    return new Topic(topicResponse.TopicArn, topicName, subjectName, endpoint);
  }

  /**
   * Constructs a Topic instance from a known ARN — no AWS API call, no
   * permissions required. Intended for the publisher flow when the topic is
   * managed out-of-band (Terraform, prior deploy). The topic name is taken
   * from the last segment of the ARN.
   *
   * Publishing via {@link push} still requires `sns:Publish` at the time of
   * the call; if the topic does not exist the SDK throws `NotFoundException`
   * at publish time, which is the right place to surface the misconfig.
   *
   * Use {@link getOrCreateTopic} instead when the topic may need to be
   * created on first deploy and a co-located queue ARN is available.
   */
  static fromArn(topicArn: string, subject?: string, endpoint?: string) {
    const name = topicArn.split(':').at(-1) ?? '';
    return new Topic(topicArn, name, subject, endpoint);
  }

  /**
   * Convenience wrapper around {@link fromArn} that assembles the ARN from
   * its parts. Same semantics: no AWS API call, no permissions required.
   * Use this when the publisher knows its account, region and the topic
   * name (typical case — both are usually in the service's config).
   *
   * The partition is derived from the region (`cn-*` → `aws-cn`,
   * `us-gov-*` → `aws-us-gov`, else `aws`).
   *
   * For FIFO topics, `topicName` must already include the `.fifo` suffix
   * (AWS requires it); this helper does not append it automatically since
   * it has no way to know whether the caller intends FIFO.
   */
  static fromName(
    topicName: string,
    accountId: string,
    region: string,
    subject?: string,
    endpoint?: string
  ) {
    const partition = partitionFromRegion(region);
    const topicArn = `arn:${partition}:sns:${region}:${accountId}:${topicName}`;
    return new Topic(topicArn, topicName, subject, endpoint);
  }

  /**
   * Resolves an existing topic by deriving its ARN from a co-located SQS
   * queue ARN and verifying it exists via `sns:GetTopicAttributes`.
   * Falls back to `sns:CreateTopic` if missing.
   *
   * The common path (topic exists) only needs read permissions, so debugging
   * against production with read-only credentials does not require
   * `sns:CreateTopic`. Deploy-time first runs still create the topic.
   */
  static async getOrCreateTopic(
    topicName: string,
    subjectName: string | undefined,
    queueArn: string,
    endpoint?: string
  ) {
    const parts = queueArn.split(':');
    // arn:<partition>:sqs:<region>:<accountId>:<queueName>
    //  0      1       2      3         4            5
    const partition = parts[1];
    const region = parts[3];
    const accountId = parts[4];
    const queueName = parts[5];
    // FIFO SQS queues can only subscribe to FIFO SNS topics, whose names
    // AWS requires to end in `.fifo`. Detect from the queue name suffix
    // and append to the topic name if the caller didn't.
    const isFifo = queueName.endsWith('.fifo');
    const fullTopicName =
      isFifo && !topicName.endsWith('.fifo') ? `${topicName}.fifo` : topicName;
    const derivedArn = `arn:${partition}:sns:${region}:${accountId}:${fullTopicName}`;

    const sns = new SNS({endpoint});
    try {
      await sns.getTopicAttributes({TopicArn: derivedArn});
      return new Topic(derivedArn, fullTopicName, subjectName, endpoint);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return await Topic.createTopic(fullTopicName, subjectName, endpoint);
      }
      throw err;
    }
  }

  async push(
    evt: unknown,
    subject?: string,
    messageAttributes?: Record<string, MessageAttributeValue>
  ) {
    const payload = {
      Message: JSON.stringify(evt),
      MessageAttributes: messageAttributes,
      Subject: subject || this.subject,
      TopicArn: this.topicArn,
    };

    return await this.sns.publish(payload);
  }
}
