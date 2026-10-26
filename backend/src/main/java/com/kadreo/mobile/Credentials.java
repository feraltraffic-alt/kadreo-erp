package com.kadreo.mobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Kiosk PINs (PBKDF2-SHA256, only the hash is stored) and server signatures for short-lived
 * tokens: kiosk tickets, the worker's rotating kiosk QR and the QR codes of site points.
 */
@Component
class Credentials {

    private static final int ITERATIONS = 10_000;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final byte[] key;

    Credentials(@Value("${kadreo.mobile.signing-secret:kadreo-mobile-dev-secret-change-me}") String secret) {
        this.key = secret.getBytes(StandardCharsets.UTF_8);
    }

    static String hashPin(String pin) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return "pbkdf2-sha256$" + ITERATIONS + "$" + Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(pbkdf2(pin, salt, ITERATIONS));
    }

    static boolean verifyPin(String pin, String stored) {
        if (pin == null || stored == null) return false;
        String[] p = stored.split("\\$");
        if (p.length != 4 || !"pbkdf2-sha256".equals(p[0])) return false;
        byte[] expected = Base64.getDecoder().decode(p[3]);
        byte[] actual = pbkdf2(pin, Base64.getDecoder().decode(p[2]), Integer.parseInt(p[1]));
        return MessageDigest.isEqual(expected, actual);
    }

    private static byte[] pbkdf2(String pin, byte[] salt, int iterations) {
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(pin.toCharArray(), salt, iterations, 256)).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** {@code payload.signature}, URL-safe. */
    String sign(String payload) {
        return payload + "." + mac(payload);
    }

    /** The payload if the signature matches, else null. */
    String verify(String token) {
        if (token == null) return null;
        int dot = token.lastIndexOf('.');
        if (dot <= 0) return null;
        String payload = token.substring(0, dot);
        return MessageDigest.isEqual(mac(payload).getBytes(StandardCharsets.UTF_8), token.substring(dot + 1).getBytes(StandardCharsets.UTF_8)) ? payload : null;
    }

    private String mac(String payload) {
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec(key, "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(m.doFinal(payload.getBytes(StandardCharsets.UTF_8))).substring(0, 22);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
