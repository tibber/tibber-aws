const getAuthToken = jest.fn();
const signerCtor = jest.fn();
jest.mock('@aws-sdk/rds-signer', () => ({
  Signer: function (this: unknown, options: unknown) {
    signerCtor(options);
    return {getAuthToken};
  },
}));

// The tests run from the compiled dist folder, where jest does not hoist jest.mock, so the import comes after it.
import {getRdsIamToken, getRdsIamTokenWithExpiry} from '../src';

// Every test uses its own user, because the cache lives for the whole test file.
let counter = 0;
const target = () => ({
  hostname: 'db.example.com',
  port: 5432,
  username: `user_${++counter}`,
});

describe('getRdsIamToken', () => {
  beforeEach(() => {
    jest.useRealTimers();
    getAuthToken.mockReset();
    getAuthToken.mockResolvedValue('iam-token');
    signerCtor.mockClear();
  });

  it('signs for the given host, port, user and region', async () => {
    const t = {...target(), region: 'eu-north-1'};
    await expect(getRdsIamToken(t)).resolves.toBe('iam-token');
    expect(signerCtor).toHaveBeenCalledWith({
      hostname: t.hostname,
      port: 5432,
      username: t.username,
      region: 'eu-north-1',
    });
  });

  it('returns the cached token within 10 minutes and a new one after', async () => {
    jest.useFakeTimers();
    const t = target();
    await getRdsIamToken(t);
    jest.advanceTimersByTime(9 * 60 * 1000);
    await getRdsIamToken(t);
    expect(getAuthToken).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60 * 1000 + 1);
    await getRdsIamToken(t);
    expect(getAuthToken).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    const t = target();
    await Promise.all([getRdsIamToken(t), getRdsIamToken(t), getRdsIamToken(t)]);
    expect(getAuthToken).toHaveBeenCalledTimes(1);
  });

  it('keeps tokens for different users, hosts and regions apart', async () => {
    const t = target();
    await getRdsIamToken(t);
    await getRdsIamToken({...t, username: `${t.username}_other`});
    await getRdsIamToken({...t, hostname: 'other.example.com'});
    await getRdsIamToken({...t, region: 'eu-west-1'});
    expect(getAuthToken).toHaveBeenCalledTimes(4);
  });

  it('does not cache a failed request', async () => {
    const t = target();
    getAuthToken.mockRejectedValueOnce(new Error('boom'));
    await expect(getRdsIamToken(t)).rejects.toThrow('boom');
    await expect(getRdsIamToken(t)).resolves.toBe('iam-token');
  });

  it('turns a synchronous signer error into a rejected token and does not cache it', async () => {
    const t = target();
    getAuthToken.mockImplementationOnce(() => {
      throw new Error('no region');
    });
    await expect(getRdsIamTokenWithExpiry(t).token).rejects.toThrow('no region');
    await expect(getRdsIamToken(t)).resolves.toBe('iam-token');
  });

  it('a late failure of an expired request leaves the newer token alone', async () => {
    jest.useFakeTimers();
    const t = target();
    let rejectFirst: (err: Error) => void = () => {};
    getAuthToken.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFirst = reject;
      })
    );
    const first = getRdsIamToken(t);
    first.catch(() => {});
    jest.advanceTimersByTime(10 * 60 * 1000 + 1);
    await getRdsIamToken(t);
    expect(getAuthToken).toHaveBeenCalledTimes(2);
    rejectFirst(new Error('late'));
    await expect(first).rejects.toThrow('late');
    await getRdsIamToken(t);
    expect(getAuthToken).toHaveBeenCalledTimes(2);
  });

  it('reports when the token expires', async () => {
    jest.useFakeTimers();
    const t = target();
    const entry = getRdsIamTokenWithExpiry(t);
    expect(entry.expiresAt).toBe(Date.now() + 10 * 60 * 1000);
    await entry.token;
  });

  it('calls onGenerated for new tokens only', async () => {
    const onGenerated = jest.fn();
    const t = target();
    await getRdsIamToken(t, {onGenerated});
    await getRdsIamToken(t, {onGenerated});
    expect(onGenerated).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing onGenerated callback', async () => {
    const t = target();
    const onGenerated = jest.fn(() => {
      throw new Error('logger closed');
    });
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    await expect(getRdsIamToken(t, {onGenerated})).resolves.toBe('iam-token');
    await new Promise(resolve => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);
    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('does not mix up targets whose fields contain a colon', async () => {
    await getRdsIamToken({hostname: 'a', port: 5432, username: 'b:c'});
    await getRdsIamToken({hostname: 'a:b', port: 5432, username: 'c'});
    expect(getAuthToken).toHaveBeenCalledTimes(2);
  });

  it('hands out an entry that callers cannot change', () => {
    const entry = getRdsIamTokenWithExpiry(target());
    expect(Object.isFrozen(entry)).toBe(true);
  });
});
