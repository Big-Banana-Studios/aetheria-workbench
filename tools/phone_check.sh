#!/usr/bin/env bash
# The phone side of phase two: install the debug APK over USB, launch it,
# and tail the log lines that matter (the plugin, llama-server, the WebView
# console). Run from Git Bash with the ROG plugged in and USB debugging on.
#
#   bash tools/phone_check.sh            # install + launch + logcat
#   bash tools/phone_check.sh log        # logcat only
#   bash tools/phone_check.sh push <model.gguf>   # copy a GGUF into the app's models folder (no download needed)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${ANDROID_SDK_ROOT:-$LOCALAPPDATA/Android/Sdk}"
ADB="$SDK/platform-tools/adb.exe"
APP="com.bigbananastudios.aetheriaworkbench"
APK="$HERE/android/app/build/outputs/apk/debug/app-debug.apk"

cmd="${1:-all}"
"$ADB" devices

if [ "$cmd" = push ]; then
  f="${2:?a .gguf path}"
  # the app's external files dir; the plugin reads models/ there
  "$ADB" shell mkdir -p "/sdcard/Android/data/$APP/files/models"
  "$ADB" push "$f" "/sdcard/Android/data/$APP/files/models/"
  exit 0
fi

if [ "$cmd" = all ]; then
  [ -f "$APK" ] || { echo "no APK at $APK; build it: cd android && ./gradlew assembleDebug"; exit 2; }
  "$ADB" install -r "$APK"
  "$ADB" shell am start -n "$APP/.MainActivity"
fi

echo "--- logcat (Ctrl+C to stop) ---"
"$ADB" logcat -c
"$ADB" logcat -v time | grep --line-buffered -E "LlamaServer|llama|ggml|Capacitor|chromium|Console|AndroidRuntime|$APP"
