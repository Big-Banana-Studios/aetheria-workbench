package com.bigbananastudios.aetheriaworkbench;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Map;

/**
 * The llama-server subprocess and everything known about it, in one place.
 * Shared by the plugin (which starts and stops it from the page) and the
 * foreground service (which holds it up while the app is in the background,
 * for Mira in Chrome). A plugin instance lives and dies with the WebView
 * activity; this does not, so a server started before the activity was
 * recreated is still found.
 */
public final class LlamaRuntime {
    public static final String[] BACKENDS = {"opencl", "vulkan", "cpu"};
    private static final int LOG_LINES = 400;
    private static final LlamaRuntime INSTANCE = new LlamaRuntime();

    /** starting: launched, waiting for /health; running: healthy; stopped: nothing up (or the last start failed). */
    public enum Phase { STOPPED, STARTING, RUNNING }

    /** Told after every change of phase; the service refreshes its notification. */
    public interface Listener {
        void onChange();
    }

    private final Deque<String> log = new ArrayDeque<>();
    private Process proc;
    private int port;
    private String model;
    private String backendUsed;
    private long startedAt;
    private Phase phase = Phase.STOPPED;
    private boolean foreground; // a foreground service holds this server up
    private volatile Listener listener;

    private LlamaRuntime() {}

    public static LlamaRuntime get() {
        return INSTANCE;
    }

    // ---------------------------------------------------------------- paths

    public File modelsDir(Context ctx) {
        File base = ctx.getExternalFilesDir(null);
        if (base == null) base = ctx.getFilesDir();
        File d = new File(base, "models");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    public String libDir(Context ctx) {
        return ctx.getApplicationInfo().nativeLibraryDir;
    }

    public File serverBinary(Context ctx, String backend) {
        return new File(libDir(ctx), "libllamaserver_" + backend + ".so");
    }

    public List<String> availableBackends(Context ctx) {
        List<String> out = new ArrayList<>();
        for (String b : BACKENDS) if (serverBinary(ctx, b).exists()) out.add(b);
        return out;
    }

    // ---------------------------------------------------------------- Mira's voice: llama-tts (Qwen3-TTS, Bella cloned from a clip)

    public File ttsBinary(Context ctx, String backend) {
        return new File(libDir(ctx), "libllamatts_" + backend + ".so");
    }

    public List<String> ttsBackends(Context ctx) {
        List<String> out = new ArrayList<>();
        for (String b : BACKENDS) if (ttsBinary(ctx, b).exists()) out.add(b);
        return out;
    }

    /**
     * The Qwen3-TTS pair in models/: the backbone (a GGUF with "tts" in its
     * name that is not a projector; `preferred` by name, else the first) and
     * its projector beside it, named "<stem>-mmproj*.gguf" like a vision
     * model's. Returns {backbone, projector or null}, or null with no model.
     */
    public File[] ttsModel(Context ctx, String preferred) {
        File[] files = modelsDir(ctx).listFiles();
        if (files == null) return null;
        File backbone = null;
        for (File f : files) {
            String n = f.getName().toLowerCase();
            if (!n.endsWith(".gguf") || !n.contains("tts") || n.contains("mmproj")) continue;
            if (preferred != null && !preferred.isEmpty() && f.getName().equals(preferred)) {
                backbone = f;
                break;
            }
            if (backbone == null) backbone = f;
        }
        if (backbone == null) return null;
        String stem = backbone.getName().replaceAll("[-_.]?(Q\\d|IQ\\d|BF16|F16|F32).*$", "").replaceAll("\\.gguf$", "").toLowerCase();
        File mmproj = null;
        for (File f : files) {
            String n = f.getName().toLowerCase();
            if (!stem.isEmpty() && n.startsWith(stem + "-mmproj") && n.endsWith(".gguf")) {
                mmproj = f;
                break;
            }
        }
        return new File[] {backbone, mmproj};
    }

    private final Object ttsLock = new Object();

    /**
     * One clip through llama-tts: the text in, the WAV bytes out (24 kHz
     * mono). Blocking, seconds to a minute; call it off the main thread.
     * One at a time. The backends in order for "auto" (the CPU build is
     * the safe default: the audio decoder is a CPU graph anyway), the first
     * that writes a file wins; `frames` caps the generation at 12.5 a
     * second, since the model does not always emit its stop token.
     */
    public byte[] tts(Context ctx, String backend, File backbone, File mmproj, File speaker, String text, String lang, int frames) throws IOException {
        List<String> candidates = new ArrayList<>();
        if ("auto".equals(backend)) candidates.addAll(ttsBackends(ctx));
        else if (ttsBinary(ctx, backend).exists()) candidates.add(backend);
        if (candidates.isEmpty()) throw new IOException("no llama-tts binary in the APK (" + libDir(ctx) + "); rebuild with native/build_android.sh and tools/pack_native.mjs");
        synchronized (ttsLock) {
            File out = new File(ctx.getCacheDir(), "tts-" + System.nanoTime() + ".wav");
            String lastError = "";
            for (String b : candidates) {
                List<String> cmd = new ArrayList<>();
                cmd.add(ttsBinary(ctx, b).getAbsolutePath());
                cmd.addAll(Arrays.asList("-m", backbone.getAbsolutePath(), "-mm", mmproj.getAbsolutePath(), "-p", text, "--tts-lang", lang, "--tts-speaker-file", speaker.getAbsolutePath(), "-o", out.getAbsolutePath(), "-n", String.valueOf(frames), "-t", String.valueOf(Math.max(2, Runtime.getRuntime().availableProcessors() - 1))));
                if (!"cpu".equals(b)) cmd.addAll(Arrays.asList("-ngl", "99"));
                ProcessBuilder pb = new ProcessBuilder(cmd);
                Map<String, String> env = pb.environment();
                env.put("LD_LIBRARY_PATH", libDir(ctx) + ":/vendor/lib64:/system/vendor/lib64:/system/lib64:" + env.getOrDefault("LD_LIBRARY_PATH", ""));
                env.put("HOME", ctx.getFilesDir().getAbsolutePath());
                env.put("TMPDIR", ctx.getCacheDir().getAbsolutePath());
                pb.directory(ctx.getFilesDir());
                pb.redirectErrorStream(true);
                logLine("[tts] " + b + ": " + text.length() + " chars, cap " + frames + " frames");
                long t0 = System.currentTimeMillis();
                Process p = pb.start();
                final Deque<String> tail = new ArrayDeque<>();
                Thread pump = new Thread(() -> {
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                        String line;
                        while ((line = r.readLine()) != null) {
                            synchronized (tail) {
                                tail.addLast(line);
                                while (tail.size() > 12) tail.removeFirst();
                            }
                        }
                    } catch (IOException ignored) {
                    }
                }, "llama-tts-log");
                pump.setDaemon(true);
                pump.start();
                boolean done;
                try {
                    done = p.waitFor(240, java.util.concurrent.TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    p.destroyForcibly();
                    throw new IOException("interrupted");
                }
                if (!done) {
                    p.destroyForcibly();
                    lastError = b + ": timed out";
                    logLine("[tts] " + lastError);
                    continue;
                }
                if (p.exitValue() == 0 && out.exists() && out.length() > 44) {
                    byte[] data = java.nio.file.Files.readAllBytes(out.toPath());
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    logLine("[tts] " + b + ": " + data.length + " bytes in " + (System.currentTimeMillis() - t0) + " ms");
                    return data;
                }
                String why;
                synchronized (tail) {
                    why = String.join(" | ", tail);
                }
                lastError = b + ": exit " + p.exitValue() + " (" + why + ")";
                logLine("[tts] " + lastError);
                //noinspection ResultOfMethodCallIgnored
                out.delete();
            }
            throw new IOException(lastError.isEmpty() ? "llama-tts failed" : lastError);
        }
    }

    // ---------------------------------------------------------------- log

    public synchronized void logLine(String line) {
        log.addLast(line);
        while (log.size() > LOG_LINES) log.removeFirst();
    }

    public synchronized String logText() {
        return String.join("\n", log);
    }

    public synchronized String tail(int n) {
        List<String> lines = new ArrayList<>(log);
        int from = Math.max(0, lines.size() - n);
        return String.join(" | ", lines.subList(from, lines.size()));
    }

    // ---------------------------------------------------------------- state

    public synchronized boolean running() {
        return proc != null && proc.isAlive();
    }

    public synchronized Phase phase() {
        return phase;
    }

    public synchronized int port() {
        return port;
    }

    public synchronized String model() {
        return model;
    }

    public synchronized String backend() {
        return backendUsed;
    }

    public synchronized long startedAt() {
        return startedAt;
    }

    public synchronized boolean foreground() {
        return foreground;
    }

    public synchronized void setForeground(boolean on) {
        foreground = on;
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public synchronized long pid() {
        if (!running()) return 0;
        try {
            return (long) Process.class.getMethod("pid").invoke(proc);
        } catch (Exception e) {
            return 0;
        }
    }

    /** Before a start: the phase and the model name, so a notification shown in the meantime has something to say. */
    public void prepare(String modelName) {
        synchronized (this) {
            phase = Phase.STARTING;
            model = modelName;
            backendUsed = null;
        }
        changed();
    }

    // ---------------------------------------------------------------- start / stop

    /**
     * Start with a model: the backends in order (all that shipped for
     * "auto"), each launched and given three minutes to answer /health.
     * Blocking; call it off the main thread. Returns the backend that came
     * up, or throws with the last error.
     */
    public String start(Context ctx, File modelFile, String modelName, int wantPort, int ctxLen, String backend, List<String> extra) throws IOException {
        kill();
        prepare(modelName);
        List<String> candidates = new ArrayList<>();
        if ("auto".equals(backend)) candidates.addAll(availableBackends(ctx));
        else if (serverBinary(ctx, backend).exists()) candidates.add(backend);
        if (candidates.isEmpty()) {
            fail();
            throw new IOException("no llama-server binary in the APK (" + libDir(ctx) + "); build it with docs/NATIVE.md and run tools/pack_native.mjs");
        }
        String lastError = "";
        for (String b : candidates) {
            try {
                launch(ctx, b, modelFile, wantPort, ctxLen, extra);
                if (waitHealthy(wantPort, 180000)) {
                    synchronized (this) {
                        port = wantPort;
                        model = modelName;
                        backendUsed = b;
                        startedAt = System.currentTimeMillis();
                        phase = Phase.RUNNING;
                    }
                    changed();
                    return b;
                }
                lastError = b + ": the server did not become healthy (" + tail(3) + ")";
            } catch (Exception e) {
                lastError = b + ": " + e.getMessage();
            }
            logLine("[plugin] backend " + b + " failed: " + lastError);
            kill();
        }
        fail();
        throw new IOException(lastError.isEmpty() ? "could not start" : lastError);
    }

    private void launch(Context ctx, String backend, File modelFile, int p, int ctxLen, List<String> extra) throws IOException {
        List<String> cmd = new ArrayList<>();
        cmd.add(serverBinary(ctx, backend).getAbsolutePath());
        cmd.addAll(Arrays.asList("-m", modelFile.getAbsolutePath(), "--host", "127.0.0.1", "--port", String.valueOf(p), "-c", String.valueOf(ctxLen), "--jinja", "--reasoning-format", "deepseek", "-fa", "on"));
        if (!"cpu".equals(backend)) cmd.addAll(Arrays.asList("-ngl", "99"));
        // a projector saved beside the model under its own name makes a vision
        // model see: "<stem>-mmproj*.gguf", where the stem is the model's file
        // name without its quantisation suffix (the catalog names them so)
        File[] siblings = modelsDir(ctx).listFiles();
        if (siblings != null) {
            String stem = modelFile.getName().replaceAll("[-_.]?(Q\\d|IQ\\d|BF16|F16|F32).*$", "").replaceAll("\\.gguf$", "").toLowerCase();
            for (File f : siblings) {
                String n = f.getName().toLowerCase();
                if (!stem.isEmpty() && n.startsWith(stem + "-mmproj") && n.endsWith(".gguf")) {
                    cmd.addAll(Arrays.asList("--mmproj", f.getAbsolutePath()));
                    break;
                }
            }
        }
        if (extra != null) cmd.addAll(extra);
        ProcessBuilder pb = new ProcessBuilder(cmd);
        Map<String, String> env = pb.environment();
        // our libraries first, then the vendor's (libOpenCL.so lives there on Qualcomm devices)
        env.put("LD_LIBRARY_PATH", libDir(ctx) + ":/vendor/lib64:/system/vendor/lib64:/system/lib64:" + env.getOrDefault("LD_LIBRARY_PATH", ""));
        env.put("HOME", ctx.getFilesDir().getAbsolutePath());
        env.put("TMPDIR", ctx.getCacheDir().getAbsolutePath());
        pb.directory(ctx.getFilesDir());
        pb.redirectErrorStream(true);
        logLine("[plugin] " + String.join(" ", cmd));
        final Process p0;
        synchronized (this) {
            proc = pb.start();
            p0 = proc;
        }
        Thread pump = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p0.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) logLine(line);
            } catch (IOException ignored) {
            }
            logLine("[plugin] server exited with " + safeExit(p0));
            // died on its own while it was the live server: the service lets go of it
            boolean wasLive;
            synchronized (this) {
                wasLive = proc == p0 && phase == Phase.RUNNING;
                if (wasLive) {
                    proc = null;
                    phase = Phase.STOPPED;
                    backendUsed = null;
                }
            }
            if (wasLive) changed();
        }, "llama-log");
        pump.setDaemon(true);
        pump.start();
    }

    private int safeExit(Process p) {
        try {
            return p.exitValue();
        } catch (IllegalThreadStateException e) {
            return -1;
        }
    }

    /** llama-server answers /health with 503 while loading and 200 when ready. */
    private boolean waitHealthy(int p, long timeoutMs) {
        long until = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < until) {
            if (!running()) return false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + p + "/health").openConnection();
                c.setConnectTimeout(1000);
                c.setReadTimeout(1000);
                int code = c.getResponseCode();
                c.disconnect();
                if (code == 200) return true;
            } catch (IOException ignored) {
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                return false;
            }
        }
        return false;
    }

    /** The process, gone; the phase untouched (between backend attempts). */
    private void kill() {
        Process p;
        synchronized (this) {
            p = proc;
            proc = null;
        }
        if (p != null) {
            try {
                p.destroy();
                if (!p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) p.destroyForcibly();
            } catch (Exception ignored) {
            }
        }
    }

    private void fail() {
        synchronized (this) {
            phase = Phase.STOPPED;
            backendUsed = null;
        }
        changed();
    }

    /** Stop for good: the process and the phase. Blocks for up to three seconds. */
    public void stop() {
        kill();
        synchronized (this) {
            phase = Phase.STOPPED;
            model = null;
            backendUsed = null;
        }
        changed();
    }

    private void changed() {
        Listener l = listener;
        if (l != null) {
            try {
                l.onChange();
            } catch (Exception ignored) {
            }
        }
    }
}
