# Publishing SS14 Studio

This checklist covers the one-time GitHub/repository setup, marketplace
accounts, CI secrets, versioning, and the release process. It is written so a
maintainer can go from a local checkout to an automatically updated extension
in every marketplace.

> **Current status:** the repository is at
> <https://github.com/CrazyPhantom779/ss14-studio> and `main` is pushed. The
> remaining work is creating the marketplace publishers, optionally tightening
> repository settings, adding secrets, and pushing the first `v*` tag. Nothing
> in the extension phones home; updates are delivered by the marketplaces, not
> by a custom updater.

---

## 1. Accounts you need

| Account | Used for | Notes |
| --- | --- | --- |
| GitHub user `CrazyPhantom779` | Source, issues, releases, Actions | Already created. |
| Azure DevOps organisation | VS Code Marketplace publisher + PAT | The Marketplace uses an Azure DevOps PAT, not a GitHub token. |
| Eclipse Foundation account | Open VSX | Sign in with GitHub, then claim the `ss14studio` namespace. |
| JetBrains Account | JetBrains Marketplace | Create the vendor profile `SS14 Studio`. |

The VS Code extension declares `"publisher": "ss14studio"`. Create that
publisher id on both the VS Code Marketplace and Open VSX, or change
`apps/vscode/package.json` to an id you own and rebuild before publishing. The
publisher id does **not** have to match your GitHub username.

The Rider plugin declares vendor `SS14 Studio` and plugin id
`dev.ss14studio.rider` in `apps/rider/build.gradle.kts`.

---

## 2. GitHub repository

The remote is already configured:

```bash
git remote -v
# origin  https://github.com/CrazyPhantom779/ss14-studio.git (fetch)
# origin  https://github.com/CrazyPhantom779/ss14-studio.git (push)
git push -u origin main
```

Keep the default branch named `main`; the workflow triggers on `main` and on
`v*` tags.

### First push checklist

- [x] Repository exists and `main` is pushed.
- [x] `git remote -v` points at `CrazyPhantom779/ss14-studio`.
- [x] The local `releases/` directory is ignored and never committed.
- [ ] Tags use the `v<version>` form, for example `v0.2.0`.

---

## 3. Repository settings

Configure these in **Settings** after the first push. Direct links for this
repository:

| Page | URL |
| --- | --- |
| General | <https://github.com/CrazyPhantom779/ss14-studio/settings> |
| Branches | <https://github.com/CrazyPhantom779/ss14-studio/settings/branches> |
| Tags | <https://github.com/CrazyPhantom779/ss14-studio/settings/tags> |
| Actions | <https://github.com/CrazyPhantom779/ss14-studio/settings/actions> |
| Secrets | <https://github.com/CrazyPhantom779/ss14-studio/settings/secrets/actions> |
| Security | <https://github.com/CrazyPhantom779/ss14-studio/security> |

### General

- [ ] Description: “An all-in-one Space Station 14 development studio for VS
      Code and Rider.”
- [ ] Website: the marketplace listing once it exists.
- [ ] Topics: `space-station-14`, `ss14`, `robust-toolbox`, `yaml`, `xaml`,
      `vscode-extension`, `jetbrains-plugin`, `rsi`.
- [ ] Social preview image (`apps/vscode/media/icon.png` is a good source).
- [ ] Features: Issues on, Discussions optional, Projects optional, Wiki off.
- [ ] Releases: enabled.
- [ ] Include the AI disclosure in the repository description or pinned issue.

### Access and safety

- [ ] Branch protection on `main` (recommended once you have collaborators):
  - Require a pull request before merging.
  - Require status checks: **Test (ubuntu-latest)** and
    **Test (windows-latest)**.
  - Require conversation resolution.
  - Do not allow force pushes or deletions.
  - For a solo repository you can skip this until you start using pull
    requests; GitHub otherwise rejects direct pushes to `main`.
- [ ] Tag protection for `v*` (Settings → Tags → New rule).
- [ ] Actions → General:
  - Allow all actions, or restrict to GitHub-authored actions plus the two
    publishers used below.
  - Workflow permissions: **Read repository contents** by default. The release
    job requests `contents: write` explicitly.
  - Allow GitHub Actions to create pull requests only if you use automation
    that needs it.
- [ ] Security:
  - Enable Dependabot alerts and security updates.
  - The committed CodeQL workflow handles code scanning; do not also enable
    the separate **Default** CodeQL setup.
  - Enable private vulnerability reporting and point it at `SECURITY.md`.
- [ ] Environments: create a `marketplace` environment (optional) and attach
      the publishing secrets there instead of at repository level.

### Secrets

Add these under **Settings → Secrets and variables → Actions → New repository
secret** (<https://github.com/CrazyPhantom779/ss14-studio/settings/secrets/actions>).
Use the exact names below; secret values are write-only after saving.

All marketplace secrets are optional. Without a token the workflow skips that
marketplace and still publishes the GitHub release.

| Secret | Marketplace | How to obtain it |
| --- | --- | --- |
| `VSCE_PAT` | VS Code Marketplace | 1. Sign in at <https://marketplace.visualstudio.com/manage> and create publisher `ss14studio` (or the id you chose). 2. Sign in at <https://dev.azure.com> with the same Microsoft account. 3. User settings → Personal access tokens → **New Token**. 4. Organization: **All accessible organizations**. 5. Scopes: **Custom defined → Marketplace → Manage**. 6. Copy the token once. |
| `OPEN_VSX_TOKEN` | Open VSX | 1. Sign in at <https://open-vsx.org> with GitHub. 2. Claim the `ss14studio` namespace at <https://open-vsx.org/user-settings/namespaces>. 3. Generate a token at <https://open-vsx.org/user-settings/tokens>. |
| `JETBRAINS_MARKETPLACE_TOKEN` | JetBrains Marketplace | 1. Sign in at <https://plugins.jetbrains.com>. 2. Create the vendor profile `SS14 Studio` under <https://plugins.jetbrains.com/author/me>. 3. Generate a token at <https://plugins.jetbrains.com/author/me/tokens>. |
| `JETBRAINS_CERTIFICATE_CHAIN` | Plugin signing | Self-generated certificate, **not** issued by JetBrains. See the commands below and paste the full `chain.crt` PEM text. |
| `JETBRAINS_PRIVATE_KEY` | Plugin signing | The PEM private key from the same key pair. Paste the full PEM text, including the BEGIN/END lines. |
| `JETBRAINS_PRIVATE_KEY_PASSWORD` | Plugin signing | The password chosen while generating the encrypted key. Leave empty if you use an unencrypted key. |

Generate a signing key pair and self-signed certificate (JDK/OpenSSL 3 is
fine; run this outside the repository and never commit the files):

```bash
openssl genpkey -aes-256-cbc -algorithm RSA \
  -out private_encrypted.pem -pkeyopt rsa_keygen_bits:4096
# Choose a password when prompted.
openssl rsa -in private_encrypted.pem -out private.pem
openssl req -key private.pem -new -x509 -days 365 -out chain.crt
```

Use `private_encrypted.pem` as `JETBRAINS_PRIVATE_KEY` and the password you
chose as `JETBRAINS_PRIVATE_KEY_PASSWORD`. If you use the unencrypted
`private.pem` instead, the password secret can be empty. Use `chain.crt` as
`JETBRAINS_CERTIFICATE_CHAIN`.

> Plugin signing is optional for a private listing but recommended for the
> public JetBrains Marketplace. Keep the private key out of the repository and
> out of build logs.

---

## 4. Versioning

The version lives in four places. Bump all of them together:

- `package.json` (root, informational)
- `apps/vscode/package.json` (`version`)
- `apps/vscode/package.json` `scripts.package` output filename
- `apps/rider/gradle.properties` (`pluginVersion`)

`apps/rider/build.gradle.kts` reads `pluginVersion` from Gradle properties, and
the VSIX filename is written by the package script, so a stale filename is the
most common release mistake. Search for the old version before tagging:

```bash
rg "0\.2\.0" --glob '!package-lock.json' --glob '!releases/**'
```

Update `CHANGELOG.md` under `## [Unreleased]` or a new version heading, then
commit:

```bash
git add -A
git commit -m "Release 0.3.0"
git tag v0.3.0
git push origin main --tags
```

The tag starts the full pipeline:

1. **Test** on Ubuntu and Windows.
2. **Package VS Code extension** → VSIX artifact.
3. **Rider sidecar smoke test** against the committed fixture.
4. **Build Rider plugin** → ZIP artifact.
5. **Publish GitHub release** with both artifacts.
6. **Publish VS Code / Open VSX** if the tokens exist.
7. **Publish JetBrains Marketplace** if the token exists.

A failed marketplace job does not block the GitHub release. Fix the secret or
the listing and re-run the failed job from the Actions tab.

---

## 5. Auto-update behaviour

| Install source | Updates |
| --- | --- |
| VS Code Marketplace | Automatic, handled by VS Code. |
| Open VSX (VSCodium, Gitpod, etc.) | Automatic, handled by the client. |
| JetBrains Marketplace | Automatic, handled by Rider. |
| VSIX / ZIP from GitHub Releases | Manual reinstall. There is no self-updater. |
| Side-loaded development build | Manual rebuild/reinstall. |

SS14 Studio intentionally has **no telemetry, accounts or hidden network
calls**. The Rider sidecar binds to `127.0.0.1` only. Auto-update is delegated
to the editor's marketplace, which is the only reliable cross-platform update
path.

To make manual installs easy, every GitHub release contains:

- `ss14-studio-<version>.vsix`
- `ss14-studio-rider-<version>.zip`

---

## 6. Local packaging

```bash
npm ci
npm run check          # typecheck + all tests
npm run package        # releases/ss14-studio-<version>.vsix
npm run package:rider  # apps/rider/build/distributions/ss14-studio-rider-<version>.zip
```

`package:rider` needs JDK 21. On Windows, point `JAVA_HOME` at Rider's bundled
JBR (see the README). The sidecar smoke test is:

```bash
npm run build:rider
node apps/rider/scripts/smoke.mjs
# or against a real checkout:
node apps/rider/scripts/smoke.mjs C:\path\to\SS14\repo
```

---

## 7. Marketplace listing checklist

### VS Code Marketplace

- [ ] Publisher `ss14studio` exists and the signed-in account can publish.
- [ ] `README.md` in `apps/vscode/` renders correctly (it is the listing body).
- [ ] Icon is 128×128 or larger (`apps/vscode/media/icon.png`).
- [ ] Categories and keywords are accurate.
- [ ] AI disclosure is present in the README and in **About**.
- [ ] Repository, homepage and bugs URLs are correct.
- [ ] First publish is done once manually or by the tag pipeline.

### Open VSX

- [ ] Namespace `ss14studio` is claimed.
- [ ] The same VSIX is published; no separate build.
- [ ] The listing links to the GitHub repository.

### JetBrains Marketplace

- [ ] Vendor profile `SS14 Studio` is created.
- [ ] `untilBuild = "263.*"` is intentional for the current release.
- [ ] Plugin ZIP is signed with the project's self-signed certificate.
- [ ] The plugin description includes the AI disclosure and Node.js
      requirement.
- [ ] Compatible Rider versions are checked in the listing.
- [ ] At least one human has installed the ZIP in Rider and opened the tool
      window before the first public listing. This is the one verification step
      that cannot be done in CI.

---

## 8. Release-day checklist

- [ ] `npm run check` passes locally.
- [ ] `npm run build` passes.
- [ ] `npm run package` produces a VSIX.
- [ ] `npm run package:rider` produces a ZIP (JDK 21).
- [ ] `node apps/rider/scripts/smoke.mjs` passes against the fixture.
- [ ] Optional: smoke test against a full Starlight checkout.
- [ ] Versions bumped in all four places.
- [ ] `CHANGELOG.md` updated.
- [ ] Commit, tag `v<version>`, push with `--tags`.
- [ ] Watch the Actions run; confirm the GitHub release and each marketplace.
- [ ] Install the published VSIX in a clean VS Code profile.
- [ ] Install the published ZIP in a clean Rider profile (human check).
- [ ] Pin the release in Discord/README if the project has a community.

---

## 9. Troubleshooting

**`vsce publish` says the publisher does not exist.** The `publisher` field in
`apps/vscode/package.json` must match a publisher you own on that marketplace.
Create it, or change the field and re-release.

**The Rider ZIP is unsigned.** Signing needs all three signing secrets. If they
are missing, `publishPlugin` still uploads the plugin but the marketplace may
show an unsigned-plugin warning. The GitHub release is unaffected. Add the three
secrets and re-run the job to sign it.

**The workflow skipped a marketplace.** That is deliberate when the matching
secret is empty. Add the secret and re-run the job.

**The tag pipeline did not start.** Confirm the tag starts with `v` and was
pushed (`git push origin v0.3.0`), and that Actions are enabled for the
repository.

**Auto-update is not working for a manual install.** Expected: VSIX/ZIP
installs do not self-update. Install from the marketplace or download the new
artifact from GitHub Releases.
