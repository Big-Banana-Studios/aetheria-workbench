package com.bigbananastudios.aetheriaworkbench;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The in-app runtime: llama.cpp's server, built for arm64 and shipped in the
 * APK as a "native library" (libllamaserver_<backend>.so, extracted to
 * nativeLibraryDir by legacy packaging), run as a subprocess bound to
 * 127.0.0.1. The web side (src/native.js) talks to it with the same
 * OpenAI-compatible client it uses for the lab; so does Mira in Chrome.
 *
 * The process itself lives in LlamaRuntime (one per app process, not per
 * plugin instance) and, when `start` is asked for `foreground`, a
 * foreground service (LlamaServerService) holds it up while the app is in
 * the background.
 *
 * Methods: status, device, listModels, download, pickModel, deleteModel, start, stop,
 * and for Mira's voice ttsStatus and tts (llama-tts, Qwen3-TTS cloning Bella).
 * Event: "download" {name, loaded, total, done}, for a download and for the
 * copy of a picked file alike; status() carries the same numbers under
 * "download" so the page can poll if an event goes missing.
 */
@CapacitorPlugin(name = "LlamaServer", permissions = {@Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = LlamaServerPlugin.NOTIFICATIONS)})
public class LlamaServerPlugin extends Plugin {
    static final String NOTIFICATIONS = "notifications";

    private final ExecutorService exec = Executors.newCachedThreadPool();
    /** Starts outlive a plugin instance (the activity may be recreated while a model loads), so they run on a pool that is never shut down. */
    private static final ExecutorService starter = Executors.newSingleThreadExecutor();
    private final LlamaRuntime rt = LlamaRuntime.get();
    private volatile String dlName;
    private volatile long dlLoaded;
    private volatile long dlTotal;
    private volatile boolean dlActive;

    private Context app() {
        return getContext().getApplicationContext();
    }

    private File modelsDir() {
        return rt.modelsDir(app());
    }

    // ---------------------------------------------------------------- status / device

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        boolean up = rt.running();
        r.put("running", up);
        r.put("healthy", up && rt.phase() == LlamaRuntime.Phase.RUNNING);
        r.put("phase", rt.phase().name().toLowerCase());
        r.put("port", rt.port());
        r.put("model", rt.model());
        r.put("backend", rt.backend());
        r.put("pid", rt.pid());
        r.put("uptime", up && rt.startedAt() > 0 ? System.currentTimeMillis() - rt.startedAt() : 0);
        r.put("foreground", up && rt.foreground());
        r.put("log", rt.logText());
        JSObject d = new JSObject();
        d.put("name", dlName);
        d.put("loaded", dlLoaded);
        d.put("total", dlTotal);
        d.put("active", dlActive);
        r.put("download", d);
        call.resolve(r);
    }

    @PluginMethod
    public void device(PluginCall call) {
        JSObject r = new JSObject();
        ActivityManager am = (ActivityManager) app().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        if (am != null) am.getMemoryInfo(mi);
        String soc = Build.VERSION.SDK_INT >= 31 ? Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL : Build.HARDWARE;
        r.put("soc", soc);
        r.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        r.put("ram", mi.totalMem);
        r.put("availRam", mi.availMem);
        r.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");
        r.put("gpu", "");
        r.put("backends", new JSArray(rt.availableBackends(app())));
        r.put("libDir", rt.libDir(app()));
        r.put("modelsDir", modelsDir().getAbsolutePath());
        call.resolve(r);
    }

    // ---------------------------------------------------------------- models

    @PluginMethod
    public void listModels(PluginCall call) {
        JSArray arr = new JSArray();
        File[] files = modelsDir().listFiles();
        if (files != null) {
            Arrays.sort(files);
            for (File f : files) {
                if (!f.getName().toLowerCase().endsWith(".gguf")) continue;
                JSObject m = new JSObject();
                m.put("name", f.getName());
                m.put("path", f.getAbsolutePath());
                m.put("size", f.length());
                arr.put(m);
            }
        }
        JSObject r = new JSObject();
        r.put("dir", modelsDir().getAbsolutePath());
        r.put("models", arr);
        call.resolve(r);
    }

    /** The first bytes of a model (its GGUF header, up to 8 MB), base64, with the file's size: the app reads the architecture and the expert count to plan the launch. */
    @PluginMethod
    public void readHead(PluginCall call) {
        String name = call.getString("model");
        if (name == null || name.contains("/") || name.contains("..")) {
            call.reject("bad model name");
            return;
        }
        File f = new File(modelsDir(), name);
        if (!f.exists()) {
            call.reject("no such model: " + name);
            return;
        }
        int want = Math.max(4096, Math.min(call.getInt("bytes", 1 << 20), 8 << 20));
        byte[] buf = new byte[(int) Math.min((long) want, f.length())];
        int off = 0;
        try (InputStream in = new FileInputStream(f)) {
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
        } catch (IOException e) {
            call.reject("could not read " + name + ": " + e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("data", Base64.encodeToString(off == buf.length ? buf : Arrays.copyOf(buf, off), Base64.NO_WRAP));
        r.put("size", f.length());
        r.put("bytes", off);
        call.resolve(r);
    }
    @PluginMethod
    public void deleteModel(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.contains("/") || name.contains("..")) {
            call.reject("bad model name");
            return;
        }
        File f = new File(modelsDir(), name);
        if (f.exists() && !f.delete()) {
            call.reject("could not delete " + name);
            return;
        }
        call.resolve();
    }

    /** Resumable download (HTTP Range) into models/<name>.part, renamed when complete. */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String name = call.getString("name");
        if (url == null || name == null || name.contains("/") || name.contains("..")) {
            call.reject("url and a plain file name are required");
            return;
        }
        exec.submit(() -> {
            File part = new File(modelsDir(), name + ".part");
            File dest = new File(modelsDir(), name);
            try {
                long have = part.exists() ? part.length() : 0;
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
                c.connect();
                int code = c.getResponseCode();
                if (code == 416) {
                    // already complete
                    have = part.length();
                } else if (code != 200 && code != 206) {
                    throw new IOException("HTTP " + code);
                } else {
                    boolean append = code == 206;
                    if (!append) have = 0;
                    long total = c.getContentLengthLong() + (append ? have : 0);
                    try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part, append)) {
                        byte[] buf = new byte[1 << 16];
                        long loaded = have;
                        long lastNotify = 0;
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            loaded += n;
                            if (loaded - lastNotify > (1 << 20)) {
                                lastNotify = loaded;
                                notify(name, loaded, total, false);
                            }
                        }
                    }
                }
                if (dest.exists()) //noinspection ResultOfMethodCallIgnored
                    dest.delete();
                if (!part.renameTo(dest)) throw new IOException("could not rename " + part.getName());
                notify(name, dest.length(), dest.length(), true);
                JSObject r = new JSObject();
                r.put("path", dest.getAbsolutePath());
                r.put("size", dest.length());
                call.resolve(r);
            } catch (Exception e) {
                dlActive = false;
                call.reject("download failed: " + e.getMessage());
            }
        });
    }

    /** The system file picker; the chosen GGUF is copied into models/, since llama-server needs a plain path. */
    @PluginMethod
    public void pickModel(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "pickModelResult");
    }

    @ActivityCallback
    private void pickModelResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        final Uri uri = result.getResultCode() == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (uri == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        String displayName = null;
        long size = -1;
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0) displayName = c.getString(ni);
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
            }
        } catch (Exception ignored) {
            // the name falls back to the URI's last segment
        }
        if (displayName == null) displayName = uri.getLastPathSegment();
        if (displayName == null) displayName = "model.gguf";
        final String name = displayName.replaceAll("[/\\\\]", "_");
        if (!name.toLowerCase().endsWith(".gguf")) {
            call.reject("that is not a .gguf file: " + name);
            return;
        }
        final long total = size;
        long free = modelsDir().getUsableSpace();
        if (total > 0 && free < total) {
            call.reject("not enough space: the file is " + (total >> 20) + " MB and " + (free >> 20) + " MB is free");
            return;
        }
        exec.submit(() -> {
            File part = new File(modelsDir(), name + ".part");
            File dest = new File(modelsDir(), name);
            try (InputStream in = getContext().getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(part, false)) {
                if (in == null) throw new IOException("could not open the file");
                byte[] buf = new byte[1 << 20];
                long loaded = 0;
                long lastNotify = 0;
                int n;
                notify(name, 0, total, false);
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    loaded += n;
                    if (loaded - lastNotify > (8L << 20)) {
                        lastNotify = loaded;
                        notify(name, loaded, total, false);
                    }
                }
                out.flush();
                if (dest.exists()) //noinspection ResultOfMethodCallIgnored
                    dest.delete();
                if (!part.renameTo(dest)) throw new IOException("could not rename " + part.getName());
                notify(name, dest.length(), dest.length(), true);
                JSObject r = new JSObject();
                r.put("name", name);
                r.put("path", dest.getAbsolutePath());
                r.put("size", dest.length());
                call.resolve(r);
            } catch (Exception e) {
                dlActive = false;
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                call.reject("copy failed: " + e.getMessage());
            }
        });
    }

    private void notify(String name, long loaded, long total, boolean done) {
        dlName = name;
        dlLoaded = loaded;
        dlTotal = total;
        dlActive = !done;
        JSObject e = new JSObject();
        e.put("name", name);
        e.put("loaded", loaded);
        e.put("total", total);
        e.put("done", done);
        notifyListeners("download", e);
    }

    // ---------------------------------------------------------------- start / stop

    /**
     * start({model, port, ctx, backend, args, foreground}). With
     * `foreground` (the default) a notification holds the server up in the
     * background; on Android 13 and later that needs the notification
     * permission, asked for once here (the service runs either way; without
     * the permission the notification simply does not show).
     */
    @PluginMethod
    public void start(PluginCall call) {
        final String modelName = call.getString("model");
        if (modelName == null || modelName.contains("/") || modelName.contains("..")) {
            call.reject("model is required");
            return;
        }
        if (!new File(modelsDir(), modelName).exists()) {
            call.reject("no such model: " + modelName);
            return;
        }
        boolean fg = Boolean.TRUE.equals(call.getBoolean("foreground", true));
        if (fg && Build.VERSION.SDK_INT >= 33 && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "startAfterPermission");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void startAfterPermission(PluginCall call) {
        launch(call); // granted or not: the service works either way
    }

    private void launch(PluginCall call) {
        final String modelName = call.getString("model");
        final int wantPort = call.getInt("port", 8080);
        final int ctx = call.getInt("ctx", 32768);
        final String backend = call.getString("backend", "auto");
        final boolean fg = Boolean.TRUE.equals(call.getBoolean("foreground", true));
        final List<String> extra = new ArrayList<>();
        JSArray arr = call.getArray("args");
        if (arr != null) {
            try {
                for (Object o : arr.toList()) extra.add(String.valueOf(o));
            } catch (Exception ignored) {
            }
        }
        final File modelFile = new File(modelsDir(), modelName);
        final Context ctxApp = app();
        if (fg) {
            // the service must be started while the app is in front: now, before the model loads
            rt.prepare(modelName);
            rt.setForeground(true);
            try {
                LlamaServerService.hold(ctxApp);
            } catch (Exception e) {
                rt.setForeground(false);
                rt.logLine("[plugin] foreground service refused: " + e.getMessage());
            }
        } else rt.setForeground(false);
        starter.submit(() -> {
            try {
                String b = rt.start(ctxApp, modelFile, modelName, wantPort, ctx, backend, extra);
                JSObject r = new JSObject();
                r.put("port", wantPort);
                r.put("model", modelName);
                r.put("backend", b);
                r.put("pid", rt.pid());
                r.put("foreground", rt.foreground());
                call.resolve(r);
            } catch (Exception e) {
                if (rt.foreground()) {
                    rt.setForeground(false);
                    LlamaServerService.release(ctxApp);
                }
                call.reject(e.getMessage() == null ? "could not start" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        final Context ctxApp = app();
        starter.submit(() -> {
            rt.stop();
            rt.setForeground(false);
            LlamaServerService.release(ctxApp);
            call.resolve();
        });
    }

    // ---------------------------------------------------------------- Mira's voice (llama-tts)

    /**
     * ttsStatus({model}): whether her Qwen3-TTS voice can answer in-app:
     * the llama-tts binary, a model pair in models/ (the backbone and its
     * projector), and Bella's reference clip, copied from the web assets
     * once.
     */
    @PluginMethod
    public void ttsStatus(PluginCall call) {
        List<String> backends = rt.ttsBackends(app());
        File[] pair = rt.ttsModel(app(), call.getString("model", ""));
        File speaker = speakerFile();
        String error = backends.isEmpty() ? "no llama-tts binary in this build" : pair == null ? "no Qwen3-TTS model in Models (download Qwen3-TTS below, or push the 0.6B pair)" : pair[1] == null ? "the model's projector (…-mmproj-….gguf) is missing beside it" : speaker == null ? "no reference clip (assets/voices/bella-ref.wav)" : "";
        JSObject r = new JSObject();
        r.put("ready", error.isEmpty());
        r.put("binary", String.join(",", backends));
        r.put("backend", backends.isEmpty() ? "" : backends.contains("cpu") ? "cpu" : backends.get(0));
        r.put("model", pair == null ? "" : pair[0].getName());
        r.put("mmproj", pair == null || pair[1] == null ? "" : pair[1].getName());
        r.put("speaker", speaker == null ? "" : speaker.getName());
        r.put("error", error);
        call.resolve(r);
    }

    /** tts({text, model, lang, frames, backend}) -> {wav: base64 WAV, ms, bytes}: one clip, on the pool, one at a time in the runtime. */
    @PluginMethod
    public void tts(PluginCall call) {
        final String text = String.valueOf(call.getString("text", "")).trim();
        if (text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        final String lang = call.getString("lang", "en");
        final String backend = call.getString("backend", "cpu");
        final String model = call.getString("model", "");
        final int words = text.split("\\s+").length;
        final int asked = call.getInt("frames", 0);
        final int cap = asked > 0 ? asked : 96 + 12 * words; // 12.5 frames a second of speech; a word runs about five, twelve leaves room
        exec.submit(() -> {
            try {
                File[] pair = rt.ttsModel(app(), model);
                if (pair == null || pair[1] == null) throw new IOException("no Qwen3-TTS model pair in Models");
                File speaker = speakerFile();
                if (speaker == null) throw new IOException("no reference clip");
                long t0 = System.currentTimeMillis();
                byte[] wav = rt.tts(app(), backend, pair[0], pair[1], speaker, text, lang, cap);
                JSObject r = new JSObject();
                r.put("wav", Base64.encodeToString(wav, Base64.NO_WRAP));
                r.put("ms", System.currentTimeMillis() - t0);
                r.put("bytes", wav.length);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "tts failed" : e.getMessage());
            }
        });
    }

    /**
     * saveDownload({name, mime, data: base64}) -> {uri, path, bytes}: the
     * file into the phone's Downloads, under AetheriaWorkbench (MediaStore
     * on Android 10 and later, no permission needed; the app's own Download
     * folder before that). The stage's video, audio and package exports:
     * the WebView's own download does not deliver inside the app.
     */
    @PluginMethod
    public void saveDownload(PluginCall call) {
        final String name = String.valueOf(call.getString("name", "")).replaceAll("[^A-Za-z0-9._ -]+", "_");
        final String mime = call.getString("mime", "application/octet-stream");
        final String data = call.getString("data", "");
        if (name.isEmpty() || data == null || data.isEmpty()) {
            call.reject("name and data are required");
            return;
        }
        exec.submit(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                JSObject r = new JSObject();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AetheriaWorkbench");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    ContentResolver cr = app().getContentResolver();
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("MediaStore refused the file");
                    try (OutputStream out = cr.openOutputStream(uri)) {
                        if (out == null) throw new IOException("could not open the file for writing");
                        out.write(bytes);
                    }
                    v.clear();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(uri, v, null, null);
                    r.put("uri", uri.toString());
                    r.put("path", "Download/AetheriaWorkbench/" + name);
                } else {
                    File dir = new File(app().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "AetheriaWorkbench");
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream out = new FileOutputStream(f)) {
                        out.write(bytes);
                    }
                    r.put("uri", Uri.fromFile(f).toString());
                    r.put("path", f.getAbsolutePath());
                }
                r.put("bytes", bytes.length);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "save failed" : e.getMessage());
            }
        });
    }

    // ---------------------------------------------------------------- chunked downloads: a big file (a video) in one-megabyte pieces

    /** An open file in Downloads, being written piece by piece. */
    private static final class Sink {
        OutputStream out;
        Uri uri;
        File file;
        String name;
        long bytes;
    }

    private final java.util.Map<String, Sink> sinks = new java.util.HashMap<>();

    /**
     * downloadBegin({name, mime}) -> {id, path}: opens a file in Downloads
     * (MediaStore, pending) for downloadChunk to fill; downloadEnd closes
     * it. A whole file in one call cannot cross the WebView bridge when it
     * is a video, so src/ui.js streams the blob in pieces.
     */
    @PluginMethod
    public void downloadBegin(PluginCall call) {
        final String name = String.valueOf(call.getString("name", "")).replaceAll("[^A-Za-z0-9._ -]+", "_");
        final String mime = call.getString("mime", "application/octet-stream");
        if (name.isEmpty()) {
            call.reject("name is required");
            return;
        }
        try {
            Sink s = new Sink();
            s.name = name;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AetheriaWorkbench");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver cr = app().getContentResolver();
                s.uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (s.uri == null) throw new IOException("MediaStore refused the file");
                s.out = cr.openOutputStream(s.uri);
                if (s.out == null) throw new IOException("could not open the file for writing");
            } else {
                File dir = new File(app().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "AetheriaWorkbench");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                s.file = new File(dir, name);
                s.out = new FileOutputStream(s.file);
            }
            String id = Long.toString(System.nanoTime(), 36);
            synchronized (sinks) {
                sinks.put(id, s);
            }
            JSObject r = new JSObject();
            r.put("id", id);
            r.put("path", s.file != null ? s.file.getAbsolutePath() : "Download/AetheriaWorkbench/" + name);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "could not open the file" : e.getMessage());
        }
    }

    /** downloadChunk({id, data: base64}) -> {bytes so far}. Called in order, one at a time. */
    @PluginMethod
    public void downloadChunk(PluginCall call) {
        final String id = call.getString("id", "");
        final String data = call.getString("data", "");
        final Sink s;
        synchronized (sinks) {
            s = sinks.get(id);
        }
        if (s == null) {
            call.reject("no such download");
            return;
        }
        exec.submit(() -> {
            try {
                byte[] bytes = Base64.decode(data == null ? "" : data, Base64.DEFAULT);
                synchronized (s) {
                    s.out.write(bytes);
                    s.bytes += bytes.length;
                }
                JSObject r = new JSObject();
                r.put("bytes", s.bytes);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "write failed" : e.getMessage());
            }
        });
    }

    /** downloadEnd({id, abort?}) -> {path, uri, bytes}: closes the file and publishes it (or throws it away on abort). */
    @PluginMethod
    public void downloadEnd(PluginCall call) {
        final String id = call.getString("id", "");
        final boolean abort = Boolean.TRUE.equals(call.getBoolean("abort", false));
        final Sink s;
        synchronized (sinks) {
            s = sinks.remove(id);
        }
        if (s == null) {
            call.reject("no such download");
            return;
        }
        exec.submit(() -> {
            try {
                synchronized (s) {
                    s.out.flush();
                    s.out.close();
                }
                ContentResolver cr = app().getContentResolver();
                if (abort) {
                    if (s.uri != null) cr.delete(s.uri, null, null);
                    else if (s.file != null) //noinspection ResultOfMethodCallIgnored
                        s.file.delete();
                    call.resolve(new JSObject());
                    return;
                }
                if (s.uri != null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(s.uri, v, null, null);
                }
                JSObject r = new JSObject();
                r.put("uri", s.uri != null ? s.uri.toString() : Uri.fromFile(s.file).toString());
                r.put("path", s.file != null ? s.file.getAbsolutePath() : "Download/AetheriaWorkbench/" + s.name);
                r.put("bytes", s.bytes);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "close failed" : e.getMessage());
            }
        });
    }

    /** Bella's reference clip (public/assets/voices/bella-ref.wav in the web build), copied into files/voices once; llama-tts needs a plain path. */
    private File speakerFile() {
        File dir = new File(app().getFilesDir(), "voices");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File f = new File(dir, "bella-ref.wav");
        if (f.exists() && f.length() > 44) return f;
        try (InputStream in = app().getAssets().open("public/assets/voices/bella-ref.wav"); FileOutputStream out = new FileOutputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return f;
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            return null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        // the activity is going; the server goes with it unless the service is holding it up
        if (!rt.foreground()) starter.submit(rt::stop);
        exec.shutdownNow();
        super.handleOnDestroy();
    }
}
