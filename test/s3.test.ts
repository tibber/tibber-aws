import rand from 'randomstring';
import {S3Bucket, configure} from '../src';

const localstackEndpoint =
  process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';

const generateRandomBucketName = () =>
  rand.generate({
    capitalization: 'lowercase',
    charset: 'alphanumeric',
    length: 32,
  });

beforeAll(async () => {
  configure({region: 'eu-west-1'});
});

describe('getOrCreateBucket', () => {
  it('should be able to create bucket', async () => {
    const result = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    expect(typeof result).toBe('object');
  });
});

describe('getBuckets', () => {
  it('getBuckets should return array', async () => {
    await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const result = await S3Bucket.getBuckets(localstackEndpoint);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getExistingBucket', () => {
  it('should return bucket if it exists', async () => {
    const testBucketName = generateRandomBucketName();
    await S3Bucket.getOrCreateBucket(testBucketName, localstackEndpoint);
    const result = await S3Bucket.getExistingBucket(
      testBucketName,
      localstackEndpoint
    );
    expect(result?.name).toBe(testBucketName);
  });

  it('should return undefined if bucket does not exist', async () => {
    const testBucketName = generateRandomBucketName();
    const result = await S3Bucket.getExistingBucket(
      testBucketName,
      localstackEndpoint
    );
    expect(result).toBeUndefined();
  });
});

describe('deleteIfExsists', () => {
  it('should be able to delete bucket', async () => {
    const testBucketName = generateRandomBucketName();
    await S3Bucket.getOrCreateBucket(testBucketName, localstackEndpoint);
    const result = await S3Bucket.deleteIfExsists(
      testBucketName,
      localstackEndpoint
    );
    expect(result).toBe(true);
  });

  it('should return false if bucket does not exist', async () => {
    const testBucketName = generateRandomBucketName();
    const result = await S3Bucket.deleteIfExsists(
      testBucketName,
      localstackEndpoint
    );
    expect(result).toBe(false);
  });
});

describe('getOrCreateBucket', () => {
  it('should get bucket if it already exists', async () => {
    const testBucketName = generateRandomBucketName();
    const result = await S3Bucket.getOrCreateBucket(
      testBucketName,
      localstackEndpoint
    );
    const result2 = await S3Bucket.getOrCreateBucket(
      testBucketName,
      localstackEndpoint
    );
    expect(result?.name).toBe(result2?.name);
  });

  it('should be able to put object without content type', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    bucket!.putObject('test', buffer);
  });

  it('should be able to put object with content type', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
  });

  it('should be able to retrieve object', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    await bucket!.getObject('test');
  });

  it('should be able to retrieve object as stream', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = await bucket!.getObjectAsStream('test');
    expect(result.Body?.transformToWebStream()).toBeTruthy();
  });

  it('should be able to retrieve object as stream 2', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = await bucket!.getObjectStream('test');
    //TODO: CHeck this! Readable vs ReadableStream
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('should be able to actually retrieve object as stream', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const data = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
    const buffer = Buffer.from(data);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = await bucket!.getObjectStream('test');

    if (!result) {
      throw new Error('result is undefined');
    }

    //Read the stream and compare the result to the original buffer
    const readResult = await result.getReader().read();
    expect(readResult.value).toEqual(data);
  });

  it('should be able to handle missing key exception', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const name = generateRandomBucketName();

    try {
      await bucket!.getObjectStream(name);
    } catch (error) {
      expect((error as Error).message).toBe('Object not available');
    }
  });

  it('should be able to check whether object is available in S3', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);

    let name = generateRandomBucketName();

    await bucket!.putObject(name, buffer, 'image/png');
    let result = await bucket!.objectAvailable(name);
    expect(result).toBe(true);

    name = generateRandomBucketName();

    result = await bucket!.objectAvailable(name);
    expect(result).toBe(false);
  });

  it('should be able to list objects', async () => {
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);

    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );

    for (let index = 0; index < 10; index++) {
      await bucket?.putObject('myItem' + index, buffer);
    }

    const res = await bucket!.listObjects();

    const contents = res.Contents ?? [];

    expect(contents.length).toEqual(10);
  });

  it('should be able to list objects with prefix', async () => {
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );
    await bucket?.putObject('item1', buffer);
    await bucket?.putObject('item2', buffer);
    await bucket?.putObject('nomatch', buffer);

    const res = await bucket?.listObjects('item');

    const contents = res?.Contents ?? [];

    expect(contents).toHaveLength(2);
  });

  it('should be able to list after a given key', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      localstackEndpoint
    );

    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test2', buffer);

    const res = await bucket?.listObjects('test', 'test');

    const contents = res?.Contents ?? [];

    expect(contents).toHaveLength(1);
  });
});
