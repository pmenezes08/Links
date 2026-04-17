package co.cpoint.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

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
        final String js =
            "(function(){var p=window.location.pathname||'';if(p.indexOf('/share/incoming')!==0){window.location.href='/share/incoming';}})();";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            bridge.getWebView().evaluateJavascript(js, null);
        } else {
            bridge.getWebView().loadUrl("javascript:" + js);
        }
    }
}
