# Changelog

## v8.5 — current GX1 build configuration

- Tries a lighter stream at the same resolution before lowering resolution, verifies the selected format, and restores the previous choice when needed.
- The source and full APK build pass local checks. Playback smoothness and audio synchronization on GX1 remain unverified.

## v8.4

- Limits accelerated playback load using resolution, frame rate, and speed; lowers quality again after sustained stalls.

## v8.3

- Fixes the Cobalt speed and quality regression and simplifies startup.

## v8.2

- Reduces repeated userscript work and improves native translation routing and error handling.

## v8.0–v8.1

- Moves to the official Cobalt 27.lts.3 Android ARM QA base and updates playback speed handling.

## v7.x

- Develops the audio and translation menus, track readiness handling, and native VOT bridge; fixes GX1 startup and synchronization issues.
