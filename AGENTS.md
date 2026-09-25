# Repository rules

- Keep documentation and new prose in English.
- Before editing, inspect `git status --short --branch` in this repository and in `third_party/TizenTube`. Preserve existing user work.
- JavaScript changes belong in the TizenTube fork submodule. Commit and push those changes there first, then update and commit the submodule pointer in this repository. Android bridge, build scripts, tests, and release docs belong here.
- Commit completed user requirements with descriptive messages after appropriate checks. Report commit hashes and any push limitation. Never leave a submodule pointer that refers to an unpublished commit when publishing this repository.
- Keep APKs, downloaded Cobalt and tool binaries, build output, dependencies, and keystores out of Git. Move older local APKs and hashes to ignored `archive/releases/`.
- `LOCAL.md` is machine-specific and excluded through this clone's `.git/info/exclude`; do not add it to shared `.gitignore` or force-add it.
- Follow `BUILDING.md` for verified inputs and checks. Do not claim device testing unless it happened.
