import {Readable} from 'node:stream';
import type {ColumnSource} from 'hyparquet-writer';
import {S3Bucket} from './S3Bucket';

export interface DataSet<T extends Record<string, unknown>> {
  name: string;
  columns: Omit<ColumnSource, 'data'>[];
  rows: AsyncIterable<T> | Iterable<T>;
}

async function* toParquet<T extends Record<string, unknown>>(
  {columns, rows}: DataSet<T>,
  rowGroupSize: number,
) {
  const {ByteWriter, ParquetWriter, schemaFromColumnData} =
    await import('hyparquet-writer');
  const toColumnData = (batch: T[]) =>
    columns.map(column => ({...column, data: batch.map(r => r[column.name])}));
  const writer = new ByteWriter();
  const parquet = new ParquetWriter({
    writer,
    schema: schemaFromColumnData({columnData: toColumnData([])}),
  });
  const takeWritten = () => {
    const bytes = Buffer.from(writer.getBuffer());
    writer.index = 0;
    return bytes;
  };
  let batch: T[] = [];
  for await (const row of rows) {
    if (batch.push(row) < rowGroupSize) continue;
    await parquet.write({columnData: toColumnData(batch), rowGroupSize});
    batch = [];
    yield takeWritten();
  }
  await parquet.write({columnData: toColumnData(batch), rowGroupSize});
  await parquet.finish();
  yield takeWritten();
}

export const exportDataSet = async <T extends Record<string, unknown>>(
  bucket: S3Bucket,
  dataSet: DataSet<T>,
  rowGroupSize = 10_000,
) => {
  const prefix = `data-exports/${dataSet.name}/${new Date().toISOString()}`;
  await bucket.putObjectStream(
    `${prefix}/data.parquet`,
    Readable.from(toParquet(dataSet, rowGroupSize)),
    'application/vnd.apache.parquet',
  );
  await bucket.putObject(`${prefix}/_SUCCESS`, 'success', 'text/plain');
  return prefix;
};
