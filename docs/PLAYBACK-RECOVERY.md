# Playback recovery and audio controls

## Audio controls

The player has an **Audio and translation** transport button beside the speed button. The quick menu contains the current video's track, translation language, and an explicit **Save as default** action. Choosing a track or language applies to the current video; saving also enables the saved selection rules for future videos. A concrete YouTube track saves its language rather than the previous translation language.

Automatic selection, provider preference, visible YouTube languages, waiting behavior, translation/original volumes, and Yandex sign-in are in YouTube settings → TizenTube → Audio preferences. The guide no longer adds an audio shortcut, and the stock playback-settings audio entry is removed when the unified audio flow is enabled.

Audio checks follow the requested track, including a translation that is still preparing. Updating an audio popup replaces its active renderer while retaining the parent popup. This avoids clients that keep old checks during an in-place update.

## Quality selection

The Cobalt media speed remains separate from YouTube's internal API rate. With an internal rate above 1, the TV player caps every accelerated high-frame-rate video at 1080p and resets speed to 1× when a higher quality is chosen. The public speed getter and menu captions show the actual media speed; the original getter is retained for internal rate resets.

Quality is chosen before each video loads rather than lowered after playback problems:

- The target is the configured maximum (or Auto), limited to the highest level that the platform decoder can decode at the current speed. A level qualifies when each of its formats that plays at 1× also passes `MediaSource.isTypeSupported` with its width, height, and `framerate` set to the format's frame rate multiplied by the speed.
- YouTube reads a sticky maximum (`yt-player-quality`) when the next video's loader starts. The controller writes it while the player response is parsed, so the first stream already has the target quality. At startup it removes temporary caps left by older builds.
- A fixed preference is locked to the target once the video's metadata is available. When the stream already matches, this call does not restart it. Auto remains adaptive: the target is only an upper bound, and a stream is replaced only when it exceeds the decoder limit.
- Every range change restarts the TV player's media source (about 1.3–3 seconds without a picture on GX1), so quality changes only for a new video, a speed change in either direction, or a changed setting. Changes are queued: while one is loading (up to 3 seconds, or until playback resumes), newer requests wait and only the latest target is applied. Rapid speed changes therefore cause at most one stream change after the first.
- The choice is made as soon as the format list exists, at the start of loading. The player then upgrades an adaptive first stream to the chosen quality during playback, without a second black screen.
- A choice in the stock quality menu is kept for the current video only, and is forgotten when another video opens. If the decoder cannot show it at the current speed, speed returns to 1×.
- The preferred codec filter keeps other codecs for levels above the preferred codec's maximum, so a video with VP9 only up to 240p can still use a higher H.264 level.

### Video start and cache nodes

A video URL names a cache node (`rrN---sn-….googlevideo.com`) and lists fallback nodes in `mn`. When the first node does not answer, the TV player waits about 5.4 seconds before it uses the next one, which shows as a black screen at every video start. On the tested network one node never answered (TCP timeout) while the others answered in 0.15–0.45 seconds.

TizenTube remembers node reachability: an unknown node is probed once (`generate_204`, 2.5 second timeout), a dead node is avoided for an hour and a live one trusted for 30 minutes, and the list is stored in `localStorage` (`tt-cdn-node-health`). While a node is dead, the streaming URLs of the player response start with the next node from `mn`, which is the node the player would have chosen itself after its timeout. The first video after a node fails, or after the entry expires, can still pay the delay once. Measured on GX1 with the list active: first picture 1.4–3.6 seconds after opening a video, compared with 7–9 seconds.

### Why not playback telemetry

Earlier builds lowered quality from frame counters, the media clock, and buffered ranges. On GX1 this was unreliable in both directions:

- Cobalt updates `getVideoPlaybackQuality()` counters in bursts about every 1.5–2.5 seconds. The frozen-picture rule therefore fired during smooth playback, even at 1×, and stepped 720p down to 240p within about 30 seconds.
- When the decoder cannot keep up (4K60 at 1.5× or 2×), audio and `currentTime` continue normally, frame counters show no drops, and Starboard logs video frames lagging 5, 10, then 15 seconds behind media time. Only the video layer shows the freeze.

Measured on GX1 (RTD1325, VP9): `isTypeSupported` accepts 2160p up to 60 fps, 1440p up to 150 fps, and 1080p up to 240 fps. SurfaceFlinger presentation matched these limits: 4K60 froze at 1.5× and 2×, while 1440p60 at 2× and 1080p60 at 2× were presented at the 60 Hz display rate without lag warnings.

## Player controls

The stock playback-speed entry in the gear menu is found by either icon name the TV client has used (`SLOW_MOTION_VIDEO`, `SPEEDOMETER`), so it opens TizenTube's speed list and the chosen speed applies. The audio and translation button has no glyph in the TV client; a translate icon is drawn by CSS for buttons labeled with that name in each supported language.

## Translation synchronization

Native translated speech follows the video clock. The bridge compensates the local command delay using the command's send time. Drift from 100 ms to 1 second is corrected by playing 4% (above 500 ms, 8%) faster or slower until it is below 50 ms; only larger jumps seek. With these rules, measured drift on GX1 stayed within about ±55 ms at 1.25× and 1.5×. The native status response includes position diagnostics for such checks.

## Verification and limits

The automated suite covers decoder ceilings for 30 and 60 fps content at several speeds, codec fallback, sticky storage, single-load startup, speed changes in both directions, Auto bounds, new videos, setting changes, stock menu choices, and incomplete quality lists. The APK builder additionally tests the Java drift policy and verifies signing, alignment, embedded assets, and DEX startup links for `armeabi-v7a`, `arm64-v8a`, and `x86`.

The GX1 measurements above used the `armeabi-v7a` build. Network capacity is left to YouTube: a fixed quality does not step down when the connection is too slow, while Auto does. Devices whose `isTypeSupported` ignores `framerate` get no speed limit from this policy.

One hang was seen on GX1 after rapid navigation between two videos: the player stayed in buffering at 910 s of a two-hour video with no network requests, and the page kept running. Its cause was not established. Range changes are now queued so none overlaps a loading stream, but no watchdog unsticks a hung player.
