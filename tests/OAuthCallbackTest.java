import io.gh.reisxd.tizentube.vot.OAuthCallback;
public class OAuthCallbackTest {
    static final String STATE = "123456789012345678901234567890";
    static final String URL = "https://rust-server-531j.onrender.com/auth/callback#access_token=abcdefghijklmnopqrstuvwxyz&expires_in=3600&state=" + STATE;
    static void rejects(String url, String state) throws Exception {
        try { OAuthCallback.parse(url, state, 1000); } catch (Exception expected) { return; }
        throw new AssertionError("Unsafe callback accepted");
    }
    public static void main(String[] args) throws Exception {
        if (OAuthCallback.parse(URL, STATE, 1000).expiresAt != 3601000) throw new AssertionError();
        rejects(URL, "another-state-123456789012345");
        rejects(URL.replace("https:", "http:"), STATE);
        rejects(URL.replace("onrender.com", "onrender.com.evil.test"), STATE);
        rejects(URL.replace("/auth/callback", "/other"), STATE);
        rejects(URL.replace("#", "?"), STATE);
        rejects(URL.replace("3600", "0"), STATE);
        rejects(URL.replace("3600", "9223372036854775807"), STATE);
        rejects(URL + "&state=" + STATE, STATE);
        rejects(URL + "&error=access_denied", STATE);
        System.out.println("OAuth callback: 10 assertions passed");
    }
}
