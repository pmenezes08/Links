package co.cpoint.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

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
     * We used to inject {@code window.location.href='/share/incoming'}, which forced the
     * WebView to do a hard reload against the staging server. The backend has no Flask
     * route for that path, so Flask's 404 handler replaced the React app with an error
     * page — exactly the "nothing happens" symptom.
     *
     * Instead, we now emit the same Capacitor {@code appUrlOpen} plugin event that iOS's
     * Share Extension triggers via {@code cpoint://share/incoming?t=...}. The JS handler
     * in App.tsx ({@code CapacitorApp.addListener('appUrlOpen', ...)}) catches it and
     * calls {@code navigate('/share/incoming')} — a soft React-Router navigation with no
     * server round-trip. This unifies the share-handoff path across iOS and Android.
     *
     * NOTE: the {@code "App"} target string must match the {@code @capacitor/app} plugin
     * ID. That's the same target the plugin uses internally when it calls
     * {@code notifyListeners("appUrlOpen", ...)} from its own native code, so our JS
     * listener receives it identically regardless of who emitted it.
     */
    private void maybeNavigateToShareIncoming() {
        if (!ShareIntentHelper.hasPendingNavigation()) {
            shareNavRetries = 0;
            return;
        }
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
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

        JSObject data = new JSObject();
        // Unique query so JS can dedupe repeats without blocking a later share in the session.
        data.put("url", "cpoint://share/incoming?t=" + UUID.randomUUID().toString());
        bridge.triggerJSEvent("appUrlOpen", "App", data.toString());
    }
}
