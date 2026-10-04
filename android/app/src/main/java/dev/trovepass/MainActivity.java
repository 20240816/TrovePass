// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
package dev.trovepass;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.app.LocaleManager;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.LocaleList;
import android.os.PersistableBundle;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final String TAG = "TrovePass";
    private static final String ORIGIN = "https://appassets.androidplatform.net/";

    private static final String ORIGIN_HOST = ORIGIN.substring(ORIGIN.indexOf("://") + 3, ORIGIN.length() - 1);

    private static final String ASSETS_PREFIX = "/assets/";
    private static final String START_URL = ORIGIN + "assets/www/web/index.html";

    private static final int REQ_SAVE_FILE = 4701;
    private static final int REQ_OPEN_FILE = 4702;

    private static final String RESULT_NONE = "none";
    private static final String RESULT_OK_BACKUP = "ok";
    private static final String RESULT_FAILED_BACKUP = "failed";

    private static final int REQ_UNLOCK = 4703;

    private static final String ACTION_TAB = "dev.trovepass.action.TAB";
    private static final String EXTRA_TAB = "dev.trovepass.extra.TAB";

    private static final int SHARED_TEXT_MAX = 256;

    private static final int ENGINE_FLOOR_CHROMIUM = 67;

    private static final String PREFS = "trovepass.shell";
    private static final String LOCK_KEY = "appLock";

    private static final String LOCK_ON_BACKGROUND_KEY = "lockOnBackground";

    private static final String LOCK_IDLE_KEY = "lockIdleMs";

    private static final long[] LOCK_IDLE_SPANS = { 0L, 60_000L, 300_000L, 900_000L };
    private boolean lockEnabled;

    private boolean lockOnBackground;

    private long lockIdleMs;

    private boolean needsUnlock;

    private boolean prompting;

    private boolean promptingToEnable;

    private final Handler idleHandler = new Handler(Looper.getMainLooper());

    private final Runnable idleLock = () -> {
        if (!lockEnabled || lockIdleMs <= 0 || prompting || needsUnlock) return;
        engageLock();
        hideForLock();
        promptForDeviceCredential(false);
    };

    private WebView webView;

    private FrameLayout shell;

    private boolean debuggable;

    private long processStartedAt;

    private boolean processStartKnown;

    private String pendingBackupText;

    private String pendingBackupResult;

    private ValueCallback<Uri[]> pendingFileChooser;

    private volatile String pendingTab = "";
    private volatile String pendingText = "";

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (!engineCanRunTheApp()) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            processStartKnown = true;
            processStartedAt = Process.getStartUptimeMillis();
        } else {
            processStartedAt = SystemClock.uptimeMillis();
        }

        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        SharedPreferences lockPrefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        lockEnabled = lockPrefs.getBoolean(LOCK_KEY, false);
        lockOnBackground = lockPrefs.getBoolean(LOCK_ON_BACKGROUND_KEY, false);
        lockIdleMs = lockPrefs.getLong(LOCK_IDLE_KEY, 900_000L);
        if (lockEnabled) {

            engageLock();
            promptForDeviceCredential(false);
        }

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        settings.setSaveFormData(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(false);
        }

        boolean debuggable =
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        this.debuggable = debuggable;
        if (!debuggable) {
            WebView.setWebContentsDebuggingEnabled(false);
        }

        applyFontScale(getResources().getConfiguration().fontScale);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {

                if (debuggable) {
                    Log.i(TAG, "page: visible");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {

                if (debuggable) {
                    Log.i(TAG, "page: loaded in " + (SystemClock.uptimeMillis() - processStartedAt)
                            + (processStartKnown ? "ms since process start" : "ms since the Activity started"));
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {

                return true;
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {

                request.deny();
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {

                if (pendingFileChooser != null) {
                    pendingFileChooser.onReceiveValue(null);
                }
                pendingFileChooser = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(intent, REQ_OPEN_FILE);
                    return true;
                } catch (RuntimeException failure) {

                    pendingFileChooser = null;
                    callback.onReceiveValue(null);
                    if (debuggable) Log.w(TAG, "no document picker: " + failure);
                    return false;
                }
            }
        });

        webView.addJavascriptInterface(new NativeBridge(), "TrovePassAndroid");

        FrameLayout shell = new FrameLayout(this);
        this.shell = shell;
        shell.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        shell.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets inset = windowInsets.getInsets(
                        WindowInsets.Type.systemBars()
                                | WindowInsets.Type.displayCutout()
                                | WindowInsets.Type.ime());
                view.setPadding(inset.left, inset.top, inset.right, inset.bottom);

                if (debuggable) {
                    Insets cutout = windowInsets.getInsets(WindowInsets.Type.displayCutout());
                    Log.i(TAG, "insets: top=" + view.getPaddingTop() + " bottom=" + view.getPaddingBottom()
                            + " cutout=" + cutout.top);
                }

                return WindowInsets.CONSUMED;
            }
            return windowInsets;
        });

        setContentView(shell);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = webView.getWindowInsetsController();
            if (controller != null) {

                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(
                        getResources().getBoolean(R.bool.trovepass_light_bars) ? mask : 0, mask);
            }
        }

        if (lockEnabled && needsUnlock) {
            hideForLock();
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::finish);
            setRecentsScreenshotEnabled(false);
        }

        webView.loadUrl(START_URL);
        readEntryIntent(getIntent());
    }

    private void readEntryIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (ACTION_TAB.equals(action)) {
            String tab = intent.getStringExtra(EXTRA_TAB);
            if (tab != null && !tab.isEmpty()) pendingTab = tab;
            return;
        }
        CharSequence shared = null;
        if (Intent.ACTION_SEND.equals(action)) {
            shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Intent.ACTION_PROCESS_TEXT.equals(action)) {

            shared = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);

            setResult(RESULT_CANCELED);
        }
        if (shared == null) return;
        String text = shared.toString();
        pendingText = text.length() > SHARED_TEXT_MAX ? text.substring(0, SHARED_TEXT_MAX) : text;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readEntryIntent(intent);
    }

    private void applyFontScale(float fontScale) {
        if (webView == null) return;
        int percent = Math.round(fontScale * 100);
        WebSettings settings = webView.getSettings();
        if (settings.getTextZoom() != percent) {
            settings.setTextZoom(percent);
            if (debuggable) Log.i(TAG, "fontScale: " + fontScale + " -> textZoom " + percent + "%");
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyFontScale(newConfig.fontScale);
    }

    private void hideForLock() {
        if (webView != null) {
            webView.setVisibility(View.INVISIBLE);
        }
    }

    private void showApp() {
        if (webView != null) {
            webView.setVisibility(View.VISIBLE);
        }
    }

    private void promptForDeviceCredential(boolean toEnable) {
        if (prompting) {
            return;
        }
        try {
            KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            Intent prompt = keyguard == null ? null : keyguard.createConfirmDeviceCredentialIntent(null, null);
            if (prompt == null) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(LOCK_KEY, false).apply();
                lockEnabled = false;
                needsUnlock = false;
                showApp();
                if (debuggable) Log.i(TAG, "lock: no device credential, the setting is off");
                return;
            }
            prompting = true;
            promptingToEnable = toEnable;
            startActivityForResult(prompt, REQ_UNLOCK);
        } catch (RuntimeException failure) {

            prompting = false;
            showApp();
            if (debuggable) Log.w(TAG, "lock: could not raise the credential prompt: " + failure);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();

        if (lockEnabled && lockOnBackground) {
            needsUnlock = true;
            hideForLock();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (lockEnabled && needsUnlock && !prompting) {
            promptForDeviceCredential(false);
        }
        armIdleLock();
    }

    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        noteActivity();
    }

    private void engageLock() {
        needsUnlock = true;
    }

    private void armIdleLock() {
        idleHandler.removeCallbacks(idleLock);
        if (!lockEnabled || lockIdleMs <= 0 || prompting || needsUnlock) return;
        idleHandler.postDelayed(idleLock, lockIdleMs);
    }

    private void noteActivity() {
        if (lockEnabled && lockIdleMs > 0) armIdleLock();
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void clipboardCopied() {
            runOnUiThread(() -> {

                try {
                    ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (manager == null || !manager.hasPrimaryClip()) {
                        return;
                    }
                    ClipData current = manager.getPrimaryClip();
                    if (current == null || current.getItemCount() == 0) {
                        return;
                    }
                    CharSequence text = current.getItemAt(0).coerceToText(MainActivity.this);
                    ClipData sensitive = ClipData.newPlainText("TrovePass", text);

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        PersistableBundle extras = new PersistableBundle();
                        extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
                        sensitive.getDescription().setExtras(extras);
                    }
                    manager.setPrimaryClip(sensitive);
                } catch (RuntimeException failure) {

                    if (debuggable) Log.w(TAG, "could not mark the clip sensitive: " + failure);
                }
            });
        }

        @JavascriptInterface
        public String takePendingTab() {
            String tab = pendingTab;
            pendingTab = "";
            return tab == null ? "" : tab;
        }

        @JavascriptInterface
        public String takePendingText() {
            String text = pendingText;
            pendingText = "";
            return text == null ? "" : text;
        }

        @JavascriptInterface
        public String appLocale() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "";
            try {
                LocaleManager manager = (LocaleManager) getSystemService(LOCALE_SERVICE);
                if (manager == null) return "";
                LocaleList locales = manager.getApplicationLocales();
                return locales == null || locales.isEmpty() ? "" : locales.get(0).toLanguageTag();
            } catch (RuntimeException failure) {
                if (debuggable) Log.w(TAG, "could not read the app locale: " + failure);
                return "";
            }
        }

        @JavascriptInterface
        public void setAppLocale(String tag) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
            if (tag == null || tag.isEmpty()) return;
            runOnUiThread(() -> {
                try {
                    LocaleManager manager = (LocaleManager) getSystemService(LOCALE_SERVICE);
                    if (manager != null) manager.setApplicationLocales(LocaleList.forLanguageTags(tag));
                } catch (RuntimeException failure) {
                    if (debuggable) Log.w(TAG, "could not set the app locale: " + failure);
                }
            });
        }

        @JavascriptInterface
        public void clearClipboard() {
            runOnUiThread(() -> {
                try {
                    ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        manager.clearPrimaryClip();
                    }
                } catch (RuntimeException failure) {
                    if (debuggable) Log.w(TAG, "could not clear the clip: " + failure);
                }
            });
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void schemeChanged(boolean dark) {
            runOnUiThread(() -> {
                try {

                    int colour = getResources()
                            .getColor(dark ? R.color.trovepass_chrome_night : R.color.trovepass_chrome_day);
                    getWindow().setStatusBarColor(colour);
                    getWindow().setNavigationBarColor(colour);
                    if (shell != null) {
                        shell.setBackgroundColor(colour);
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && webView != null) {
                        WindowInsetsController controller = webView.getWindowInsetsController();
                        if (controller != null) {
                            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                            controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
                        }
                    }
                } catch (RuntimeException failure) {
                    if (debuggable) Log.w(TAG, "could not restyle the bars: " + failure);
                }
            });
        }

        @JavascriptInterface
        public String appLockState() {
            KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (!deviceHasCredential(keyguard)) {
                return "unavailable";
            }
            return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(LOCK_KEY, false) ? "on" : "off";
        }

        @JavascriptInterface
        public boolean appLockBackground() {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(LOCK_ON_BACKGROUND_KEY, false);
        }

        @JavascriptInterface
        public double lockIdleMs() {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getLong(LOCK_IDLE_KEY, 900_000L);
        }

        @JavascriptInterface
        public void setLockIdleMs(double ms) {
            runOnUiThread(() -> {
                try {
                    long chosen = (long) ms;
                    long safe = 0;
                    for (long allowed : LOCK_IDLE_SPANS) {
                        if (allowed == chosen) safe = allowed;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(LOCK_IDLE_KEY, safe).apply();
                    lockIdleMs = safe;
                    armIdleLock();
                } catch (RuntimeException failure) {
                    if (debuggable) Log.w(TAG, "lock: could not set the idle span: " + failure);
                }
            });
        }

        @JavascriptInterface
        public void noteActivity() {
            runOnUiThread(MainActivity.this::noteActivity);
        }

        @JavascriptInterface
        public String lastBackupResult() {
            String result = pendingBackupResult == null ? RESULT_NONE : pendingBackupResult;
            pendingBackupResult = null;
            return result;
        }

        @JavascriptInterface
        public void setAppLockBackground(boolean on) {
            runOnUiThread(() -> {
                try {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(LOCK_ON_BACKGROUND_KEY, on).apply();
                    lockOnBackground = on;
                } catch (RuntimeException failure) {

                    if (debuggable) Log.w(TAG, "lock: could not set the background setting: " + failure);
                }
            });
        }

        @JavascriptInterface
        public void setAppLock(boolean on) {
            runOnUiThread(() -> {
                try {
                    KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                    boolean possible = deviceHasCredential(keyguard);
                    if (!on || !possible) {
                        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(LOCK_KEY, false).apply();
                        lockEnabled = false;
                        needsUnlock = false;
                        showApp();
                        return;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(LOCK_KEY, true).apply();
                    lockEnabled = true;
                    promptForDeviceCredential(true);
                } catch (RuntimeException failure) {

                    if (debuggable) Log.w(TAG, "lock: could not set the lock: " + failure);
                }
            });
        }

        @JavascriptInterface
        public void shareText(String title, String text) {            runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title);
                    send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);

                    Intent chooser = Intent.createChooser(send, title == null ? "" : title);
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(chooser);
                } catch (RuntimeException failure) {
                    if (debuggable) Log.w(TAG, "could not open the share sheet: " + failure);
                }
            });
        }

        @JavascriptInterface
        public void saveFile(String name, String text) {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("text/plain");

                    intent.putExtra(Intent.EXTRA_TITLE, name);
                    pendingBackupText = text;
                    startActivityForResult(intent, REQ_SAVE_FILE);
                } catch (RuntimeException failure) {

                    pendingBackupText = null;

                    pendingBackupResult = RESULT_FAILED_BACKUP;
                    if (debuggable) Log.w(TAG, "could not open the save dialog: " + failure);
                }
            });
        }

    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_UNLOCK) {

            if (!prompting) {
                return;
            }
            prompting = false;
            if (resultCode == RESULT_OK) {
                needsUnlock = false;
                showApp();

                armIdleLock();
            } else if (promptingToEnable) {

                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(LOCK_KEY, false).apply();
                lockEnabled = false;
                needsUnlock = false;
                showApp();
            } else {

                finish();
            }
            return;
        }
        if (requestCode == REQ_SAVE_FILE) {
            String text = pendingBackupText;
            pendingBackupText = null;
            Uri target = (resultCode == RESULT_OK && data != null) ? data.getData() : null;

            pendingBackupResult = text != null && target != null && writeTextFile(target, text) ? RESULT_OK_BACKUP : RESULT_FAILED_BACKUP;
            return;
        }
        if (requestCode == REQ_OPEN_FILE) {
            ValueCallback<Uri[]> callback = pendingFileChooser;
            pendingFileChooser = null;
            if (callback != null) {
                Uri picked = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
                callback.onReceiveValue(picked == null ? null : new Uri[] {picked});
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private boolean writeTextFile(Uri target, String text) {
        try (OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
            if (out == null) {
                throw new IOException("no stream for " + target);
            }
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.flush();
            return true;
        } catch (IOException | RuntimeException failure) {
            Log.w(TAG, "could not write the backup file: " + failure);
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        finish();
    }

    private WebResourceResponse serveAsset(Uri url) {
        if (url == null || !ORIGIN_HOST.equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || !path.startsWith(ASSETS_PREFIX)) return null;
        String name = path.substring(ASSETS_PREFIX.length());

        if (name.isEmpty() || name.startsWith("/") || name.contains("..") || name.indexOf('\\') >= 0) {
            return notFound();
        }
        try {
            return new WebResourceResponse(mimeOf(name), charsetOf(name), getAssets().open(name));
        } catch (IOException missing) {
            return notFound();
        }
    }

    private boolean engineCanRunTheApp() {
        int chromium = webViewChromiumMajor();
        if (chromium <= 0 || chromium >= ENGINE_FLOOR_CHROMIUM) {
            return true;
        }
        Log.w(TAG, "the WebView is Chromium " + chromium + "; this app needs " + ENGINE_FLOOR_CHROMIUM);
        new AlertDialog.Builder(this)
                .setTitle(R.string.webview_old_title)
                .setMessage(getString(R.string.webview_old_body, chromium, ENGINE_FLOOR_CHROMIUM))
                .setPositiveButton(android.R.string.ok, (dialog, which) -> finish())
                .setCancelable(false)
                .show();
        return false;
    }

    private int webViewChromiumMajor() {
        try {
            String userAgent = WebSettings.getDefaultUserAgent(this);
            Matcher chrome = Pattern.compile("Chrome/(\\d+)").matcher(userAgent == null ? "" : userAgent);
            return chrome.find() ? Integer.parseInt(chrome.group(1)) : 0;
        } catch (RuntimeException unreadable) {
            Log.w(TAG, "could not read the WebView's version: " + unreadable);
            return 0;
        }
    }

    @SuppressWarnings("deprecation")
    private boolean deviceHasCredential(KeyguardManager keyguard) {
        if (keyguard == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return keyguard.isDeviceSecure();
        }
        return keyguard.isKeyguardSecure();
    }

    private static String mimeOf(String name) {
        switch (extensionOf(name)) {
            case "html": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    private static String charsetOf(String name) {
        String type = mimeOf(name);
        return type.startsWith("text/") || type.endsWith("+json") ? "utf-8" : null;
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
