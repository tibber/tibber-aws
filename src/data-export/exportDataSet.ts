import {once} from 'node:events';
import {Writable} from 'node:stream';
import type {ByteWriter, ColumnSource} from 'hyparquet-writer';
import {S3Bucket} from '../s3';

export type DataSetColumn = Omit<ColumnSource, 'data'>;

export interface DataSet<T extends Record<string, unknown>> {
  name: string;
  columns: DataSetColumn[];
  getData: (signal?: AbortSignal) => AsyncIterable<T>;
}

export interface ExportOptions {
  rowGroupSize?: number;
  maxRowsPerFile?: number;
  signal?: AbortSignal;
}

export interface ExportResult {
  prefix: string;
  fileCount: number;
  rowCount: number;
}

const PARQUET_CONTENT_TYPE = 'application/vnd.apache.parquet';

const createStreamWriter = (
  ByteWriterClass: typeof ByteWriter,
  stream: Writable,
) => {
  const writer = new ByteWriterClass();
  const flush = async () => {
    if (stream.destroyed) throw stream.errored ?? new Error('stream destroyed');
    const chunk = Buffer.from(writer.buffer.slice(0, writer.index));
    writer.index = 0;
    if (!stream.write(chunk)) await once(stream, 'drain');
  };
  return Object.assign(writer, {flush, finish: flush});
};

export const exportDataSet = async <T extends Record<string, unknown>>(
  bucket: S3Bucket,
  dataSet: DataSet<T>,
  {
    rowGroupSize = 10_000,
    maxRowsPerFile = Infinity,
    signal,
  }: ExportOptions = {},
): Promise<ExportResult> => {
  const {ByteWriter: ByteWriterClass, parquetWriteRows} =
    await import('hyparquet-writer');
  const prefix = `data-exports/${dataSet.name}/${new Date().toISOString()}`;
  const iterator = dataSet.getData(signal)[Symbol.asyncIterator]();
  let rowCount = 0;
  let fileCount = 0;

  try {
    let next = await iterator.next();
    const takeFileRows = async function* () {
      for (let taken = 0; taken < maxRowsPerFile && !next.done; taken++) {
        rowCount++;
        yield next.value;
        next = await iterator.next();
      }
    };

    do {
      fileCount++;
      await bucket.putObjectStreamed(
        `${prefix}/${fileCount}.parquet`,
        async stream => {
          await parquetWriteRows({
            writer: createStreamWriter(ByteWriterClass, stream),
            rows: takeFileRows(),
            columns: dataSet.columns,
            rowGroupSize,
          });
        },
        {contentType: PARQUET_CONTENT_TYPE, signal},
      );
    } while (!next.done);
  } finally {
    await iterator.return?.();
  }

  await bucket.putObject(`${prefix}/_SUCCESS`, 'success', 'text/plain');
  return {prefix, fileCount, rowCount};
};
