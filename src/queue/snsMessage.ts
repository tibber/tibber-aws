import {promisify} from 'util';
import {brotliDecompress, gunzip} from 'zlib';

/**
 * Publishers send to SNS, which delivers to the queue without raw message
 * delivery, so the SQS message body is the SNS envelope and the message
 * attributes sit inside it rather than on the SQS message itself.
 */
export type SnsEnvelope = {
  Subject: string;
  Message: string;
  MessageAttributes?: Record<string, {Type?: string; Value?: string}>;
};

const decompressors = new Map<string, (buffer: Buffer) => Promise<Buffer>>([
  ['brotli', promisify(brotliDecompress)],
  ['gzip', promisify(gunzip)],
]);

export const compressionOf = ({MessageAttributes}: SnsEnvelope) => {
  const contentType = MessageAttributes?.contentType?.Value ?? '';
  return decompressors.has(contentType) ? contentType : undefined;
};

export const decodeSnsMessage = async (envelope: SnsEnvelope) => {
  const decompress = decompressors.get(compressionOf(envelope) ?? '');
  const message = decompress
    ? (await decompress(Buffer.from(envelope.Message, 'base64'))).toString()
    : envelope.Message;
  return JSON.parse(message);
};
