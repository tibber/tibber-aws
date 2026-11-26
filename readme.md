# tibber-aws

[![Backstage](https://img.shields.io/badge/Backstage-catalog-9BF0E1?logo=backstage 'Backstage')](https://tibber.roadie.so/catalog/default/component/tibber-aws)
[![CircleCI](https://img.shields.io/badge/CircleCI-pipelines-343434?logo=circleci 'CircleCI')](https://circleci.com/gh/tibber/tibber-aws)

Thie repo is a typescript wrapper around the AWS SDK for Javascript.

## Installing

Point the `@tibber` scope at GitHub Packages in the consuming repo's `.npmrc`:

```
@tibber:registry=https://npm.pkg.github.com
```

Installing needs a token that can read the org's packages. CircleCI appends it before `yarn install` (`echo "//npm.pkg.github.com/:_authToken=$GITHUB_READONLY_PACKAGES" >> .npmrc`), and Docker builds get it as a build secret, as in `service-template`.

To move off the npmjs package without touching imports, install it under the old name with an alias:

```json
"tibber-aws": "npm:@tibber/tibber-aws@^7"
```

New code can depend on `@tibber/tibber-aws` directly and import from it.

## Releases & publishing — read before merging a PR

Merging to `master` runs the CircleCI `build_and_deploy` workflow. The
`deploy` job runs [semantic-release](https://semantic-release.gitbook.io/),
and **the squash-commit title decides whether a new version is published**
(default conventional-commit rules):

| Squash title | Result |
|---|---|
| `fix: …` / `fix(deps): …` | patch release |
| `feat: …` | minor release |
| `feat!: …` or a `BREAKING CHANGE:` footer | major release |
| `chore: …`, `docs: …`, `refactor: …`, or a plain title (e.g. Renovate's default `Update dependency x to vY`) | **no release** — the merge publishes nothing |

**Merging a dep-update PR (Renovate/Dependabot)?** The default squash title
does *not* publish. If consumers should get the bump (security fixes
especially), edit the squash title to `fix(deps): …` in the merge dialog.
Note: a later release publishes whatever is on `master` at that point, so
unreleased chore-merges still ship with the next `fix`/`feat` release.

**Versioning is tag-based.** The git tag, GitHub release (with generated
notes), and the published package carry the real version — the in-repo `package.json` version
and `CHANGELOG.md` are frozen at v7.0.23 and no release commit is pushed
back to `master` (its branch rules forbid it).

**Publishing goes to GitHub Packages** as `@tibber/tibber-aws`, with the
`GITHUB` context's `GITHUB_AUTH_TOKEN`. Versions up to 7.6.10 were also
published to npmjs as `tibber-aws`; npmjs gets no new versions. The job
publishes only when semantic-release tagged the commit, so the frozen
in-repo version is never published.

**If the deploy job fails after tagging** (e.g. a registry error), the tag
and GitHub release exist but GitHub Packages doesn't have the version. A plain rerun
will no-op ("no new version to release"). Recovery: delete the tag
(`git push origin :refs/tags/vX.Y.Z`), delete the GitHub release if one was
created, then rerun the `deploy` job. A merge with no pending release logs
`No release on this commit, skipping publish` and exits green.

## Version 6.x.x changes
- Migrated to aws sdk 3.x
- Removed ECS Api

## Features

### Queue Message Compression Support
If `Topic.push` rejects a message as too long it will retry with gzip-compression (base64, `contentType: gzip`). The same format `Tibber.Services.Utilities` uses. Messages that fit are never compressed. If you set `contentType` the size error is rethrown.

The library supports automatic decompression of SQS messages compressed with Brotli or GZip. Messages with a `contentType` message attribute set to `brotli` or `gzip` will be automatically decompressed. Consumers that don't use `QueueSubjectListener` can call `decodeSnsMessage(JSON.parse(sqsMessage.Body))` directly.

```typescript
import {QueueSubjectListener, Queue} from '@tibber/tibber-aws';

const queue = await Queue.createQueue('test-queue');
const listener = new QueueSubjectListener(queue);

listener.onSubject('test', async (message, subject) => {
  // Message is automatically decompressed if compressed
  console.log(message);
});

listener.listen();
```

## Usage — application owns the queue/topic

```ts
import {Topic, Queue} from '@tibber/tibber-aws';

const topic = await Topic.createTopic('test-topic', 'test subject');
const topic2 = await Topic.createTopic('test-topic2');

//create (or get) queue
const queue = await Queue.createQueue('test-queue');

//subscribe queue to topics
await queue.subscribeTopic(topic);
await queue.subscribeTopic(topic2);

//push json event to queue
await topic.push({ test: "test" });
await topic2.push({ test: "test2" }, 'test subject2');

//consume queue
const listener = new QueueSubjectListener(queue);
listener.handlers = [handlerFunction];
listener.listen();

```

## Usage — Terraform owns the queue/topic

For services where the queue, topic, and subscription are provisioned by
Terraform. The application attaches to existing resources.

Required IAM (consumer): `sqs:GetQueueUrl`, `sqs:ReceiveMessage`,
`sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`.
Required IAM (publisher): `sns:Publish`, plus `sns:GetTopicAttributes` for
`topic.verify()`.

```ts
import {Queue, QueueSubjectListener, Topic} from '@tibber/tibber-aws';

// Consumer
const listener = new QueueSubjectListener(await Queue.attach('test-queue'));
listener.onSubject('test subject', async (message, subject) => {
  // handle message
});
listener.listen();

// Publisher
const topic = await Topic.attach('test-topic', 'test subject');
await topic.verify() //optional - verifies the topic exists
await topic.push({test: 'test'});
```

## RDS IAM authentication token

The password for an IAM database user, for any database that takes RDS IAM tokens (for example Postgres through
`@tibber/tibber-postgres`).

```ts
import {getRdsIamToken} from '@tibber/tibber-aws';

const password = await getRdsIamToken({hostname, port: 5432, username});
```

The token is cached for 10 minutes per host, port, user and region, because it is valid for 15 minutes and only new
connections need one. A failed request is not cached. `getRdsIamTokenWithExpiry` also returns `expiresAt`, for callers
that decide per connection whether to ask again, and `onGenerated` runs once for each new token. It runs only for the caller that started the request: a caller that
arrives while the request is running shares the pending token and gets no callback. All signers share one credentials
provider, so the credential chain (an STS call under IRSA) is not resolved again for every token.

## Running against an emulator (Floci, LocalStack)

Add a profile to `~/.aws/config`:

```ini
[profile floci]
endpoint_url = http://localhost:4566
region = eu-west-1
aws_access_key_id = test
aws_secret_access_key = test
aws_account_id = 000000000000
```

Set `AWS_PROFILE=floci` inline in the script that starts the service locally, not in `.env` or your shell: dotenv won't
override an `AWS_PROFILE` your shell already exports. A developer without the profile then gets a credentials error, not
their real AWS credentials.

In tests, set the same values as environment variables in the test runner's config (see `jest.config.js`) and delete
`AWS_PROFILE`: when it is set, the JS SDK ignores environment credentials.
