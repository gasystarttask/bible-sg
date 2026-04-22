# How to Create a Release Tag

## When to create a tag

Create a new version tag when you ship something meaningful to end users:

| Situation | Example bump |
|-----------|-------------|
| A bug is fixed and users should update | `1.0.0` → `1.0.1` |
| A new feature is added (no breaking change) | `1.0.1` → `1.1.0` |
| An API or behaviour changes in a breaking way | `1.1.0` → `2.0.0` |
| A long-lived beta is stable enough to ship | `2.0.0-beta.3` → `2.0.0` |

**Do not** create a tag just because code was merged. Tags are public signals — they tell users, downstream services, and Docker image consumers that a tested, intentional version is ready.

## Why version tags matter

- **Traceability** — every Docker image (`bible-chat-scholar:v1.2.3`) maps to an exact commit.
- **Automated changelog** — the release pipeline collects commits between two tags automatically.
- **Rollback** — pulling a specific tag gives a known-good image at any time.
- **Communication** — a GitHub Release with a changelog tells collaborators what changed and why.

## Versioning scheme (SemVer)

```
MAJOR.MINOR.PATCH   →   1.4.2
```

| Segment | Increment when… |
|---------|----------------|
| `MAJOR` | You break backwards compatibility (API change, config rename, removed feature) |
| `MINOR` | You add functionality in a backwards-compatible way |
| `PATCH` | You fix a bug without changing any interface |

Pre-release suffixes: `1.0.0-alpha.1`, `1.0.0-beta.2`, `1.0.0-rc.1`

## Steps to release a new version

### 1. Prepare the branch

Ensure `main` is in the state you want to release:

```bash
git checkout main
git pull origin main
```

All features and fixes for this version must already be merged. Do not commit directly to `main` after this point until the release is done.

### 2. Decide the next version

Look at the latest tag to determine what to bump:

```bash
git describe --tags --abbrev=0   # prints the most recent tag, e.g. v1.1.0
```

Apply SemVer rules from the table above to pick the new version (e.g. `1.2.0`).

### 3. Trigger the Release workflow

1. Open the repository on GitHub.
2. Go to **Actions** → **Release** (left sidebar).
3. Click **Run workflow** (top right of the run list).
4. Enter the version number **without** the `v` prefix, e.g. `1.2.0`.
5. Click the green **Run workflow** button.

The pipeline will:
- Validate the tag does not exist yet
- Generate a changelog from commits since the previous tag
- Create and push the annotated Git tag `v1.2.0`
- Open a GitHub Release with the changelog
- Build and push `ghcr.io/<owner>/bible-chat-scholar:v1.2.0` and `:latest` for `amd64` + `arm64`

### 4. Verify the release

After the workflow succeeds:

- Check the **Releases** page on GitHub for the new entry and its changelog.
- Confirm the Docker image is listed under **Packages**.
- Pull and smoke-test locally if needed:

```bash
docker pull ghcr.io/<owner>/bible-chat-scholar:v1.2.0
docker run --rm -p 3000:3000 \
  -e OPENAI_API_KEY=<key> \
  -e DATABASE_URL=<uri> \
  ghcr.io/<owner>/bible-chat-scholar:v1.2.0
```

## Hotfix release (PATCH on a previous version)

If `main` already has unreleased work and you need to patch an older version:

```bash
git checkout v1.1.0            # check out the tag you want to patch
git checkout -b hotfix/1.1.1   # create a hotfix branch
# apply your fix, commit
git push origin hotfix/1.1.1
```

Then open a PR to `main` as well to keep the fix in the main line. Once the hotfix branch is ready, trigger the Release workflow **from that branch**.

## Common mistakes to avoid

| Mistake | Why it is a problem |
|---------|---------------------|
| Tagging an untested commit | Users pull a broken image |
| Skipping MINOR and jumping MAJOR | Breaks semantic meaning for consumers |
| Creating tags manually without the workflow | Docker image is not built for the tag |
| Releasing directly from a feature branch | Changelog will include unreviewed commits |
