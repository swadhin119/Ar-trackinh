package com.heroar.camera;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Hosts the Hero AR web app (bundled in assets/www) in a full-screen WebView.
 * Pages are served from https://appassets.androidplatform.net so the WebView treats them
 * as a secure context (needed for getUserMedia / camera).
 */
public class MainActivity extends Activity {
    private static final int REQ_PERMS = 42;
    private WebView web;
    private PermissionRequest pendingRequest;
    private final AssetSaver saver = new AssetSaver();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);
        hideSystemUi();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setBackgroundColor(0xFF000000);
        web.addJavascriptInterface(saver, "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse r = loader.shouldInterceptRequest(request.getUrl());
                if (r != null) {
                    String p = request.getUrl().getPath();
                    if (p != null && p.endsWith(".wasm")) r.setMimeType("application/wasm");
                    else if (p != null && (p.endsWith(".mjs") || p.endsWith(".js"))) r.setMimeType("text/javascript");
                }
                return r;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"appassets.androidplatform.net".equals(request.getUrl().getHost());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }
        });

        web.loadUrl("https://appassets.androidplatform.net/www/index.html");
    }

    private void handleWebPermission(PermissionRequest request) {
        List<String> need = new ArrayList<>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                need.add(Manifest.permission.CAMERA);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                need.add(Manifest.permission.RECORD_AUDIO);
            }
        }
        if (need.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingRequest = request;
            requestPermissions(need.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_PERMS || pendingRequest == null) return;
        List<String> granted = new ArrayList<>();
        for (String res : pendingRequest.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) granted.add(res);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) granted.add(res);
        }
        if (granted.isEmpty()) pendingRequest.deny();
        else pendingRequest.grant(granted.toArray(new String[0]));
        pendingRequest = null;
    }

    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.heroBack && window.heroBack()", v -> {
            if (!"true".equals(v)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() { web.destroy(); super.onDestroy(); }

    /**
     * JS bridge: blob: URLs can't be downloaded from a WebView, so the page streams the
     * recording/photo here in base64 chunks and we write it into the phone's Gallery.
     */
    class AssetSaver {
        private OutputStream out;
        private Uri uri;
        private File legacyFile;
        private String mime;
        private Uri lastSaved;

        @JavascriptInterface
        public boolean begin(String name, String mimeType) {
            try {
                close();
                mime = mimeType;
                boolean video = mimeType.startsWith("video");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/HeroAR");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri col = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                    uri = getContentResolver().insert(col, v);
                    out = getContentResolver().openOutputStream(uri);
                } else {
                    if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 7));
                        return false;
                    }
                    File dir = new File(Environment.getExternalStoragePublicDirectory(
                            video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES), "HeroAR");
                    dir.mkdirs();
                    legacyFile = new File(dir, name);
                    out = new FileOutputStream(legacyFile);
                }
                return out != null;
            } catch (Exception e) {
                toast("Save error: " + e.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean append(String base64) {
            try {
                out.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean finish() {
            try {
                out.flush();
                out.close();
                out = null;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(uri, v, null, null);
                    lastSaved = uri;
                } else {
                    MediaScannerConnection.scanFile(MainActivity.this,
                            new String[]{legacyFile.getAbsolutePath()}, new String[]{mime},
                            (p, u) -> lastSaved = u);
                    lastSaved = Uri.fromFile(legacyFile);
                }
                toast("Gallery me save ho gaya ✔ (HeroAR folder)");
                return true;
            } catch (Exception e) {
                toast("Save error: " + e.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public void share() {
            if (lastSaved == null || "file".equals(lastSaved.getScheme())) {
                toast("Pehle Save karo, phir Share");
                return;
            }
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, lastSaved);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, "Share Hero AR")));
        }

        private void close() {
            try { if (out != null) out.close(); } catch (Exception ignored) { }
            out = null;
            if (uri != null && Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = getContentResolver();
                try { cr.delete(uri, MediaStore.MediaColumns.IS_PENDING + "=1", null); } catch (Exception ignored) { }
            }
            uri = null;
        }

        private void toast(String m) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show());
        }
    }
}
