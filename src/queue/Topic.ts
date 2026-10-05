import {MessageAttributeValue, SNS} from '@aws-sdk/client-sns';
import {STS} from '@aws-sdk/client-sts';

let account: Promise<string | undefined> | undefined;

const callerAccount = (endpoint?: string) =>
  (account ??= new STS({endpoint})
    .getCallerIdentity({})
    .then(({Account}) => Account)
    .catch(err => {
      account = undefined;
      throw err;
    }));

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
   * Attaches to an existing topic by name. The account comes from
   * `sts:GetCallerIdentity`, called once per process.
   * Call `verify()` to fail fast if the topic does not exist.
   */
  static async attach(topicName: string, subject?: string, endpoint?: string) {
    const region = await new SNS({endpoint}).config.region();
    const account = await callerAccount(endpoint);
    const topicArn = `arn:aws:sns:${region}:${account}:${topicName}`;
    return new Topic(topicArn, topicName, subject, endpoint);
  }

  /** Throws `NotFoundException` if topic does not exist; needs `sns:GetTopicAttributes`. */
  async verify() {
    await this.sns.getTopicAttributes({TopicArn: this.topicArn});
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
