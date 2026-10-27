import {randomBytes, randomUUID} from 'node:crypto';
import rand from 'randomstring';
import {DataSet, S3Bucket, configure, exportDataSet} from '../src';
import {NoSuchKey} from '@aws-sdk/client-s3';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;

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
      awsEndpointUrl
    );
    expect(typeof result).toBe('object');
  });
});

describe('getBuckets', () => {
  it('getBuckets should return array', async () => {
    await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const result = await S3Bucket.getBuckets(awsEndpointUrl);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getExistingBucket', () => {
  it('should return bucket if it exists', async () => {
    const testBucketName = generateRandomBucketName();
    await S3Bucket.getOrCreateBucket(testBucketName, awsEndpointUrl);
    const result = await S3Bucket.getExistingBucket(
      testBucketName,
      awsEndpointUrl
    );
    expect(result?.name).toBe(testBucketName);
  });

  it('should return undefined if bucket does not exist', async () => {
    const testBucketName = generateRandomBucketName();
    const result = await S3Bucket.getExistingBucket(
      testBucketName,
      awsEndpointUrl
    );
    expect(result).toBeUndefined();
  });
});

describe('deleteObject', () => {
  it('should be able to delete object', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    const buffer2 = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test2', buffer2, 'image/png');

    let list = await bucket?.listObjects();
    expect(list?.Contents?.length).toBe(2);

    await bucket!.deleteObject('test');

    list = await bucket?.listObjects();
    expect(list?.Contents?.length).toBe(1);

    expect(async () => {
      await bucket?.getObject('test');
    }).rejects.toThrow(NoSuchKey);

    await bucket!.deleteObject('test2');

    list = await bucket?.listObjects();
    expect(list?.Contents).toBe(undefined);
  });
});

describe('deleteIfExsists', () => {
  it('should be able to delete bucket', async () => {
    const testBucketName = generateRandomBucketName();
    await S3Bucket.getOrCreateBucket(testBucketName, awsEndpointUrl);
    const result = await S3Bucket.deleteIfExsists(
      testBucketName,
      awsEndpointUrl
    );
    expect(result).toBe(true);
  });

  it('should return false if bucket does not exist', async () => {
    const testBucketName = generateRandomBucketName();
    const result = await S3Bucket.deleteIfExsists(
      testBucketName,
      awsEndpointUrl
    );
    expect(result).toBe(false);
  });
});

describe('getOrCreateBucket', () => {
  it('should get bucket if it already exists', async () => {
    const testBucketName = generateRandomBucketName();
    const result = await S3Bucket.getOrCreateBucket(
      testBucketName,
      awsEndpointUrl
    );
    const result2 = await S3Bucket.getOrCreateBucket(
      testBucketName,
      awsEndpointUrl
    );
    expect(result?.name).toBe(result2?.name);
  });

  it('should be able to put object without content type', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    bucket!.putObject('test', buffer);
  });

  it('should be able to put object with content type', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
  });

  it('should be able to retrieve object', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    await bucket!.getObject('test');
  });

  it('should be able to retrieve object as stream', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = await bucket!.getObjectAsStream('test');
    expect(result.Body?.transformToWebStream()).toBeTruthy();
  });

  it('should be able to actually retrieve object as stream', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
    );
    const data = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
    const buffer = Buffer.from(data);
    await bucket!.putObject('test', buffer, 'image/png');
    const result = await bucket!.getObjectStream('test');

    if (!result) {
      throw new Error('result is undefined');
    }

    expect(await result.transformToByteArray()).toEqual(data);
  });

  it('should be able to handle missing key exception', async () => {
    const bucket = await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl
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
      awsEndpointUrl
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
      awsEndpointUrl
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
      awsEndpointUrl
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
      awsEndpointUrl
    );

    const buffer = Buffer.from([8, 6, 7, 5, 3, 0, 9]);
    await bucket!.putObject('test2', buffer);

    const res = await bucket?.listObjects('test', 'test');

    const contents = res?.Contents ?? [];

    expect(contents).toHaveLength(1);
  });
});

describe('exportDataSet', () => {
  type Row = {id: number; label: string | null; at: Date};
  const columns: DataSet<Row>['columns'] = [
    {name: 'id', type: 'INT32', nullable: false},
    {name: 'label', type: 'STRING', nullable: true},
    {name: 'at', type: 'TIMESTAMP', nullable: false},
  ];
  const rowAt = (id: number): Row => ({
    id,
    label: id % 2 ? `row-${id}` : null,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)),
  });
  let bucket: S3Bucket;
  const keysUnder = async (prefix: string) =>
    ((await bucket.listObjects(prefix)).Contents ?? []).map(o =>
      o.Key!.slice(prefix.length),
    );

  beforeAll(async () => {
    bucket = (await S3Bucket.getOrCreateBucket(
      generateRandomBucketName(),
      awsEndpointUrl,
    ))!;
  });

  it.each([0, 25])('writes %i rows to parquet and then _SUCCESS', async n => {
    const rows = Array.from({length: n}, (_, i) => rowAt(i + 1));
    const prefix = await exportDataSet(
      bucket,
      {name: `${n}`, columns, rows},
      4,
    );

    expect(await keysUnder(`${prefix}/`)).toEqual(['_SUCCESS', 'data.parquet']);
    const {parquetReadObjects} = await import('hyparquet');
    const file = await (
      await bucket.getObject(`${prefix}/data.parquet`)
    ).Body!.transformToByteArray();
    expect(
      await parquetReadObjects({file: new Uint8Array(file).buffer}),
    ).toEqual(rows);
  });

  it('pulls rows only as fast as the upload reads them', async () => {
    let pulled = 0;
    const rows = (async function* () {
      while (pulled < 10_000) yield rowAt(++pulled);
    })();
    let startUpload!: () => void;
    const uploadStarted = new Promise<void>(resolve => (startUpload = resolve));
    const putObjectStream = bucket.putObjectStream.bind(bucket);
    jest
      .spyOn(bucket, 'putObjectStream')
      .mockImplementationOnce(async (...args) => {
        await uploadStarted;
        return putObjectStream(...args);
      });

    const exported = exportDataSet(bucket, {name: 'lazy', columns, rows}, 100);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(pulled).toBeLessThan(10_000);
    startUpload();
    await exported;
    expect(pulled).toBe(10_000);
  });

  it.each([
    ['the source fails', () => bucket, 5_000, 'source failed'],
    [
      'the upload fails',
      () =>
        new S3Bucket(
          {Name: generateRandomBucketName(), CreationDate: new Date()},
          awsEndpointUrl,
        ),
      Infinity,
      /bucket/i,
    ],
  ])(
    'leaves no files and closes the source when %s',
    async (_, target, failAt, error) => {
      let closed = false;
      const rows = (async function* () {
        try {
          for (let id = 1; id <= failAt; id++)
            yield {...rowAt(id), label: randomBytes(1000).toString('hex')};
          throw new Error('source failed');
        } finally {
          closed = true;
        }
      })();
      const name = randomUUID();

      await expect(
        exportDataSet(target(), {name, columns, rows}, 100),
      ).rejects.toThrow(error);
      expect(await keysUnder(`data-exports/${name}/`)).toEqual([]);
      expect(closed).toBe(true);
    },
  );
});
