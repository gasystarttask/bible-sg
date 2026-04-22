# Releasing a New Version

## Prerequisites

- Write access to the repository on the `main` branch.
- No uncommitted changes – all work merged via pull request before releasing.

## Steps

1. **Go to Actions**  
   Open the repository on GitHub → **Actions** tab.

2. **Run the Release workflow**  
   Select **Release** in the left sidebar → click **Run workflow**.

3. **Enter the version**  
   Fill in the **version** field using [Semantic Versioning](https://semver.org) (e.g. `1.2.3`).  
   Do **not** include the `v` prefix; the workflow adds it automatically.

4. **Confirm**  
   Click the green **Run workflow** button.

## What happens automatically

| Step | Description |
|------|-------------|
| Validate | Checks the tag does not already exist. Fails fast if it does. |
| Changelog | Collects all commits since the previous tag (or all commits for the first release) and formats them as a list. |
| Tag | Creates and pushes an annotated Git tag (`v<version>`). |
| GitHub Release | Opens a GitHub Release with the generated changelog as the description. |
| Docker build | Builds the `bible-chat-scholar` image for `linux/amd64` and `linux/arm64`. |
| Docker push | Pushes both `ghcr.io/<owner>/bible-chat-scholar:v<version>` and `:latest` to GHCR. |

## Version conventions

- `MAJOR.MINOR.PATCH` – follow [SemVer](https://semver.org):
  - **PATCH** — bug fixes (e.g. `1.0.1`)
  - **MINOR** — new backward-compatible features (e.g. `1.1.0`)
  - **MAJOR** — breaking changes (e.g. `2.0.0`)

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Tag already exists` | Version was already released | Bump to the next version |
| Build fails on `arm64` | QEMU emulation issue | Re-run the job; transient failures are common |
| GHCR push denied | Missing `packages: write` permission on the repo | Go to **Settings → Actions → General** and allow write permissions |
