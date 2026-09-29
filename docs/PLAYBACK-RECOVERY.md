# Playback recovery and audio controls

## Audio controls

The player has an **Audio and translation** transport button beside the speed button. The quick menu contains the current video's track, translation language, and an explicit **Save as default** action. Choosing a track or language applies to the current video; saving also enables the saved selection rules for future videos. A concrete YouTube track saves its language rather than the previous translation language.

Automatic selection, provider preference, visible YouTube languages, waiting behavior, translation/original volumes, and Yandex sign-in are in YouTube settings → TizenTube → Audio preferences. The guide no longer adds an audio shortcut, and the stock playback-settings audio entry is removed when the unified audio flow is enabled.

Audio checks follow the requested track, including a translation that is still preparing. Updating an audio popup replaces its active renderer while retaining the parent popup. This avoids clients that keep old checks during an in-place update.

## Recovery policy

The Cobalt media speed remains separate from YouTube's internal API rate to avoid the player's blanket HFR cap. The public speed getter and menu captions show the actual media speed. The original getter is retained for internal rate resets, so a UI refresh cannot repeatedly reset accelerated playback.

The guard samples every 500 ms. It uses current quality, media time, buffered data, and frame counters. It does not assume a particular device, resolution, frame rate, or playback speed limit. Frame totals and dropped frames follow the [Media Playback Quality specification](https://w3c.github.io/media-playback-quality/); displayed frames are total minus dropped frames. WebKit counters provide a compatibility fallback.

- Auto reacts to a buffered clock/picture freeze after about 2 seconds, or sustained poor progress/frame loss after about 2 seconds.
- Fixed quality gives sustained frame loss about 4 seconds and a frozen picture/clock about 4.5 seconds. A fixed stream with an empty buffer also gets a bounded recovery attempt.
- Frame loss must reach 20% over consecutive sampling windows; a brief burst does not lower quality. Clock progress must fall below 55% of the requested rate to count as sustained slow playback.
- Recovery lowers one available resolution at a time. Auto first sets an upper bound; if the actual stream does not change within 2 seconds, it pins that resolution once. An ignored pin leads to a further step down. Fixed quality pins the lower resolution immediately.
- Pauses, seeks, hidden pages, changed videos, replaced media elements, and reset counters discard old samples. A delayed JS callback can preserve evidence of frozen frames while the media clock continues normally.
- Choosing a previously failing resolution manually returns speed to 1× before applying that quality. This covers both the stock quality API and TizenTube's configured-quality menu, including reselecting the same configured value.
- Reducing speed releases the temporary cap for a fresh trial. Navigation releases the previous video's cap before the next loader starts; stored temporary caps also have a startup restoration path.

The configured quality is applied at `loadedmetadata` when available, rather than waiting for the first playing state and then restarting the decoder. Player UI patch discovery and AST parsing happen once when the patch installs. They no longer wait for a video element or run inside every player constructor.

## Verification and limits

The automated suite covers healthy accelerated playback, buffered picture freezes with advancing audio time, sustained dropped frames, slow/stopped clocks, network starvation, ignored quality switches, transient drops, pause/seek/counter resets, manual quality reselection, navigation, and menu commands. The APK builder additionally compiles and tests the Java bridge and verifies signing, alignment, embedded assets, and DEX startup links for `armeabi-v7a`, `arm64-v8a`, and `x86`.

These checks do not measure startup latency or decoding on a physical TV. Recovery requires a coherent current-quality list and usable telemetry. Without frame counters, an independently frozen picture with an advancing media clock cannot be distinguished reliably from healthy playback; clock and buffer recovery remain available. At the lowest available resolution there is no further quality step. The 4.5-second fixed-quality threshold describes detection and the first recovery request, not a guarantee that a device finishes its decoder switch within that time.
