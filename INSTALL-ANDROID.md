# Install on Android TV with ADB

Download the APK matching the device's Android ABI from the [v8.8 release](https://github.com/DrA1ex/TizenTubeCobalt_VOT/releases/tag/v8.8). The release includes `armeabi-v7a`, `arm64-v8a`, and `x86` packages. Device playback for v8.8 remains unverified.

1. Install Android Platform Tools and check `adb version`. On Android TV, enable **Wireless debugging** under **Settings → System → Developer options**. If Developer options are hidden, press **Android TV OS build** seven times under **About**. Put the computer and device on the same network.
2. If this computer has not paired with the device, open **Wireless debugging → Pair device with pairing code** and run `adb pair DEVICE_IP:PAIRING_PORT`. Enter the code shown on the TV. Then run `adb connect DEVICE_IP:CONNECT_PORT` using the different connection port shown on the main Wireless debugging screen.
3. Confirm that `adb devices -l` shows the device with status `device`.
4. Install over the previous version with `adb install --no-incremental -r /path/to/TizenTube-Cobalt-VOT-v8.8-Cobalt27.3-armeabi-v7a.apk`. The `-r` option keeps application data. If multiple devices are connected, add `-s SERIAL` immediately after `adb`.

ADB prints `Success` after installation. The package name is `io.gh.reisxd.tizentube.cobalt`. Updates require a package signed with the same key as the installed version.
