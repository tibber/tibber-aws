/**
 * Consumer probe — runtime half.
 *
 * Runs inside a scratch project that installed tibber-aws from a packed
 * tarball, so it exercises what a consuming service actually gets: `main`, the
 * emitted `dist/src/**` JS, CommonJS `require` resolution, and the AWS SDK
 * dependencies resolving from the package's own tree. The repo's own tests
 * import from `../src`, so they cannot catch a broken build, a bad `files`
 * list, or a renamed export.
 *
 * Deliberately makes NO AWS calls. Behavioural coverage against Floci belongs
 * in the `build` job; this probe gates publishing, so it stays hermetic and
 * fast — a release must not hinge on a container booting.
 *
 * Exits non-zero with a specific message on the first failure.
 */
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const expected = JSON.parse(readFileSync(join(__dirname, 'expected-exports.json'), 'utf8')).exports;

const lib = require('tibber-aws');

// ── export surface ──────────────────────────────────────────────────────────
const actual = Object.keys(lib).sort();
assert.deepEqual(
  actual,
  Object.keys(expected).sort(),
  `public export surface drifted from expected-exports.json\n  expected: ${Object.keys(expected).sort()}\n  actual:   ${actual}`
);

for (const [name, kind] of Object.entries(expected)) {
  assert.equal(typeof lib[name], kind, `export '${name}' should be a ${kind}, got ${typeof lib[name]}`);
}

// ── the emitted JS is actually usable ───────────────────────────────────────
// configure() only sets AWS_REGION, so it is safe to call and proves the
// emitted module executes rather than merely resolving.
const regionBefore = process.env.AWS_REGION;
try {
  lib.configure({region: 'eu-west-1'});
  assert.equal(process.env.AWS_REGION, 'eu-west-1', 'configure() must set AWS_REGION');
} finally {
  if (regionBefore === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = regionBefore;
}

// Constructing S3Bucket instantiates an @aws-sdk/client-s3 client without
// issuing a request — this is the cheapest proof that the SDK dependencies
// resolve and initialise from the installed tree, which a source-level test
// never checks (it resolves them from the repo's own node_modules).
const bucket = new lib.S3Bucket({Name: 'probe-bucket', CreationDate: new Date(0)});
assert.equal(bucket.name, 'probe-bucket', 'S3Bucket must expose the bucket name');
assert.ok(bucket.creationDate instanceof Date, 'S3Bucket must expose creationDate as a Date');

// The constructor's documented guard must survive compilation.
assert.throws(
  () => new lib.S3Bucket({CreationDate: new Date(0)}),
  /Name/,
  'S3Bucket must reject a bucket with no Name'
);

console.log(`  ✓ runtime: ${actual.length} exports, configure(), and S3Bucket construct from the installed tarball`);
