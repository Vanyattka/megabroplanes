package com.mbplanes.app;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // A flight sim is useless with the screen dimming mid-climb.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    // Draw edge-to-edge, including under a camera cutout in landscape — the
    // web layout pads itself with env(safe-area-inset-*) so nothing hides.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      getWindow().getAttributes().layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // Immersive fullscreen: hide status + nav bars; a swipe from the edge
    // shows them transiently. Re-applied on every focus regain (system
    // dialogs and the app switcher un-hide the bars).
    if (hasFocus) {
      WindowInsetsControllerCompat c =
          WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
      c.setSystemBarsBehavior(
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      c.hide(WindowInsetsCompat.Type.systemBars());
    }
  }
}
