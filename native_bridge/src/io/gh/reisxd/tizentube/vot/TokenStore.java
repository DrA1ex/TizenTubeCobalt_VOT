package io.gh.reisxd.tizentube.vot;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** OAuth stays in app-private storage, encrypted using a non-exportable Android key. */
final class TokenStore {
    private static final String ALIAS = "tizentube-vot-oauth";
    private final Context context;
    TokenStore(Context context) { this.context = context; }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    synchronized void save(String value) throws Exception {
        save(value, Long.MAX_VALUE);
    }
    synchronized void save(String value, long expiresAt) throws Exception {
        value = value.trim().replaceFirst("(?i)^OAuth\\s+", "");
        if (!value.matches("[A-Za-z0-9_\\-\\.]{20,4096}")) throw new IllegalArgumentException(NativeStrings.text("invalidOAuthTokenFormat"));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(cipher.doFinal(value.getBytes("UTF-8")), Base64.NO_WRAP);
        if (!context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).edit().putString("encrypted", encoded).putLong("expiresAt", expiresAt).commit())
            throw new IllegalStateException(NativeStrings.text("couldNotSaveTheToken"));
    }
    synchronized String read() {
        try {
            if (context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).getLong("expiresAt", Long.MAX_VALUE) <= System.currentTimeMillis()) {
                clear(); return "";
            }
            String value = context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).getString("encrypted", "");
            if (value.isEmpty()) return "";
            String[] parts = value.split(":");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.DEFAULT)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.DEFAULT)), "UTF-8");
        } catch (Exception ignored) { return ""; }
    }
    synchronized void clear() {
        context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).edit().remove("encrypted").remove("expiresAt").commit();
    }
}
