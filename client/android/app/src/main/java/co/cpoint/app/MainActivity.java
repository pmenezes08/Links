package co.cpoint.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import java.util.UUID;

public class MainActivity extends BridgeActivity {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private int shareNavRetries = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareImportPlugin.class);
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        ShareIntentHelper.saveIncomingIntent(this, intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Badge sync handled robustly by JS BadgeContext resume listener + server-driven
        // clear-badge calls. No additional native badge logic needed to avoid breaking plugin.
        maybeNavigateToShareIncoming();
    }

    /**
     * When Android hands us a SEND/SEND_MULTIPLE intent, we've already written the share
     * manifest to {@code IncomingShare/}. We now need to tell the React app to navigate to
     * {@code /share/incoming} so the user sees the share picker.
     *
     * History of this method:
     *   v1 — injected {@code window.location.href='/share/incoming'}. Forced a hard HTTP
     *        reload against the remote server.url; Flask had no route, 404 handler wiped
     *        the React app. Symptom: "nothing happens" when tapping C.Point in the share
     *        sheet.
     *   v2 — called {@code bridge.triggerJSEvent("appUrlOpen", "App", data)}. That looks
     *        right, but {@code @capacitor/app}'s {@code addListener('appUrlOpen', cb)}
     *        subscribes through the native plugin-callback bridge, NOT through DOM
     *        CustomEvents. {@code triggerJSEvent} with a non-"window"/"document" target
     *        ends up calling {@code document.querySelector("App")}, which finds no
     *        element and drops the event. Symptom: app launches straight to the
     *        dashboard.
     *
     * v3 (this implementation): synthesize an {@code ACTION_VIEW} intent with a
     * {@code cpoint://share/incoming?t=<uuid>} URI and push it through
     * {@link Bridge#onNewIntent(Intent)}. That dispatches to every registered plugin,
     * including {@code AppPlugin.handleOnNewIntent}, which fires
     * {@code notifyListeners("appUrlOpen", data, retainUntilConsumed=true)}.
     *
     * Why this works for both cold and warm start:
     *   - Warm start: React is mounted, {@code CapacitorApp.addListener('appUrlOpen')}
     *     is active, and the listener fires immediately.
     *   - Cold start: the event is emitted while React is still loading. Because
     *     {@code retainUntilConsumed=true}, Capacitor queues the event natively until
     *     a JS listener subscribes — same mechanism iOS uses.
     *
     * The JS handler in App.tsx matches {@code url.startsWith('cpoint://share')} and
     * calls {@code navigate('/share/incoming')} — a soft React-Router transition with
     * no HTTP round-trip.
     *
     * iOS is unaffected: iOS has its own native path via {@code UIApplication.open}
     * from the Share Extension.
     */
    private void maybeNavigateToShareIncoming() {
        if (!ShareIntentHelper.hasPendingNavigation()) {
            shareNavRetries = 0;
            return;
        }
        Bridge bridge = getBridge();
        if (bridge == null) {
            if (shareNavRetries++ < 25) {
                mainHandler.postDelayed(this::maybeNavigateToShareIncoming, 400);
            } else {
                ShareIntentHelper.clearPendingNavigationFlag();
                shareNavRetries = 0;
            }
            return;
        }
        shareNavRetries = 0;
        ShareIntentHelper.clearPendingNavigationFlag();

        Intent viewIntent = new Intent(Intent.ACTION_VIEW);
        // Unique token so repeat shares in the same session aren't deduped by JS.
        viewIntent.setData(Uri.parse("cpoint://share/incoming?t=" + UUID.randomUUID().toString()));
        bridge.onNewIntent(viewIntent);
    }
}
