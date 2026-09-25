package io.gh.reisxd.tizentube.vot;

import java.net.URI;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/** Strict parser: no token is accepted from arbitrary pages, query strings or another login. */
public final class OAuthCallback {
    public static final String HOST = "rust-server-531j.onrender.com";
    public final String token;
    public final long expiresAt;
    private OAuthCallback(String token, long expiresAt) { this.token = token; this.expiresAt = expiresAt; }
    public static boolean isCallback(String url) {
        try {
            URI uri = new URI(url);
            return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1
                && uri.getUserInfo() == null && "/auth/callback".equals(uri.getPath());
        } catch (Exception e) { return false; }
    }
    public static OAuthCallback parse(String url, String expectedState, long now) throws Exception {
        if (!isCallback(url) || expectedState == null || expectedState.length() < 20) throw new Exception("Неверный адрес входа");
        String fragment = new URI(url).getRawFragment();
        Map<String, String> values = new HashMap<>();
        if (fragment != null) for (String part : fragment.split("&")) {
            String[] pair = part.split("=", 2);
            String key = URLDecoder.decode(pair[0], "UTF-8");
            if (values.containsKey(key)) throw new Exception("Повтор параметра авторизации");
            values.put(key, pair.length == 2 ? URLDecoder.decode(pair[1], "UTF-8") : "");
        }
        if (!expectedState.equals(values.get("state"))) throw new Exception("Не совпало подтверждение входа. Попробуйте ещё раз.");
        if (values.containsKey("error")) throw new Exception("Вход отменён или отклонён Яндексом");
        String token = values.get("access_token");
        if (token == null || !token.matches("[A-Za-z0-9_\\-\\.]{20,4096}")) throw new Exception("Яндекс не вернул токен");
        long seconds;
        try { seconds = Long.parseLong(values.get("expires_in")); } catch (Exception e) { throw new Exception("Нет срока действия токена"); }
        if (seconds <= 0 || seconds > (Long.MAX_VALUE - now) / 1000) throw new Exception("Неверный срок действия токена");
        return new OAuthCallback(token, now + seconds * 1000);
    }
}
