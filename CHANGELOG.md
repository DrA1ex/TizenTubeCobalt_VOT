# Changelog

## v9.0 — stable quality at any speed

- Adds a compact audio button beside the player speed button; moves language, translation, volume, and account preferences into TizenTube settings. Track/language choices remain per video unless explicitly saved as defaults.
- Refreshes audio and provider checks immediately and shows the actual accelerated playback speed.
- Chooses the best quality the decoder can play at the current speed before each video starts, so accelerated 4K60 no longer freezes and videos no longer load twice at startup. For example, a 4K60 video at 1.5× or 2× starts directly in 1440p60 on GX1.
- Starts videos in 1.4–3.6 seconds instead of 7–9 on a network where a YouTube cache node does not answer: unreachable nodes are remembered for an hour and skipped, and a fixed quality is reached during playback without a second black screen.
- Fixes the playback speed entry in the gear menu, which used the stock menu and ignored the selection.
- Adds an icon to the audio and translation button.
- Queues quality changes so rapid speed changes cannot overlap a stream that is still loading, and forgets a quality chosen in the stock menu when another video opens.
- Stops lowering quality during smooth playback. Quality changes only for a new video, a speed change, or an explicit choice.
- Returns speed to 1× when the stock quality menu selects a quality the decoder cannot show at the current speed.
- Keeps higher H.264 levels when the preferred VP9 codec is only available at lower resolutions.
- Keeps translated speech closer to the video by compensating command delay and correcting small drift without audible seeks.
- Removes repeated player-constructor AST parsing.
- Handles null and empty JSON responses and applies batched custom settings once.
- Ignores brief buffered `waiting` events during accelerated playback when video time and frames continue advancing. This prevents false rebuffer reports from repeatedly lowering the player's performance cap.
- Waits for a complete format list before applying a configured quality, and removes quality limits left by earlier builds.
- Includes Cobalt 27.lts.3 Android packages for `armeabi-v7a`, `arm64-v8a`, and `x86`.

## v8.9 — smoother accelerated playback

- Applies a suitable quality limit when playback speed increases and a high-resolution stream becomes too demanding.
- Recovers from sustained stalls and releases the previous video's quality limit when the next video starts.
- Includes Cobalt 27.lts.3 Android packages for `armeabi-v7a`, `arm64-v8a`, and `x86`.

## v8.8 — retry maximum quality for each video

- Resets the maximum-quality trial when a new video starts, so a previous video's recovery step does not limit healthy playback. Sustained stalls can still lower quality. GX1 playback remains unverified.
- Includes Cobalt 27.lts.3 Android packages for `armeabi-v7a`, `arm64-v8a`, and `x86`.

## v8.7 — faster quality recovery

- Detects sustained buffered freezes in about 1.5 seconds at any playback speed and checks empty-buffer stalls separately.
- Retains same-resolution format trials, verifies the selected format, and steps down without reacting to short hiccups, seeks, or suspended timers. GX1 playback remains unverified.

## v8.6 — bilingual GX1/VOT interface

- Adds Russian and English text for the audio menu, translation status, errors, and Android sign-in dialogs. English is used for other languages.
- Moves GX1 audio translations into keyed resources in the TizenTube fork and Android bridge.
- Builds an Android ARM `armeabi-v7a` APK from the pinned Cobalt 27.lts.3 QA base. Local build and tests pass; GX1 device playback is not yet verified.

## v8.5

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
