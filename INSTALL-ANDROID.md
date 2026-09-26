# Install on RockTek GX1 with ADB

Build or download the APK first. The current configuration uses a Cobalt 27.lts.3 QA base; device playback for v8.7 remains unverified.

1. Install Android Platform Tools and check `adb version`. On GX1, enable **Wireless debugging** under **Settings → System → Developer options**. If Developer options are hidden, press **Android TV OS build** seven times under **About**. Put the computer and GX1 on the same network.
2. If this computer has not paired with GX1, open **Wireless debugging → Pair device with pairing code** and run `adb pair DEVICE_IP:PAIRING_PORT`. Enter the code shown on the TV. Then run `adb connect DEVICE_IP:CONNECT_PORT` using the different connection port shown on the main Wireless debugging screen.
3. Confirm that `adb devices -l` shows the GX1 with status `device`. From the project root, verify the current package with `shasum -a 256 -c TizenTube-Cobalt-VOT-v8.7-Cobalt27.3-GX1-armeabi-v7a-SHA256.txt`.
4. Install over the previous version with `adb install --no-incremental -r "$PWD/TizenTube-Cobalt-VOT-v8.7-Cobalt27.3-GX1-armeabi-v7a.apk"`. The `-r` option keeps application data. If multiple devices are connected, add `-s SERIAL` immediately after `adb`.

ADB prints `Success` after installation. The package name is `io.gh.reisxd.tizentube.cobalt`. Updates require a package signed with the same key as the installed version.
