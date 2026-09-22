# tibber-aws
Thie repo is a typescript wrapper around the AWS SDK for Javascript.

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
| `chore: …`, `docs: …`, `refactor: …`, or a plain title (e.g. Renovate's default `Update dependency x to vY`) | **no release** — the merge ships nothing to npm |

**Merging a dep-update PR (Renovate/Dependabot)?** The default squash title
does *not* publish. If consumers should get the bump (security fixes
especially), edit the squash title to `fix(deps): …` in the merge dialog.
Note: a later release publishes whatever is on `master` at that point, so
unreleased chore-merges still ship with the next `fix`/`feat` release.

**Versioning is tag-based.** The git tag, GitHub release (with generated
notes), and npm carry the real version — the in-repo `package.json` version
and `CHANGELOG.md` are frozen at v7.0.23 and no release commit is pushed
back to `master` (its branch rules forbid it).

**Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)**
via CircleCI OIDC — there is no stored npm token. Requirements: the
npmjs.com trusted-publisher entry for this package (CircleCI, org `tibber`,
project `tibber-aws`, job `deploy`) and npm ≥ 11.11 in the job (the
`cimg/node:24` image). Provenance is attached automatically.

**If the deploy job fails after tagging** (e.g. a registry error), the tag
and GitHub release exist but npm doesn't have the version. A plain rerun
will no-op ("no new version to release"). Recovery: delete the tag
(`git push origin :refs/tags/vX.Y.Z`), delete the GitHub release if one was
created, then rerun the `deploy` job. A merge with no pending release logs
`already published, skipping` and exits green.

## Version 6.x.x changes
- Migrated to aws sdk 3.x
- Removed ECS Api

## Features

### Queue Message Compression Support
The library now supports automatic decompression of SQS messages compressed with Brotli or GZip. Messages with a `contentType` message attribute set to `brotli` or `gzip` will be automatically decompressed.

```typescript
import {QueueSubjectListener, Queue} from 'tibber-aws';

const queue = await Queue.createQueue('test-queue');
const listener = new QueueSubjectListener(queue);

listener.onSubject('test', async (message, subject) => {
  // Message is automatically decompressed if compressed
  console.log(message);
});

listener.listen();
```

## Usage — application owns the queue/topic

```
import {Topic, Queue} from 'tibber-aws';

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
Required IAM (publisher): `sns:Publish`.

```ts
import {AttachedQueueListenerBuilder, Queue, Topic} from 'tibber-aws';

// Consumer
const queue = await Queue.attach('test-queue');
const listener = new AttachedQueueListenerBuilder(queue).build();
listener.onSubject('test subject', async (message, subject) => {
  // handle message
});
listener.listen();

// Publisher
const topic = Topic.fromArn(process.env.TOPIC_ARN!, 'test subject');
await topic.push({test: 'test'});
```
