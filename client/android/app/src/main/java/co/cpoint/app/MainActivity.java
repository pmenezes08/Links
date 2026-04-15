package co.cpoint.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Badge sync handled robustly by JS BadgeContext resume listener + server-driven
        // clear-badge calls. No additional native badge logic needed to avoid breaking plugin.
    }
}
