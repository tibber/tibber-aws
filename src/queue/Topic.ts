import {MessageAttributeValue, SNS} from '@aws-sdk/client-sns';

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
   * Constructs a Topic from a known ARN.
   */
  static fromArn(topicArn: string, subject?: string, endpoint?: string) {
    const parts = topicArn.split(':');
    if (parts.length < 6 || !parts[5])
      throw Error(`Invalid SNS topic ARN: "${topicArn}".`);
    return new Topic(topicArn, parts[5], subject, endpoint);
  }

  /**
   * Constructs a Topic from (name, accountId, region).
   * For FIFO topics, `topicName` must already include the `.fifo` suffix.
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
