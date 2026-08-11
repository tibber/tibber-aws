module.exports = {
    branches: [
        /**
         * Support releases allowing for fixes and features to non-latest versions.
         *
         * To support a previous verison, create a branch from the previous version tag
         * and name it M.x or M.x.x or M.N.x where M and N are major and minor versions you are
         * supporting, respectively.
         *
         * E.g. If you are supporting version 1.2 specifically, then name the branch '1.2.x'
         * (literally, with the x).
         */
        '+([0-9])?(.{+([0-9]),x}).x',
        /**
         * Regular releases to default @latest channel ('yarn add package' will install it)
         */
        'master',
        /**
         * Early releases to a @next channel, meant as stable release candidates or optional upgrades.
         *
         * Early releases won't be installed with `yarn add <pkg>`, unless the version or tag is
         * explicitly specified. So, `yarn add <pkg>:next` will.
         *
         * These are versions ready to be consumed, but are held back from being the default (@latest)
         * version. This might be used when there is an adoption timeline for the new version,
         * during which using the new version is optional, or in an RFC (Request for Comments).
         */
        'next',
        /**
         * Pre-releases are unstable and published for testing and preview purposes.
         *
         * Pre-release versions take the form M.N.P-<branch>.X where
         *  - M, N and P are the major, minor and patch number of the semver that will be published
         *    upon on completion,
         *  - <branch> is the name of the branch on which development is taking place, and
         *  - X is the revision number.
         *
         * Pre-releases won't be installed with `yarn add <pkg>`, unless the version or tag is
         * explicitly specified. So, `yarn add <pkg>:v3.2.1-branch.1` will.
         *
         * In order to publish a pre-release package, ensure you branch name conforms to semver
         * guidelines, and consists of only numbers, alphanumeric characters and dashes (-).
         *
         * If the repository contains single-word branches that contain invalid characters,
         * semantic-release will fail even if they are not the branch currently being
         * released. This is a known issue:
         * https://github.com/semantic-release/semantic-release/issues/1717
         */
        {
            /**
             * pre-release as vX.X.X-<branch>.N from the last version tag in branch's commit history
             */
            name: '*',
            prerelease: true
        }],
    plugins: [
        /**
         * Reads and inspects commits since the last released version for conventional commit messages.
         */
        "@semantic-release/commit-analyzer",
        /**
         * Interprets and assembles the conventional commit messages for use in later steps, and determines
         * the next semver for release.
         */
        "@semantic-release/release-notes-generator",
        /**
         * Patches package.json with the new semver. Publishing is done by the
         * CI job itself via CircleCI OIDC trusted publishing (npm >= 11.11,
         * no stored token) — with npmPublish off, this plugin also skips its
         * NPM_TOKEN verification.
         */
        ["@semantic-release/npm", { "npmPublish": false }],
        /**
         * Pushes the release and its release notes to its GitHub repository.
         *
         * Releases are tag-based only: master's repository rules forbid direct
         * pushes, which broke the old @semantic-release/git + changelog plugins
         * (every release after v7.0.23 failed on the push-back). The version's
         * source of truth is the git tag + GitHub release + npm; the in-repo
         * package.json version and CHANGELOG.md are frozen at v7.0.23.
         */
        "@semantic-release/github",
    ]
};
