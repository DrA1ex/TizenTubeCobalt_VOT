package io.gh.reisxd.tizentube.vot;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.net.Uri;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.view.WindowManager;
import android.widget.Toast;
import java.util.UUID;

/** Same auth entry point as VOT extension. Credentials stay on Yandex's HTTPS pages. */
public final class YandexAuthActivity extends Activity {
    private WebView web;
    private String state;
    private boolean finished;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        state = UUID.randomUUID().toString();
        try {
            web = new WebView(this);
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setSupportMultipleWindows(false);
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return navigate(url); }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return request.isForMainFrame() && navigate(request.getUrl().toString());
                }
                @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                    if (OAuthCallback.isCallback(url)) complete(url);
                    else if (!allowed(url)) { view.stopLoading(); fail(NativeStrings.text("theSignInPageRedirectedTo")); }
                }
                @Override public void onPageFinished(WebView view, String url) {
                    if (OAuthCallback.isCallback(url)) complete(url);
                }
            });
            setContentView(web);
            web.requestFocus();
            web.loadUrl("https://" + OAuthCallback.HOST + "/v1/auth/handle");
        } catch (Throwable e) { fail(NativeStrings.text("webviewIsUnavailableOnThisDevice")); }
    }
    private boolean allowed(String url) {
        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        return "https".equals(uri.getScheme()) && uri.getPort() == -1 && uri.getUserInfo() == null && host != null
            && (OAuthCallback.HOST.equals(host) || "yandex.ru".equals(host) || host.endsWith(".yandex.ru")
                || "yandex.com".equals(host) || host.endsWith(".yandex.com") || "ya.ru".equals(host) || host.endsWith(".ya.ru"));
    }
    private boolean navigate(String url) {
        if (finished) return true;
        if (OAuthCallback.isCallback(url)) { complete(url); return true; }
        if (!allowed(url)) { fail(NativeStrings.text("unsupportedSignInAddressEnterThe")); return true; }
        Uri uri = Uri.parse(url);
        if ("oauth.yandex.ru".equals(uri.getHost()) && "/authorize".equals(uri.getPath())
                && !state.equals(uri.getQueryParameter("state"))) {
            Uri.Builder builder = uri.buildUpon().clearQuery();
            for (String key : uri.getQueryParameterNames()) if (!"state".equals(key))
                for (String value : uri.getQueryParameters(key)) builder.appendQueryParameter(key, value);
            web.loadUrl(builder.appendQueryParameter("state", state).build().toString());
            return true;
        }
        return false;
    }
    private void complete(String url) {
        if (finished) return;
        if (web != null) web.stopLoading();
        try {
            OAuthCallback result = OAuthCallback.parse(url, state, System.currentTimeMillis());
            new TokenStore(this).save(result.token, result.expiresAt);
            finished = true;
            Toast.makeText(this, NativeStrings.text("yandexSignedIn"), Toast.LENGTH_LONG).show();
            finish();
        } catch (Exception e) { fail(e.getMessage()); }
    }
    private void fail(String message) {
        if (finished) return;
        finished = true;
        if (web != null) web.stopLoading();
        new AlertDialog.Builder(this).setTitle(NativeStrings.text("signInToYandex")).setMessage(message)
            .setPositiveButton(NativeStrings.text("close"), (dialog, which) -> finish()).setOnCancelListener(dialog -> finish()).show();
    }
    @Override public void onBackPressed() { finish(); }
    @Override protected void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        super.onDestroy();
    }
}
