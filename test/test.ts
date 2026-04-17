import {readFileSync} from 'fs';
import {join} from 'path';
import JSZip from 'jszip';
import {
  Lambda,
  ResourceConflictException,
  waitUntilFunctionActiveV2,
} from '@aws-sdk/client-lambda';
import {
  SecretsManager,
  ResourceExistsException,
} from '@aws-sdk/client-secrets-manager';
import {
  Queue,
  QueueSubjectListener,
  QueueSubjectListenerBuilder,
  configure,
  getLambdaFunc,
  getSecret,
} from '../src';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

const LAMBDA_FUNCTION_NAME = 'localstack-lambda-url-example';
const SECRET_NAME = 'my-secret';
const SECRET_VALUE = {PG_PASSWORD: 'stacy'};

async function ensureSecret(endpoint?: string) {
  const sm = new SecretsManager({endpoint, region: 'eu-west-1'});
  try {
    await sm.createSecret({
      Name: SECRET_NAME,
      SecretString: JSON.stringify(SECRET_VALUE),
    });
  } catch (err) {
    if (!(err instanceof ResourceExistsException)) throw err;
  }
}

async function buildLambdaZip(): Promise<Buffer> {
  const src = readFileSync(
    join(__dirname, '..', '..', 'test', 'lambda', 'index.js')
  );
  const zip = new JSZip();
  zip.file('index.js', src);
  return zip.generateAsync({type: 'nodebuffer'});
}

async function ensureLambda(endpoint?: string) {
  const lambda = new Lambda({endpoint, region: 'eu-west-1'});
  const zip = await buildLambdaZip();

  try {
    await lambda.createFunction({
      FunctionName: LAMBDA_FUNCTION_NAME,
      Runtime: 'nodejs18.x',
      Role: 'arn:aws:iam::000000000000:role/lambda-role',
      Handler: 'index.handler',
      Code: {ZipFile: zip},
      Timeout: 60,
    });
  } catch (err) {
    if (!(err instanceof ResourceConflictException)) throw err;
  }

  await waitUntilFunctionActiveV2(
    {client: lambda, maxWaitTime: 60},
    {FunctionName: LAMBDA_FUNCTION_NAME}
  );
}

beforeAll(async () => {
  configure({region: 'eu-west-1'});
});

it('should be able to assign several topics to builderer', () => {
  const builder = new QueueSubjectListenerBuilder(
    'test-queueName',
    null,
    {name: 'test', subject: 'test'},
    {name: 'test2', subject: 'test2'}
  );
  expect(builder.topics.length).toBe(2);
});

describe('QueueSubjectListener', () => {
  it('should be able to listen to queue and call handler', async () => {
    const queueName = 'test-queueName-' + Date.now();
    const subjectName = 'test_subject';
    const queue = await Queue.createQueue(queueName, awsEndpointUrl);
    const listener = new QueueSubjectListener(queue, null, {
      maxConcurrentMessage: 1,
      visibilityTimeout: 10,
      waitTimeSeconds: 0,
    });

    const handler = jest.fn(() => Promise.resolve());

    listener.onSubject(subjectName, handler);

    listener.listen();

    const event = {id: '123', test: 'test'};
    await queue.send(subjectName, event);

    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event, subjectName);

    listener.stop();
  }, 10000);

  it('should be able to listen to queue and call handler with retry', async () => {
    const queueName = 'test-retry-queueName-' + Date.now();
    const subjectName = 'test_retry_subject';
    const queue = await Queue.createQueue(queueName, awsEndpointUrl);
    const listener = new QueueSubjectListener(queue, null, {
      maxConcurrentMessage: 1,
      visibilityTimeout: 5,
      waitTimeSeconds: 0,
    });

    const handler = jest.fn(() => Promise.reject('error'));

    listener.onSubject(subjectName, handler, {
      maxAttempts: 2,
      backoffDelaySeconds: 1,
    });

    listener.listen();

    const event = {id: '123', test: 'test'};
    await queue.send(subjectName, event);

    await new Promise(resolve => setTimeout(resolve, 6000));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(event, subjectName);

    listener.stop();
  }, 15000);
});

it('should run lambda func', async () => {
  await ensureLambda(awsEndpointUrl);

  const func = getLambdaFunc(
    LAMBDA_FUNCTION_NAME,
    awsEndpointUrl
  );
  const payload = {num1: 324, num2: 36};

  const res = await func(JSON.stringify(payload));

  expect(res).toBeTruthy();
  expect(res).toEqual({
    statusCode: 200,
    body: `The product of ${payload.num1} and ${payload.num2} is ${
      payload.num1 * payload.num2
    }`,
  });
}, 60000);

it('getSecret', async () => {
  await ensureSecret(awsEndpointUrl);
  const res = getSecret(SECRET_NAME, 'PG_PASSWORD', awsEndpointUrl);
  expect(res).toEqual('stacy');
});

it('should be able to send message to queue', async () => {
  const queue = await Queue.createQueue(
    'test-tibber-aws-queue',
    awsEndpointUrl
  );
  const res = await queue.send('Test', {property: 'test'});

  expect(res).toBeTruthy();
  expect(res.MessageId).toBeTruthy();
});
