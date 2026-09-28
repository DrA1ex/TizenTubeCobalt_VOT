# Project rules

- Keep documentation and new prose in English. Before editing, run `git status --short --branch` here and in `third_party/TizenTube`; preserve existing work.
- This repository builds Android TV APKs from verified Cobalt 27.lts.3 APKs, the pinned `third_party/TizenTube` JavaScript fork, and `native_bridge/`. JavaScript changes belong in the fork; Android code, build scripts, tests, and release docs belong here.
- Follow `BUILDING.md` for inputs and checks. On macOS, `bash tools/build_all_native_vot_apks_macos.sh` builds and verifies `armeabi-v7a`, `arm64-v8a`, and `x86`. There is no `x86_64` base APK. Never claim device testing unless it happened.

## Commits and remote changes

- Local commits are allowed. Commit finished work with descriptive messages after appropriate checks. For JavaScript changes, commit in the fork first, then commit its submodule pointer here.
- **Never push to either repository without the user's explicit permission.** A request to edit, build, test, or commit does not authorize `git push` or any equivalent remote ref update. Keep commits local until permission is given. When publishing this repository, first ensure its submodule commit is available remotely.
- Report local commit hashes and clearly state when they have not been pushed.

## Releases

- GitHub releases are at `https://github.com/DrA1ex/TizenTubeCobalt_VOT/releases`; release history and installation guidance are in `CHANGELOG.md` and `INSTALL-ANDROID.md`.
- For a requested release, update the version, build and verify all three supported APKs, and attach all three to the GitHub release. Use concise notes for users that describe visible changes and identify the APK architectures; keep internal test caveats out of release notes.
- Do not publish a release or push its commits/tags without the user's explicit authorization. A request to create a release authorizes release publication, but does not by itself authorize a repository push; ask before pushing if unpublished commits are needed.
- Keep APKs, downloaded binaries, build output, dependencies, and keystores out of Git. Do not create or commit release checksum sidecar files. Move older local APKs to ignored `archive/releases/`.
- `LOCAL.md` is machine-specific and excluded through this clone's `.git/info/exclude`; never add it to shared `.gitignore` or force-add it.
