import AWS from 'aws-sdk';

export class Topic {
  public sns = new AWS.SNS({endpoint: this.endpoint});

  private constructor(
    public topicArn: string,
    public name: string,
    public subject?: string,
    public endpoint?: string
  ) {}

  static async createTopic(
    topicName: string,
    subjectName?: string,
    endpoint?: string
  ) {
    const sns = new AWS.SNS({endpoint});
    const topicResponse = await sns.createTopic({Name: topicName}).promise();

    if (!topicResponse.TopicArn) {
      throw Error(
        "Unable to get topic ARN... did creating the Topic 'topicName' fail?"
      );
    }

    return new Topic(topicResponse.TopicArn, topicName, subjectName, endpoint);
  }

  async push(evt: unknown, subject?: string, messageAttributes?: unknown) {
    const payload = {
      Message: JSON.stringify(evt),
      MessageAttributes: messageAttributes,
      Subject: subject || this.subject,
      TopicArn: this.topicArn,
    };

    return await this.sns.publish(payload).promise();
  }
}
