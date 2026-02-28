package co.cpoint.app;

import android.os.Bundle;
import android.view.View;
import android.view.Window;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Dark status bar with light icons (matching iOS)
        Window window = getWindow();
        window.setStatusBarColor(0xFF000000);
        window.setNavigationBarColor(0xFF000000);
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(0); // Light icons on dark background
    }
}
