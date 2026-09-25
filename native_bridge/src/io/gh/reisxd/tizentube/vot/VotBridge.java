package io.gh.reisxd.tizentube.vot;

import android.content.Context;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.widget.EditText;
import android.widget.Toast;
import android.text.InputType;
import android.os.SystemClock;
import java.lang.ref.WeakReference;
import java.util.UUID;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import dev.cobalt.coat.CobaltActivity;
import dev.cobalt.coat.javabridge.CobaltJavaScriptAndroidObject;
import dev.cobalt.coat.javabridge.CobaltJavaScriptInterface;

import org.chromium.content_public.browser.JavascriptInjector;
import org.chromium.content_public.browser.WebContents;
import org.chromium.content.browser.JavascriptInjectorImpl;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class VotBridge implements CobaltJavaScriptAndroidObject {
    private static final String TAG = "TizenTubeVOT";
    private static final String WORKER_HOST = "vot-worker.eu.cc";
    private static final String YANDEX_HOST = "api.browser.yandex.ru";
    private static final String AUDIO_HOST = "vtrans.s3-private.mds.yandex.net";
    private static final String WORKER_AUDIO_PREFIX = "/video-translation/audio-proxy/";
    private static volatile VotBridge current;

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService localServerExecutor = Executors.newCachedThreadPool();
    private volatile ServerSocket localServer;
    private final String bridgeKey = UUID.randomUUID().toString();
    private final PlaybackOrder order = new PlaybackOrder();
    private final TokenStore tokenStore;
    private WeakReference<CobaltActivity> activityRef;
    private volatile boolean foreground = true;
    private long lastHeartbeat;
    private String mediaSession = "";
    private boolean seekInFlight;
    private int requestedSeek;
    private float appliedRate = 1.0f;
    private MediaPlayer player;
    private volatile boolean prepared;
    private volatile boolean shouldPlay;
    private volatile int pendingPositionMs;
    private long pendingPositionAt;
    private volatile float pendingVolume = 1.0f;
    private volatile float pendingRate = 1.0f;
    private volatile String state = "idle";
    private volatile String lastError = "";
    private String userscript;
    private boolean userscriptRequested;

    public VotBridge(Context context) {
        this.context = context.getApplicationContext();
        this.tokenStore = new TokenStore(this.context);
        if (context instanceof CobaltActivity) activityRef = new WeakReference<>((CobaltActivity) context);
        startWatchdog();
        VotBridge previous = current;
        if (previous != null) previous.shutdown();
        current = this;
        startLocalServer();
    }

    @Override
    public String getJavaScriptInterfaceName() {
        return "votNative";
    }

    @CobaltJavaScriptInterface
    public String request(final String requestJson) {
        try {
            return networkExecutor.submit(new Callable<String>() {
                @Override
                public String call() throws Exception {
                    return performRequest(requestJson);
                }
            }).get(65, TimeUnit.SECONDS);
        } catch (Exception error) {
            Log.e(TAG, "Native VOT request failed", error);
            return errorResponse(error.toString());
        }
    }

    @CobaltJavaScriptInterface
    public String command(String commandJson) {
        try {
            final JSONObject command = new JSONObject(commandJson);
            final String action = command.optString("action", "");
            if ("inject".equals(action)) {
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        CobaltActivity activity = activityRef == null ? null : activityRef.get();
                        if (current == VotBridge.this && activity != null && !activity.isFinishing()
                                && userscript != null) {
                            activity.evaluateJavaScript(userscript);
                            userscriptRequested = true;
                        }
                    }
                });
                return "{\"ok\":true}";
            }

            if ("authSet".equals(action)) {
                tokenStore.save(command.getString("token"));
                return "{\"ok\":true}";
            }
            if ("authClear".equals(action)) {
                tokenStore.clear();
                return "{\"ok\":true}";
            }
            if ("authDialog".equals(action)) {
                mainHandler.post(new Runnable() {
                    @Override public void run() { showTokenDialog(); }
                });
                return "{\"ok\":true}";
            }
            if ("authLogin".equals(action)) {
                mainHandler.post(new Runnable() {
                    @Override public void run() {
                        try {
                            context.startActivity(new android.content.Intent(context, YandexAuthActivity.class)
                                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
                        } catch (Exception e) { Toast.makeText(context, "Не удалось открыть вход. Используйте ввод токена.", Toast.LENGTH_LONG).show(); }
                    }
                });
                return "{\"ok\":true}";
            }
            if ("status".equals(action)) return statusResponse();
            if (!"sync".equals(action) && !"stop".equals(action)) return errorResponse("Unknown media command");
            if ("sync".equals(action) && !isAllowedAudioUrl(command.optString("url", ""))) {
                return errorResponse("Audio URL is not allowed");
            }
            mainHandler.post(new Runnable() {
                @Override public void run() {
                    if (!order.accept(command.optLong("epoch", -1), command.optLong("seq", -1))) return;
                    if ("stop".equals(action)) {
                        releasePlayer();
                        mediaSession = "";
                        state = "idle";
                        return;
                    }
                    if (!foreground || System.currentTimeMillis() - command.optLong("sentAt", 0) > 1500) return;
                    handleMediaCommand(action, command);
                }
            });
            return "sync".equals(action) && command.optString("session").equals(mediaSession)
                    ? statusResponse() : "{\"ok\":true}";
        } catch (Exception error) {
            return errorResponse("Native command failed");
        }
    }

    private void showTokenDialog() {
        final CobaltActivity activity = activityRef == null ? null : activityRef.get();
        if (activity == null || activity.isFinishing()) return;
        final EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setHint("OAuth-токен Яндекса");
        input.setTextSize(22);
        input.setPadding(32, 24, 32, 24);
        final AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Авторизация Яндекса · живые голоса")
                .setMessage("Вставьте OAuth-токен из VOT / Яндекс. Можно использовать клавиатуру Android TV или вставку из буфера. Токен хранится зашифрованным в приложении и отправляется только Яндексу. Сохранение не проверяет срок действия токена.")
                .setView(input)
                .setPositiveButton("Сохранить", null)
                .setNegativeButton("Отмена", null)
                .setNeutralButton("Удалить токен", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        tokenStore.clear();
                        Toast.makeText(activity, "Токен удалён", Toast.LENGTH_SHORT).show();
                    }
                }).create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override public void onShow(DialogInterface d) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new android.view.View.OnClickListener() {
                    @Override public void onClick(android.view.View view) {
                        try {
                            tokenStore.save(input.getText().toString());
                            input.setText("");
                            Toast.makeText(activity, "Токен сохранён. Выберите «Живой голос» в VOT.", Toast.LENGTH_LONG).show();
                            dialog.dismiss();
                        } catch (Exception error) {
                            input.setError("Проверьте токен: вставьте только значение, без ссылки.");
                        }
                    }
                });
                input.requestFocus();
            }
        });
        dialog.getWindow(); // Window flags are set after show below.
        dialog.show();
        dialog.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
    }

    public static void setForeground(boolean value) {
        VotBridge bridge = current;
        if (bridge == null) return;
        bridge.foreground = value;
        if (!value) {
            bridge.releasePlayer();
            bridge.mediaSession = "";
            bridge.state = "idle";
        }
    }

    private void startWatchdog() {
        mainHandler.postDelayed(new Runnable() {
            @Override public void run() {
                if (current != VotBridge.this) return;
                long silentFor = SystemClock.elapsedRealtime() - lastHeartbeat;
                if (player != null && silentFor > 1200) {
                    shouldPlay = false;
                    if (prepared && player.isPlaying()) player.pause();
                    state = "paused";
                }
                if (player != null && silentFor > 5000) {
                    releasePlayer();
                    mediaSession = "";
                    state = "idle";
                }
                mainHandler.postDelayed(this, 300);
            }
        }, 300);
    }

    public static void inject(final CobaltActivity activity) {
        final VotBridge owner = current;
        final String source;
        final String bootstrap;
        try {
            InputStream input = activity.getAssets().open("tizentube_vot.js");
            source = new String(readAll(input), StandardCharsets.UTF_8);
            input.close();
            input = activity.getAssets().open("tizentube_vot_bootstrap.js");
            bootstrap = new String(readAll(input), StandardCharsets.UTF_8)
                    .replace("\"__VOT_BRIDGE_KEY__\"", JSONObject.quote(owner.bridgeKey));
            input.close();
        } catch (Exception error) {
            Log.e(TAG, "Unable to read embedded userscript", error);
            return;
        }

        final String wrapped = "(function(){if(location.origin!=='https://www.youtube.com'||window.__tizenTubeVotEmbeddedLoaded)return;"
                + "window.__votBridgeKey='" + owner.bridgeKey + "';window.__tizenTubeVotEmbeddedLoaded=true;try{\n"
                + source
                + "\n}catch(e){window.__tizenTubeVotEmbeddedLoaded=false;"
                + "console.error('[VOT] embedded injection failed',e);}})();";
        owner.userscript = wrapped;

        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (current != owner || activity.isFinishing()) return;
                    // Only the small loader is repeated. The full bundle is sent once per document.
                    activity.evaluateJavaScript(bootstrap);
                    owner.mainHandler.postDelayed(this, owner.userscriptRequested ? 3000 : 250);
                }
            }, 0);
    }

    public static void install(final CobaltActivity activity) {
        install(activity, 0);
    }

    private static void install(final CobaltActivity activity, final int attempt) {
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                WebContents webContents = activity.getActiveWebContents();
                if (webContents == null) {
                    if (attempt < 12) install(activity, attempt + 1);
                    else Log.e(TAG, "WebContents did not become ready");
                    return;
                }
                installReady(activity);
            }
        }, attempt == 0 ? 2500 : 1000);
    }

    /** Register while Cobalt's WebContents-ready callback is still running, before loadUrl(). */
    public static void installReady(final CobaltActivity activity) {
        WebContents webContents = activity.getActiveWebContents();
        if (webContents == null) {
            Log.e(TAG, "Cannot register VOT bridge: WebContents is null");
            return;
        }

        VotBridge bridge = new VotBridge(activity);
        // Call Chromium's concrete implementation directly. D8 otherwise
        // rewrites the static interface call to JavascriptInjector$-CC,
        // a desugaring companion that is not present in Cobalt's APK.
        JavascriptInjector injector = JavascriptInjectorImpl.fromWebContents(webContents);
        injector.setAllowInspection(true);
        injector.addPossiblyUnsafeInterface(
                bridge,
                bridge.getJavaScriptInterfaceName(),
                CobaltJavaScriptInterface.class,
                new ArrayList<String>()
        );
        Log.i(TAG, "Native VOT bridge registered before loadUrl");
        inject(activity);
    }

    private void startLocalServer() {
        localServerExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    ServerSocket server = new ServerSocket();
                    server.setReuseAddress(true);
                    server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 8013));
                    localServer = server;
                    Log.i(TAG, "Local VOT bridge listening on 127.0.0.1:8013");
                    while (!server.isClosed()) {
                        final Socket socket = server.accept();
                        localServerExecutor.execute(new Runnable() {
                            @Override
                            public void run() {
                                handleLocalConnection(socket);
                            }
                        });
                    }
                } catch (Exception error) {
                    if (localServer == null || !localServer.isClosed()) {
                        Log.e(TAG, "Local VOT bridge failed", error);
                    }
                }
            }
        });
    }

    private void handleLocalConnection(Socket socket) {
        try {
            socket.setSoTimeout(15000);
            BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
            ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
            int matched = 0;
            while (headerBytes.size() < 65536) {
                int value = input.read();
                if (value < 0) throw new IllegalArgumentException("Incomplete HTTP headers");
                headerBytes.write(value);
                if ((matched == 0 && value == '\r')
                        || (matched == 1 && value == '\n')
                        || (matched == 2 && value == '\r')
                        || (matched == 3 && value == '\n')) {
                    matched++;
                    if (matched == 4) break;
                } else {
                    matched = value == '\r' ? 1 : 0;
                }
            }
            if (matched != 4) throw new IllegalArgumentException("HTTP headers are too large");

            String headerText = new String(headerBytes.toByteArray(), StandardCharsets.ISO_8859_1);
            String[] lines = headerText.split("\\r\\n");
            String[] requestLine = lines[0].split(" ");
            if (requestLine.length < 2) throw new IllegalArgumentException("Invalid HTTP request line");
            String method = requestLine[0];
            String path = requestLine[1];
            int contentLength = 0;
            String origin = "";
            String suppliedKey = "";
            for (int index = 1; index < lines.length; index++) {
                int separator = lines[index].indexOf(':');
                if (separator < 0) continue;
                String name = lines[index].substring(0, separator).trim();
                if ("origin".equalsIgnoreCase(name)) origin = lines[index].substring(separator + 1).trim();
                if ("x-vot-key".equalsIgnoreCase(name)) suppliedKey = lines[index].substring(separator + 1).trim();
                if ("content-length".equalsIgnoreCase(name)) {
                    contentLength = Integer.parseInt(lines[index].substring(separator + 1).trim());
                }
            }
            if (!"https://www.youtube.com".equals(origin) || (!"OPTIONS".equals(method) && !bridgeKey.equals(suppliedKey))) {
                writeLocalResponse(socket, 403, "{\"ok\":false}");
                return;
            }
            if (contentLength < 0 || contentLength > 16 * 1024 * 1024) {
                throw new IllegalArgumentException("Invalid HTTP body size");
            }
            byte[] bodyBytes = new byte[contentLength];
            int offset = 0;
            while (offset < contentLength) {
                int count = input.read(bodyBytes, offset, contentLength - offset);
                if (count < 0) throw new IllegalArgumentException("Incomplete HTTP body");
                offset += count;
            }
            String body = new String(bodyBytes, StandardCharsets.UTF_8);

            if ("OPTIONS".equals(method)) {
                writeLocalResponse(socket, 204, "");
            } else if ("GET".equals(method) && "/health".equals(path)) {
                writeLocalResponse(socket, 200, "{\"ok\":true,\"hasToken\":" + !tokenStore.read().isEmpty()
                        + ",\"foreground\":" + foreground + "}");
            } else if ("POST".equals(method) && "/request".equals(path)) {
                writeLocalResponse(socket, 200, performRequest(body));
            } else if ("POST".equals(method) && "/command".equals(path)) {
                writeLocalResponse(socket, 200, command(body));
            } else {
                writeLocalResponse(socket, 404, "{\"ok\":false,\"error\":\"Not found\"}");
            }
        } catch (Exception error) {
            Log.e(TAG, "Local VOT request failed", error);
            try {
                writeLocalResponse(socket, 500, errorResponse(error.toString()));
            } catch (Exception ignored) {
            }
        } finally {
            try {
                socket.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static void writeLocalResponse(Socket socket, int status, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : "Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: https://www.youtube.com\r\n"
                + "Access-Control-Allow-Private-Network: true\r\n"
                + "Access-Control-Allow-Headers: Content-Type, X-VOT-Key\r\n"
                + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        OutputStream output = socket.getOutputStream();
        output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
        output.write(bytes);
        output.flush();
    }

    private String performRequest(String requestJson) throws Exception {
        JSONObject requestInfo = new JSONObject(requestJson);
        URI uri = URI.create(requestInfo.getString("url"));
        String method = requestInfo.optString("method", "POST").toUpperCase(Locale.US);
        validateRequest(uri, method);

        HttpURLConnection connection = (HttpURLConnection) new URL(uri.toString()).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 14; TV) AppleWebKit/537.36 Chrome/134 Safari/537.36"
        );

        JSONObject headers = requestInfo.optJSONObject("headers");
        if (headers != null) {
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                if ("Authorization".equalsIgnoreCase(name)) {
                    if (!YANDEX_HOST.equals(uri.getHost())) throw new SecurityException("OAuth is restricted to Yandex");
                    String token = tokenStore.read();
                    if (token.isEmpty()) throw new SecurityException("Добавьте OAuth-токен в настройках VOT");
                    connection.setRequestProperty("Authorization", "OAuth " + token);
                    continue;
                }
                if (isBlockedRequestHeader(name) || (WORKER_HOST.equals(uri.getHost()) && "User-Agent".equalsIgnoreCase(name))) continue;
                connection.setRequestProperty(name, headers.optString(name, ""));
            }
        }

        long requestStarted = SystemClock.elapsedRealtime();
        try {
            byte[] body = Base64.decode(requestInfo.optString("bodyBase64", ""), Base64.DEFAULT);
            if (body.length > 0) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                OutputStream output = connection.getOutputStream();
                output.write(body);
                output.close();
            }

            int status = connection.getResponseCode();
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] responseBody = input == null ? new byte[0] : readAll(input);
            if (input != null) input.close();

            JSONObject response = new JSONObject();
            response.put("status", status);
            response.put("contentType", connection.getContentType() == null ? "" : connection.getContentType());
            response.put("bodyBase64", Base64.encodeToString(responseBody, Base64.NO_WRAP));
            Log.i(TAG, "VOT HTTP " + method + " " + uri.getHost() + uri.getPath()
                    + " -> " + status + " in " + (SystemClock.elapsedRealtime() - requestStarted) + "ms");
            return response.toString();
        } catch (Exception error) {
            Log.e(TAG, "VOT HTTP failed " + method + " " + uri.getHost() + uri.getPath()
                    + " after " + (SystemClock.elapsedRealtime() - requestStarted) + "ms", error);
            throw error;
        } finally {
            connection.disconnect();
        }
    }

    private static void validateRequest(URI uri, String method) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new SecurityException("Only HTTPS is allowed");
        }
        if (!"POST".equals(method) && !"PUT".equals(method)) {
            throw new SecurityException("HTTP method is not allowed");
        }
        String host = uri.getHost();
        if (!WORKER_HOST.equals(host) && !YANDEX_HOST.equals(host)) {
            throw new SecurityException("VOT host is not allowed");
        }
        String path = uri.getPath();
        if (!("/session/create".equals(path)
                || "/video-translation/translate".equals(path)
                || "/video-translation/audio".equals(path)
                || "/video-translation/fail-audio-js".equals(path)
                || "/video-translation/cache".equals(path)
                || "/video-subtitles/get-subtitles".equals(path))) {
            throw new SecurityException("VOT path is not allowed");
        }
    }

    private static boolean isBlockedRequestHeader(String name) {
        return "host".equalsIgnoreCase(name)
                || "content-length".equalsIgnoreCase(name)
                || "connection".equalsIgnoreCase(name)
                || "transfer-encoding".equalsIgnoreCase(name);
    }

    private static boolean isAllowedAudioUrl(String value) {
        try {
            URI uri = URI.create(value);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
            if (AUDIO_HOST.equals(uri.getHost())) {
                return uri.getPath() != null && uri.getPath().startsWith("/tts/prod/");
            }
            return WORKER_HOST.equals(uri.getHost())
                    && uri.getPath() != null
                    && uri.getPath().startsWith(WORKER_AUDIO_PREFIX);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void handleMediaCommand(String action, JSONObject command) {
        try {
            lastHeartbeat = SystemClock.elapsedRealtime();
            String session = command.getString("session");
            // A failed session stays failed until JS stops it or chooses another track.
            if (session.equals(mediaSession) && "error".equals(state)) return;

            pendingPositionMs = Math.max(0, command.optInt("positionMs", 0));
            pendingPositionAt = SystemClock.elapsedRealtime();
            pendingVolume = clamp01((float) command.optDouble("volume", 1));
            pendingRate = clampRate((float) command.optDouble("rate", 1));
            shouldPlay = !command.optBoolean("paused", true);
            if (!session.equals(mediaSession) || player == null) {
                mediaSession = session;
                startPlayer(command.getString("url"), pendingPositionMs, pendingVolume, pendingRate, !shouldPlay);
            } else if (prepared) {
                reconcilePlayer();
            }
        } catch (Exception error) {
            lastError = "Ошибка Android MediaPlayer";
            releasePlayer();
            state = "error";
            Log.e(TAG, "Native playback failed: " + error.getClass().getSimpleName());
        }
    }

    /** Apply absolute desired state; never call setPlaybackParams while paused. */
    private void reconcilePlayer() {
        try {
            reconcilePlayerUnsafe();
        } catch (Exception error) {
            lastError = "Не удалось синхронизировать аудио";
            releasePlayer();
            state = "error";
            Log.e(TAG, "Audio synchronization failed: " + error.getClass().getSimpleName());
        }
    }

    private int desiredPositionMs() {
        long elapsed = shouldPlay ? Math.max(0, SystemClock.elapsedRealtime() - pendingPositionAt) : 0;
        return (int) Math.min(Integer.MAX_VALUE, pendingPositionMs + elapsed * (double) pendingRate);
    }

    private void reconcilePlayerUnsafe() {
        if (!prepared || player == null) return;
        if (!foreground || SystemClock.elapsedRealtime() - lastHeartbeat > 1200) shouldPlay = false;
        int desiredPosition = desiredPositionMs();
        player.setVolume(pendingVolume, pendingVolume);
        int duration = player.getDuration();
        if (duration > 0 && desiredPosition >= duration) {
            if (player.isPlaying()) player.pause();
            state = "ended";
            return;
        }
        if (!shouldPlay && player.isPlaying()) player.pause();
        if (seekInFlight) return;
        // MediaPlayer position is coarse on this TV. A 250 ms threshold made
        // normal jitter look like drift and could cause repeated asynchronous seeks.
        if (Math.abs(player.getCurrentPosition() - desiredPosition) > 750) {
            if (player.isPlaying()) player.pause();
            seekInFlight = true;
            requestedSeek = desiredPosition;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                player.seekTo((long) desiredPosition, MediaPlayer.SEEK_CLOSEST);
            } else player.seekTo(desiredPosition);
            return;
        }
        if (shouldPlay) {
            if (Math.abs(appliedRate - pendingRate) > 0.001f) {
                player.setPlaybackParams(player.getPlaybackParams().setSpeed(pendingRate));
                appliedRate = pendingRate;
            }
            if (!player.isPlaying()) player.start();
            state = "playing";
        } else {
            if (player.isPlaying()) player.pause();
            state = "paused";
        }
    }

    private void startPlayer(String url, int positionMs, float volume, float rate, boolean paused)
            throws Exception {
        releasePlayer();
        pendingPositionMs = Math.max(0, positionMs);
        pendingPositionAt = SystemClock.elapsedRealtime();
        pendingVolume = clamp01(volume);
        pendingRate = clampRate(rate);
        shouldPlay = !paused;
        prepared = false;
        lastError = "";
        state = "loading";

        final MediaPlayer created = new MediaPlayer();
        player = created;
        created.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        created.setDataSource(context, Uri.parse(url));
        created.setVolume(pendingVolume, pendingVolume);
        created.setOnSeekCompleteListener(new MediaPlayer.OnSeekCompleteListener() {
            @Override public void onSeekComplete(MediaPlayer mediaPlayer) {
                if (player != mediaPlayer) return;
                try {
                seekInFlight = false;
                // Re-read both position and pause state after an asynchronous seek.
                // A second D-pad seek can supersede the first before this callback.
                reconcilePlayer();
                } catch (Exception error) {
                    lastError = "Ошибка завершения перемотки";
                    releasePlayer();
                    state = "error";
                }
            }
        });
        created.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            @Override
            public void onPrepared(MediaPlayer mediaPlayer) {
                if (player != mediaPlayer) return;
                prepared = true;
                if (!foreground || SystemClock.elapsedRealtime() - lastHeartbeat > 1200) shouldPlay = false;
                reconcilePlayer();
                Log.i(TAG, "Native VOT audio prepared");
            }
        });
        created.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            @Override
            public void onCompletion(MediaPlayer mediaPlayer) {
                if (player == mediaPlayer) state = "ended";
            }
        });
        created.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            @Override
            public boolean onError(MediaPlayer mediaPlayer, int what, int extra) {
                if (player != mediaPlayer) return true;
                lastError = "MediaPlayer error " + what + "/" + extra;
                releasePlayer();
                state = "error";
                Log.e(TAG, lastError);
                return true;
            }
        });
        created.prepareAsync();
    }

    private void releasePlayer() {
        prepared = false;
        shouldPlay = false;
        seekInFlight = false;
        appliedRate = 1.0f;
        if (player != null) {
            try {
                player.release();
            } catch (Exception ignored) {
            }
            player = null;
        }
    }

    private void shutdown() {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                releasePlayer();
            }
        });
        try {
            if (localServer != null) localServer.close();
        } catch (Exception ignored) {
        }
        localServerExecutor.shutdownNow();
        networkExecutor.shutdownNow();
    }

    private String statusResponse() {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("state", state);
            result.put("prepared", prepared);
            result.put("error", lastError);
            return result.toString();
        } catch (Exception error) {
            return "{\"ok\":false}";
        }
    }

    private static String errorResponse(String message) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("status", 599);
            result.put("error", message);
            result.put("bodyBase64", "");
            return result.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"status\":599}";
        }
    }

    private static byte[] readAll(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private static float clamp01(float value) {
        return Math.max(0.0f, Math.min(1.0f, value));
    }

    private static float clampRate(float value) {
        return Math.max(0.25f, Math.min(5.0f, value));
    }
}
