import {fromNodeProviderChain} from '@aws-sdk/credential-providers';
import {Signer} from '@aws-sdk/rds-signer';

export type RdsIamTokenTarget = {
  hostname: string;
  port: number;
  username: string;
  /** Defaults to the SDK's own region lookup (AWS_REGION). */
  region?: string;
};

export type RdsIamTokenOptions = {
  /**
   * Called once for every new token that was generated successfully, not for cached ones. Only the caller that
   * created the cache entry gets it: a second caller that arrives while the request is still running shares the
   * pending token and its callback is not called.
   */
  onGenerated?: () => void;
};

export type RdsIamTokenWithExpiry = {
  token: Promise<string>;
  /** Epoch milliseconds. After this the next call asks AWS for a new token. */
  expiresAt: number;
};

// One credentials provider for all signers. A new Signer would resolve the credential chain again, which under
// IRSA is an STS AssumeRoleWithWebIdentity call. The provider caches the credentials until they expire.
const credentials = fromNodeProviderChain();

// A token is valid for 15 minutes and is only needed for NEW connections. Reusing it for 10 minutes stays well
// inside the validity and gives knex one expiry time to check.
const TOKEN_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, Readonly<RdsIamTokenWithExpiry>>();

const dropExpired = (now: number) => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

/**
 * An RDS IAM authentication token (the password for an IAM database user), cached for 10 minutes per host, port,
 * user and region. Also returns when the cached token expires, for callers that decide per connection.
 * A failed request is not cached.
 */
export const getRdsIamTokenWithExpiry = (
  target: RdsIamTokenTarget,
  options: RdsIamTokenOptions = {}
): Readonly<RdsIamTokenWithExpiry> => {
  const {hostname, port, username, region} = target;
  const key = JSON.stringify([hostname, port, username, region ?? '']);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  dropExpired(now);

  let token: Promise<string>;
  try {
    token = new Signer({hostname, port, username, region, credentials}).getAuthToken();
  } catch (err) {
    return Object.freeze({token: Promise.reject(err), expiresAt: now});
  }
  const entry = Object.freeze({token, expiresAt: now + TOKEN_TTL_MS});
  cache.set(key, entry);
  token.then(
    () => {
      try {
        options.onGenerated?.();
      } catch {
        // A failing callback must not become an unhandled rejection.
      }
    },
    () => {
      // Leave a newer entry for the same key alone.
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
    }
  );
  return entry;
};

/** See getRdsIamTokenWithExpiry. */
export const getRdsIamToken = (
  target: RdsIamTokenTarget,
  options?: RdsIamTokenOptions
): Promise<string> => getRdsIamTokenWithExpiry(target, options).token;
