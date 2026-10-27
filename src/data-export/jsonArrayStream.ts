export async function* parseJsonArrayStream<T = unknown>(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let closed = false;
  let element = '';

  const parseElement = (text: string): T[] => {
    const trimmed = text.trim();
    return trimmed === '' ? [] : [JSON.parse(trimmed)];
  };

  const scan = function* (text: string): Generator<T> {
    let from = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (closed) {
        if (char.trim() !== '') {
          throw new Error('Unexpected content after the end of the JSON array');
        }
        continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (depth === 0) {
        if (char === '[') {
          depth = 1;
          from = i + 1;
        } else if (char.trim() !== '') {
          throw new Error('Expected the body to be a JSON array');
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '[' || char === '{') {
        depth++;
      } else if (char === ']' || char === '}') {
        depth--;
        if (depth === 0) {
          yield* parseElement(element + text.slice(from, i));
          element = '';
          closed = true;
        }
      } else if (char === ',' && depth === 1) {
        yield* parseElement(element + text.slice(from, i));
        element = '';
        from = i + 1;
      }
    }
    if (!closed && depth > 0) element += text.slice(from);
  };

  for await (const chunk of chunks) {
    yield* scan(decoder.decode(chunk, {stream: true}));
  }
  yield* scan(decoder.decode());
  if (!closed) {
    throw new Error('The JSON array ended before its closing bracket');
  }
}
