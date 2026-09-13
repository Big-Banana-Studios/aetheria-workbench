#!/usr/bin/env bash
# Build llama-server for the phone (arm64-v8a), three variants: OpenCL
# (Adreno), Vulkan (best effort), CPU. Follows llama.cpp's own recipe in
# docs/backend/OPENCL.md and docs/build.md, adapted to a Windows host with
# the NDK and CMake from the Android SDK. Run from Git Bash:
#
#   bash native/build_android.sh            # all three
#   bash native/build_android.sh opencl     # one of them
#
# Output: native/llama.cpp/build-<backend>/bin/llama-server, then
#   node tools/pack_native.mjs && npx cap sync android

set -euo pipefail
# The sources and build trees live OUTSIDE the repo, in a path with no spaces:
# the OpenCL ICD loader's CMake passes linker script paths unquoted, and this
# repo's path ("Aetheria workbench") has one.
SRC="${NATIVE_SRC:-$HOME/aetheria-native}"
mkdir -p "$SRC"
SDK="${ANDROID_SDK_ROOT:-$LOCALAPPDATA/Android/Sdk}"
SDK="$(cd "$SDK" && pwd)"
NDK_VER="${NDK_VER:-$(ls "$SDK/ndk" | sort -V | tail -1)}"
NDK="$SDK/ndk/$NDK_VER"
CMAKE_VER="$(ls "$SDK/cmake" | sort -V | tail -1)"
CMAKE="$SDK/cmake/$CMAKE_VER/bin/cmake.exe"
NINJA="$SDK/cmake/$CMAKE_VER/bin/ninja.exe"
HOST_TAG="windows-x86_64"
SYSROOT="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/sysroot"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 8)}"
W() { cygpath -w "$1"; }

echo "NDK $NDK_VER · CMake $CMAKE_VER · sysroot $(W "$SYSROOT")"
[ -f "$CMAKE" ] || { echo "no cmake at $CMAKE (sdkmanager --install 'cmake;3.31.6')"; exit 2; }
[ -d "$NDK" ] || { echo "no NDK at $NDK (sdkmanager --install 'ndk;28.2.13676358')"; exit 2; }

TOOLCHAIN="$(W "$NDK/build/cmake/android.toolchain.cmake")"
COMMON=(
  -G Ninja "-DCMAKE_MAKE_PROGRAM=$(W "$NINJA")"
  -DCMAKE_BUILD_TYPE=Release
  "-DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN"
  -DANDROID_ABI=arm64-v8a
  -DANDROID_PLATFORM=android-28
  -DBUILD_SHARED_LIBS=OFF
  -DGGML_NATIVE=OFF
  -DGGML_OPENMP=OFF
  -DGGML_LLAMAFILE=OFF
  -DGGML_CPU_KLEIDIAI=ON
  -DLLAMA_OPENSSL=OFF
  -DLLAMA_CURL=OFF
  -DLLAMA_BUILD_TESTS=OFF
  -DLLAMA_BUILD_EXAMPLES=OFF
  -DLLAMA_BUILD_TOOLS=ON
)

want="${1:-all}"
cd "$SRC"
[ -d llama.cpp ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp
[ -d OpenCL-Headers ] || git clone --depth 1 https://github.com/KhronosGroup/OpenCL-Headers
[ -d OpenCL-ICD-Loader ] || git clone --depth 1 https://github.com/KhronosGroup/OpenCL-ICD-Loader
echo "sources in $SRC ($(cd llama.cpp && git log --oneline -1))"

# ------------------------------------------------------------ OpenCL headers and ICD loader into the NDK sysroot
opencl_prereqs() {
  if [ ! -d "$SYSROOT/usr/include/CL" ]; then
    echo "== OpenCL headers -> sysroot"
    cp -r "$SRC/OpenCL-Headers/CL" "$SYSROOT/usr/include/"
  fi
  if [ ! -f "$SYSROOT/usr/lib/aarch64-linux-android/libOpenCL.so" ]; then
    echo "== OpenCL ICD loader (arm64) -> sysroot"
    "$CMAKE" -S "$(W "$SRC/OpenCL-ICD-Loader")" -B "$(W "$SRC/OpenCL-ICD-Loader/build-android")" \
      -G Ninja "-DCMAKE_MAKE_PROGRAM=$(W "$NINJA")" -DCMAKE_BUILD_TYPE=Release \
      "-DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN" \
      "-DOPENCL_ICD_LOADER_HEADERS_DIR=$(W "$SYSROOT/usr/include")" \
      -DBUILD_TESTING=OFF -DOPENCL_ICD_LOADER_BUILD_TESTING=OFF \
      -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=24 -DANDROID_STL=c++_shared
    "$CMAKE" --build "$(W "$SRC/OpenCL-ICD-Loader/build-android")" --target OpenCL -j "$JOBS"
    cp "$SRC/OpenCL-ICD-Loader/build-android/libOpenCL.so" "$SYSROOT/usr/lib/aarch64-linux-android/"
  fi
}

build_variant() {
  local name="$1"; shift
  local dir="$SRC/llama.cpp/build-$name"
  echo "== llama-server + llama-tts · $name"
  "$CMAKE" -S "$(W "$SRC/llama.cpp")" -B "$(W "$dir")" "${COMMON[@]}" "$@"
  # llama-tts: Qwen3-TTS (mtmd) for Mira's voice on the phone, cloning Bella from a reference clip (tools/qwen_tts_server.py is the PC twin)
  "$CMAKE" --build "$(W "$dir")" --target llama-server llama-tts -j "$JOBS"
  ls -la "$dir/bin/llama-server" "$dir/bin/llama-tts"
}

if [ "$want" = all ] || [ "$want" = opencl ]; then
  opencl_prereqs
  build_variant opencl -DGGML_OPENCL=ON -DGGML_OPENCL_USE_ADRENO_KERNELS=ON
fi

if [ "$want" = all ] || [ "$want" = vulkan ]; then
  # needs glslc from the NDK's shader tools and a host compiler for the shader generator; best effort
  GLSLC="$NDK/shader-tools/$HOST_TAG/glslc.exe"
  if build_variant vulkan -DGGML_VULKAN=ON "-DVulkan_GLSLC_EXECUTABLE=$(W "$GLSLC")" \
      "-DVulkan_INCLUDE_DIR=$(W "$SYSROOT/usr/include")" \
      "-DVulkan_LIBRARY=$(W "$SYSROOT/usr/lib/aarch64-linux-android/28/libvulkan.so")"; then
    :
  else
    echo "!! the Vulkan variant did not build (it needs a host C++ compiler for vulkan-shaders-gen); OpenCL and CPU still ship"
  fi
fi

if [ "$want" = all ] || [ "$want" = cpu ]; then
  build_variant cpu
fi

echo "done. Binaries under $SRC/llama.cpp/build-*/bin. Next: node tools/pack_native.mjs && npx cap sync android && (cd android && ./gradlew assembleDebug)"
