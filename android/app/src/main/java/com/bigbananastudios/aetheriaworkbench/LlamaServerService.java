package com.bigbananastudios.aetheriaworkbench;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Holds the llama-server up while the app is in the background: a
 * foreground service with one notification (the model, the port, a Stop
 * button), so Android does not kill the app, and the server with it, while
 * Mira in Chrome is talking to http://127.0.0.1:8080/v1. The plugin starts
 * it just before it launches the server (while the app is in front, which
 * Android 12 and later require of a foreground service), and it lets go
 * when the plugin stops the server, when the Stop button is pressed, or
 * when the server dies on its own. Declared as a special-use foreground
 * service: the app is sideloaded, so the Play Store's justification form
 * does not apply, and that type carries no time limit.
 */
public class LlamaServerService extends Service implements LlamaRuntime.Listener {
    public static final String ACTION_HOLD = "com.bigbananastudios.aetheriaworkbench.HOLD";
    public static final String ACTION_STOP = "com.bigbananastudios.aetheriaworkbench.STOP";
    private static final String CHANNEL = "runtime";
    private static final int NOTE_ID = 1;

    /** Start holding: called by the plugin before it launches the server. */
    public static void hold(Context ctx) {
        Intent i = new Intent(ctx, LlamaServerService.class).setAction(ACTION_HOLD);
        ContextCompat.startForegroundService(ctx, i);
    }

    /** Let go: the notification goes, the service stops (the server is the plugin's business). */
    public static void release(Context ctx) {
        ctx.stopService(new Intent(ctx, LlamaServerService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        channel();
        LlamaRuntime.get().setListener(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // whatever the action, the service must be in the foreground within seconds of startForegroundService
        show();
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            new Thread(() -> {
                LlamaRuntime.get().stop(); // its listener (this) lets go when the phase turns to stopped
                LlamaRuntime.get().setForeground(false);
            }, "llama-stop").start();
        } else if (LlamaRuntime.get().phase() == LlamaRuntime.Phase.STOPPED) {
            letGo();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        LlamaRuntime.get().setListener(null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** The server changed phase: refresh the notification, or let go when it stopped. */
    @Override
    public void onChange() {
        if (LlamaRuntime.get().phase() == LlamaRuntime.Phase.STOPPED) letGo();
        else {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTE_ID, build());
        }
    }

    private void show() {
        ServiceCompat.startForeground(this, NOTE_ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    }

    private void letGo() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void channel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "In-app runtime", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("The on-device model server, while it runs in the background");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification build() {
        LlamaRuntime rt = LlamaRuntime.get();
        String model = rt.model() == null ? "llama-server" : rt.model();
        String text;
        switch (rt.phase()) {
            case STARTING:
                text = "Starting " + model + "…";
                break;
            case RUNNING:
                text = model + " · " + (rt.backend() == null ? "" : rt.backend() + " · ") + "http://127.0.0.1:" + rt.port() + "/v1";
                break;
            default:
                text = "Stopped";
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, flags);
        Intent stop = new Intent(this, LlamaServerService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, flags);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_runtime)
            .setContentTitle("Aetheria Workbench runtime")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text + "\nThis app and Mira in Chrome use it. Stop it here when you are done."))
            .setContentIntent(openPi)
            .addAction(0, "Stop", stopPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}
