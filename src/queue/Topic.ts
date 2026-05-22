import {
  MessageAttributeValue,
  NotFoundException,
  SNS,
} from '@aws-sdk/client-sns';

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
    // arn:aws:sqs:<region>:<accountId>:<queueName>
    //  0   1   2      3        4           5
    const region = parts[3];
    const accountId = parts[4];
    const derivedArn = `arn:aws:sns:${region}:${accountId}:${topicName}`;

    const sns = new SNS({endpoint});
    try {
      await sns.getTopicAttributes({TopicArn: derivedArn});
      return new Topic(derivedArn, topicName, subjectName, endpoint);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return await Topic.createTopic(topicName, subjectName, endpoint);
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
