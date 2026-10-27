import {randomUUID} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import rand from 'randomstring';
import {S3} from '@aws-sdk/client-s3';
import {S3Bucket, configure, exportDataSet, parseJsonArrayStream} from '../src';
import type {DataSet} from '../src';

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL;
const encoder = new TextEncoder();

const toChunks = async function* (chunks: Uint8Array[]) {
  yield* chunks;
};

const splitEvery = (bytes: Uint8Array, size: number) =>
  Array.from({length: Math.ceil(bytes.length / size)}, (_, i) =>
    bytes.slice(i * size, (i + 1) * size),
  );

const collect = async <T>(source: AsyncIterable<T>) => {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
};

describe('parseJsonArrayStream', () => {
  const tricky = [
    {id: 1, text: 'a,b]c}d[e{f'},
    {id: 2, text: 'quote " and backslash \\ and "'},
    {id: 3, text: 'multi-byte åäö 🌱', nested: {list: [1, [2, 3]], empty: []}},
  ];

  it.each([1, 2, 3, 7, 1000])(
    'yields every element when the body is split into %i byte chunks',
    async size => {
      const body = encoder.encode(
        `[\n${tricky.map(e => JSON.stringify(e)).join('\n,\n')}\n]\n`,
      );
      expect(
        await collect(parseJsonArrayStream(toChunks(splitEvery(body, size)))),
      ).toEqual(tricky);
    },
  );

  it.each([['[]'], [' [ \n ] \n']])('yields nothing for %j', async body => {
    expect(
      await collect(parseJsonArrayStream(toChunks([encoder.encode(body)]))),
    ).toEqual([]);
  });

  it.each([
    ['[{"a":1},{"a":2', 'ended before its closing bracket'],
    ['', 'ended before its closing bracket'],
    ['{"a":1}', 'Expected the body to be a JSON array'],
    ['[1,2] 3', 'Unexpected content after the end'],
  ])('rejects %j', async (body, message) => {
    await expect(
      collect(parseJsonArrayStream(toChunks([encoder.encode(body)]))),
    ).rejects.toThrow(message);
  });
});

const randomBucketName = () =>
  rand.generate({
    capitalization: 'lowercase',
    charset: 'alphanumeric',
    length: 32,
  });

const MIB = 1024 * 1024;

let bucket: S3Bucket;

beforeAll(async () => {
  configure({region: 'eu-west-1'});
  bucket = (await S3Bucket.getOrCreateBucket(
    randomBucketName(),
    awsEndpointUrl,
  ))!;
});

const keysUnder = async (prefix: string) =>
  ((await bucket.listObjects(prefix)).Contents ?? []).map(o => o.Key!).sort();

const pendingMultipartUploads = async (key: string) =>
  (
    (
      await new S3({
        endpoint: awsEndpointUrl,
        forcePathStyle: true,
      }).listMultipartUploads({Bucket: bucket.name, Prefix: key})
    ).Uploads ?? []
  ).length;

const writeMiB = async (stream: NodeJS.WritableStream, mib: number) => {
  for (let i = 0; i < mib; i++) {
    if (!stream.write(Buffer.alloc(MIB, i))) await once(stream, 'drain');
  }
};

describe('putObjectStreamed', () => {
  it.each([
    ['empty', 0],
    ['a single part', 1],
    ['several parts', 12],
  ])('uploads %s body with its content type and metadata', async (_, mib) => {
    const key = `streamed/${randomUUID()}`;

    await bucket.putObjectStreamed(key, stream => writeMiB(stream, mib), {
      contentType: 'application/octet-stream',
      metadata: {source: 'test'},
    });

    const object = await bucket.getObject(key);
    expect(object.ContentType).toBe('application/octet-stream');
    expect(object.Metadata).toEqual({source: 'test'});
    const bytes = await object.Body!.transformToByteArray();
    expect(bytes.length).toBe(mib * MIB);
    expect(Array.from({length: mib}, (_, i) => bytes[i * MIB])).toEqual(
      Array.from({length: mib}, (_, i) => i),
    );
  });

  it.each([
    [
      'writeData throws',
      async (stream: NodeJS.WritableStream) => {
        await writeMiB(stream, 12);
        throw new Error('write failed');
      },
      undefined,
      'write failed',
    ],
    [
      'the signal aborts',
      async (stream: NodeJS.WritableStream) => {
        await writeMiB(stream, 12);
        controller.abort(new Error('cancelled'));
        await writeMiB(stream, 12);
      },
      () => controller.signal,
      'cancelled',
    ],
  ])(
    'leaves no object and no multipart upload behind when %s',
    async (_, writeData, signal, message) => {
      controller = new AbortController();
      const key = `streamed/${randomUUID()}`;

      await expect(
        bucket.putObjectStreamed(key, writeData, {signal: signal?.()}),
      ).rejects.toThrow(message);

      expect(await bucket.objectAvailable(key)).toBe(false);
      expect(await pendingMultipartUploads(key)).toBe(0);
    },
  );

  it('fails with the upload error when the upload fails', async () => {
    const missing = new S3Bucket(
      {Name: randomBucketName(), CreationDate: new Date()},
      awsEndpointUrl,
    );

    await expect(
      missing.putObjectStreamed('key', stream => writeMiB(stream, 64)),
    ).rejects.toThrow(/bucket/i);
  });

  it('settles even when writeData misses the stream being destroyed', async () => {
    const aborter = new AbortController();

    await expect(
      bucket.putObjectStreamed(
        `streamed/${randomUUID()}`,
        async stream => {
          stream.write(Buffer.alloc(MIB));
          aborter.abort(new Error('cancelled'));
          await new Promise(resolve => setTimeout(resolve, 100));
          await writeMiB(stream, 1);
        },
        {signal: aborter.signal},
      ),
    ).rejects.toThrow('cancelled');
  });
});

let controller = new AbortController();

describe('exportDataSet', () => {
  const columns: DataSet<Record<string, unknown>>['columns'] = [
    {name: 'id', type: 'INT32', nullable: false},
    {name: 'label', type: 'STRING', nullable: true},
    {name: 'at', type: 'TIMESTAMP', nullable: false},
  ];

  const rowAt = (id: number) => ({
    id,
    label: id % 2 === 0 ? null : `row-${id}`,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, id)),
  });

  const dataSet = (
    name: string,
    getData: DataSet<Record<string, unknown>>['getData'],
  ): DataSet<Record<string, unknown>> => ({name, columns, getData});

  const read = async (key: string) => {
    const {parquetReadObjects} = await import('hyparquet');
    const body = await (
      await bucket.getObject(key)
    ).Body!.transformToByteArray();
    return parquetReadObjects({
      file: body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
    });
  };

  it('streams rows into rotated parquet files and writes _SUCCESS last', async () => {
    const source = async function* () {
      for (let id = 1; id <= 25; id++) yield rowAt(id);
    };

    const result = await exportDataSet(bucket, dataSet('rotated', source), {
      rowGroupSize: 4,
      maxRowsPerFile: 10,
    });

    expect(result).toMatchObject({fileCount: 3, rowCount: 25});
    expect(
      (await keysUnder(result.prefix)).map(k => k.split('/').pop()),
    ).toEqual(['1.parquet', '2.parquet', '3.parquet', '_SUCCESS']);
    const files = await Promise.all(
      [1, 2, 3].map(n => read(`${result.prefix}/${n}.parquet`)),
    );
    expect(files.map(rows => rows.length)).toEqual([10, 10, 5]);
    expect(files.flat().map(r => r.id)).toEqual(
      Array.from({length: 25}, (_, i) => i + 1),
    );
    expect(files[0][0]).toEqual({id: 1, label: 'row-1', at: rowAt(1).at});
    expect(files[0][1]).toEqual({id: 2, label: null, at: rowAt(2).at});
  });

  it('stops pulling rows while the upload is not keeping up', async () => {
    const totalRows = 20_000;
    let produced = 0;
    const source = async function* () {
      for (let id = 1; id <= totalRows; id++) {
        produced++;
        yield {...rowAt(id), label: randomUUID()};
      }
    };
    let releaseUpload!: () => void;
    const uploadMayStart = new Promise<void>(
      resolve => (releaseUpload = resolve),
    );
    const original = bucket.putObjectStreamed.bind(bucket);
    jest
      .spyOn(bucket, 'putObjectStreamed')
      .mockImplementation((key, writeData, options) =>
        original(
          key,
          async (stream, signal) => {
            const stalled = new PassThrough();
            const forwarded = uploadMayStart.then(async () => {
              for await (const chunk of stalled) {
                if (!stream.write(chunk)) await once(stream, 'drain');
              }
            });
            await writeData(stalled, signal);
            stalled.end();
            await forwarded;
          },
          options,
        ),
      );
    const pause = () => new Promise(resolve => setTimeout(resolve, 100));

    const exported = exportDataSet(bucket, dataSet('backpressure', source), {
      rowGroupSize: 100,
    });
    await pause();
    const producedWhileStalled = produced;
    await pause();
    expect(produced).toBe(producedWhileStalled);
    expect(producedWhileStalled).toBeLessThan(totalRows);

    releaseUpload();
    await expect(exported).resolves.toMatchObject({rowCount: totalRows});
    jest.restoreAllMocks();
    expect(produced).toBe(totalRows);
  });

  it('writes one empty file with the declared columns for an empty data set', async () => {
    const result = await exportDataSet(
      bucket,
      dataSet('empty', async function* () {}),
    );

    expect(result).toMatchObject({fileCount: 1, rowCount: 0});
    expect(await read(`${result.prefix}/1.parquet`)).toEqual([]);
    expect(await keysUnder(result.prefix)).toHaveLength(2);
  });

  it.each([
    [
      'the source fails',
      (id: number) => id === 3000 && Promise.reject(new Error('source failed')),
      'source failed',
    ],
    [
      'the export is cancelled',
      (id: number) => id === 3000 && controller.abort(new Error('cancelled')),
      'cancelled',
    ],
  ])(
    'writes no _SUCCESS or partial file and closes the source when %s',
    async (name, atRow, message) => {
      controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      let closed = false;
      const source = async function* (signal?: AbortSignal) {
        receivedSignal = signal;
        try {
          for (let id = 1; id <= 5000; id++) {
            await atRow(id);
            yield rowAt(id);
          }
        } finally {
          closed = true;
        }
      };
      const dataSetName = `failing-${name.replace(/ /g, '-')}`;

      await expect(
        exportDataSet(bucket, dataSet(dataSetName, source), {
          rowGroupSize: 100,
          maxRowsPerFile: 2000,
          signal: controller.signal,
        }),
      ).rejects.toThrow(message);

      expect(
        (await keysUnder(`data-exports/${dataSetName}/`)).map(k =>
          k.split('/').pop(),
        ),
      ).toEqual(['1.parquet']);
      expect(receivedSignal).toBe(controller.signal);
      expect(closed).toBe(true);
    },
  );
});
