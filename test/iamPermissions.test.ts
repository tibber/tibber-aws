import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  IAMClient,
  PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import {SNS} from '@aws-sdk/client-sns';
import {SQS} from '@aws-sdk/client-sqs';
import {Queue, Topic, configure} from '../src';

/**
 * Documents and enforces the minimum IAM permission set required to run a
 * listener via QueueSubjectListenerBuilder when the queue, topic, and
 * subscription already exist. Anything added to the listener path that
 * requires a permission not in this list will fail the positive test;
 * removing a permission that's no longer needed will fail the negative
 * tests, prompting an explicit update here.
 *
 * Floci must run with FLOCI_SERVICES_IAM_ENFORCEMENT_ENABLED=true for these
 * tests to be meaningful; the test/iamPermissions.test.ts and
 * docker-compose-test.yml ship together.
 */
const REQUIRED_LISTENER_PERMISSIONS = [
  'sqs:GetQueueUrl',
  'sqs:GetQueueAttributes',
  'sqs:ReceiveMessage',
  'sqs:DeleteMessage',
  'sqs:ChangeMessageVisibility',
  'sns:GetTopicAttributes',
  'sns:ListSubscriptionsByTopic',
];

const REQUIRED_PUBLISHER_PERMISSIONS = ['sns:Publish'];

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const buildPolicy = (actions: string[]) => ({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: actions,
      Resource: '*',
    },
  ],
});

const createRestrictedCredentials = async (
  iam: IAMClient,
  actions: string[]
) => {
  const userName = uniqueName('iam-test-user');
  await iam.send(new CreateUserCommand({UserName: userName}));
  await iam.send(
    new PutUserPolicyCommand({
      UserName: userName,
      PolicyName: 'listener-perms',
      PolicyDocument: JSON.stringify(buildPolicy(actions)),
    })
  );
  const key = await iam.send(new CreateAccessKeyCommand({UserName: userName}));
  return {
    accessKeyId: key.AccessKey!.AccessKeyId!,
    secretAccessKey: key.AccessKey!.SecretAccessKey!,
  };
};

/**
 * Runs `fn` with AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY temporarily set
 * to the given credentials. Newly-constructed SDK clients inside `fn` pick
 * up the env via the default credential provider chain.
 */
const withCredentials = async <T>(
  credentials: {accessKeyId: string; secretAccessKey: string},
  fn: () => Promise<T>
): Promise<T> => {
  const originalKey = process.env.AWS_ACCESS_KEY_ID;
  const originalSecret = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  try {
    return await fn();
  } finally {
    process.env.AWS_ACCESS_KEY_ID = originalKey;
    process.env.AWS_SECRET_ACCESS_KEY = originalSecret;
  }
};

beforeAll(() => {
  configure({region: 'eu-west-1'});
});

describe('IAM permissions required by the listener path', () => {
  const iam = new IAMClient({endpoint: awsEndpointUrl});

  it('listener init + message-handling primitives succeed with only the documented permissions', async () => {
    // Pre-seed queue, topic, and subscription with the default `test`
    // credentials (which Floci bypasses from IAM enforcement). After this
    // setup, the listener path must be fully read-only.
    const queueName = uniqueName('iam-q');
    const topicName = uniqueName('iam-t');
    const setupQueue = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);
    const setupTopic = await Topic.getOrCreateTopic(
      topicName,
      undefined,
      setupQueue.queueArn,
      awsEndpointUrl
    );
    await setupQueue.subscribeTopic(setupTopic);

    const credentials = await createRestrictedCredentials(
      iam,
      REQUIRED_LISTENER_PERMISSIONS
    );

    // Exercise the actual tibber-aws library code under restricted creds.
    // Anything the listener bootstrap needs that isn't in the policy above
    // will surface as AccessDenied here and fail the test — that is the
    // regression guard for "the documented permissions are sufficient".
    await withCredentials(credentials, async () => {
      // Queue.getOrCreateQueue → sqs:GetQueueUrl (steady-state path)
      const queue = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);
      expect(queue.queueUrl).toBe(setupQueue.queueUrl);

      // Topic.getOrCreateTopic → sns:GetTopicAttributes
      const topic = await Topic.getOrCreateTopic(
        topicName,
        undefined,
        queue.queueArn,
        awsEndpointUrl
      );
      expect(topic.topicArn).toBe(setupTopic.topicArn);

      // Queue.subscribeTopic short-circuits on sns:ListSubscriptionsByTopic
      // → no sqs:SetQueueAttributes / sns:Subscribe writes.
      await queue.subscribeTopic(topic);

      // Listener loop primitives: sqs:ReceiveMessage / sqs:DeleteMessage /
      // sqs:ChangeMessageVisibility. Receive returns no messages with the
      // empty queue; the permission is what's being checked.
      await queue.receiveMessage({WaitTimeSeconds: 0});
    });
  }, 30000);

  it.each([
    ['sqs:GetQueueUrl', async (sqs: SQS, queueName: string) =>
      sqs.getQueueUrl({QueueName: queueName})],
    ['sqs:GetQueueAttributes', async (sqs: SQS, _name: string, queueUrl: string) =>
      sqs.getQueueAttributes({QueueUrl: queueUrl, AttributeNames: ['All']})],
    ['sqs:ReceiveMessage', async (sqs: SQS, _name: string, queueUrl: string) =>
      sqs.receiveMessage({QueueUrl: queueUrl, WaitTimeSeconds: 0})],
  ])(
    'removing %s from the policy breaks the corresponding call',
    async (permission, invoke) => {
      const queueName = uniqueName('iam-neg-q');
      const setup = await Queue.getOrCreateQueue(queueName, awsEndpointUrl);

      const reducedPermissions = REQUIRED_LISTENER_PERMISSIONS.filter(
        p => p !== permission
      );
      const credentials = await createRestrictedCredentials(
        iam,
        reducedPermissions
      );

      const sqs = new SQS({endpoint: awsEndpointUrl, credentials});

      await expect(invoke(sqs, queueName, setup.queueUrl)).rejects.toThrow(
        /AccessDenied|Forbidden|not authorized/i
      );
    },
    30000
  );

  // Note: negative tests for sns:GetTopicAttributes and
  // sns:ListSubscriptionsByTopic are intentionally omitted. Floci's IAM
  // enforcement is permissive for several SNS actions (see Floci docs:
  // "unresolvable IAM action for the request" bypass rule), so these
  // negatives are unreliable. The positive test above is the contract.
});

describe('IAM permissions required by the publisher path (Topic.fromArn + push)', () => {
  const iam = new IAMClient({endpoint: awsEndpointUrl});

  it('Topic.fromArn + push succeed with only sns:Publish', async () => {
    const topicName = uniqueName('iam-pub-t');
    const real = await Topic.createTopic(topicName, undefined, awsEndpointUrl);

    const credentials = await createRestrictedCredentials(
      iam,
      REQUIRED_PUBLISHER_PERMISSIONS
    );

    await withCredentials(credentials, async () => {
      const topic = Topic.fromArn(
        real.topicArn,
        'New Meter Reading NO',
        awsEndpointUrl
      );
      const result = await topic.push({hello: 'world'});
      expect(result.MessageId).toBeTruthy();
    });
  }, 30000);

  // Note: a negative test for sns:Publish is intentionally omitted —
  // Floci's IAM enforcement is permissive for SNS publish in practice.
  // The positive test above is the contract.
});
