package com.dealflow.support;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * Mints Supabase-shaped HS256 access tokens for integration tests.
 *
 * <p>The tests exercise the real security chain — signature, issuer, audience,
 * expiry, and the database profile lookup — rather than mocking authentication.
 * The shared secret here matches {@code dealflow.auth.jwt-secret} in the test
 * profile, exactly as the local Supabase stack's fixed secret matches it in
 * development.
 */
public final class TestTokens {

    public static final String SECRET = "integration-test-secret-with-at-least-32-characters!!";
    public static final String ISSUER = "http://test-issuer/auth/v1";

    private TestTokens() {
    }

    public static String forUser(UUID authUserId, String email) {
        return signed(authUserId, email, Instant.now().plusSeconds(3600));
    }

    public static String expiredForUser(UUID authUserId, String email) {
        return signed(authUserId, email, Instant.now().minusSeconds(3600));
    }

    private static String signed(UUID authUserId, String email, Instant expiresAt) {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(authUserId.toString())
                    .issuer(ISSUER)
                    .audience(List.of("authenticated"))
                    .issueTime(Date.from(Instant.now().minusSeconds(5)))
                    .expirationTime(Date.from(expiresAt))
                    .claim("email", email)
                    .claim("role", "authenticated")
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(SECRET.getBytes(StandardCharsets.UTF_8)));
            return jwt.serialize();
        } catch (Exception ex) {
            throw new IllegalStateException("Could not sign test token", ex);
        }
    }
}
