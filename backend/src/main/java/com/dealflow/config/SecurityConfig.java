package com.dealflow.config;

import com.dealflow.auth.models.ProfileAuthenticationException;
import com.dealflow.auth.service.DemoTokenService;
import com.dealflow.auth.service.LocalAuthService;
import com.dealflow.auth.service.ProfileJwtAuthenticationConverter;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.SignedJWT;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.web.ErrorResponse;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Bearer-only HTTP security.
 *
 * <p>The API is stateless and accepts exactly one credential: a Supabase access
 * token in the {@code Authorization} header. It never accepts a Supabase browser
 * cookie as authority and never issues a session, which is why CSRF protection
 * is not applicable here — there is no ambient credential for a cross-site form
 * post to ride on. Introducing cookie authentication later would mean adding
 * CSRF protection back, not inheriting this exemption.
 *
 * <p>WebSocket security is configured separately in {@link WebSocketConfig}:
 * messaging authorisation is a different mechanism from URL authorisation, and
 * permitting the {@code /ws} upgrade here does not authenticate the STOMP
 * session that follows.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final AppProperties properties;
    private final ObjectMapper objectMapper;

    public SecurityConfig(AppProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Bean
    public SecurityFilterChain apiSecurity(HttpSecurity http,
                                           JwtDecoder jwtDecoder,
                                           ProfileJwtAuthenticationConverter jwtConverter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                        // The upgrade is open; the STOMP CONNECT frame that
                        // follows must still present a valid token promptly or
                        // the session is closed.
                        .requestMatchers("/ws/**").permitAll()
                        .requestMatchers("/api/v1/auth/demo-accounts", "/api/v1/auth/demo-token",
                                "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/options")
                        .permitAll()
                        // The storefront homepage: list prices only, no stock counts.
                        .requestMatchers(HttpMethod.GET, "/api/v1/public/**").permitAll()
                        .requestMatchers("/actuator/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth
                        .authenticationEntryPoint(this::writeUnauthenticated)
                        .accessDeniedHandler((request, response, ex) ->
                                write(response, ErrorCode.FORBIDDEN, ErrorCode.FORBIDDEN.defaultMessage()))
                        .jwt(jwt -> jwt.decoder(jwtDecoder).jwtAuthenticationConverter(jwtConverter)))
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(this::writeUnauthenticated)
                        .accessDeniedHandler((request, response, ex) ->
                                write(response, ErrorCode.FORBIDDEN, ErrorCode.FORBIDDEN.defaultMessage())))
                // Private commercial data must not sit in a shared cache.
                .headers(headers -> headers.cacheControl(Customizer.withDefaults()));
        return http.build();
    }

    /**
     * Token verification.
     *
     * <p>Supabase signs either with a shared HS256 secret (the default for the
     * local Docker stack) or with asymmetric keys published as a JWKS (hosted
     * projects using signing keys). Both are supported; configure exactly one.
     * When enabled, demo tokens are verified with a distinct opt-in secret, so
     * they do not weaken or replace Supabase verification.
     * Asymmetric verification is preferred wherever it is available, because it
     * means this service never holds a key capable of minting tokens.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        JwtDecoder supabaseDecoder = supabaseJwtDecoder();
        JwtDecoder demoDecoder = demoJwtDecoder();
        JwtDecoder localDecoder = localJwtDecoder();
        return token -> {
            if (isIssuedBy(token, DemoTokenService.DEMO_ISSUER, "dealflow_demo")) {
                if (demoDecoder == null) {
                    throw new JwtException("Demo authentication is disabled.");
                }
                return demoDecoder.decode(token);
            }
            if (isIssuedBy(token, LocalAuthService.LOCAL_ISSUER, LocalAuthService.LOCAL_CLAIM)) {
                if (localDecoder == null) {
                    throw new JwtException("Email/password authentication is not configured.");
                }
                return localDecoder.decode(token);
            }
            return supabaseDecoder.decode(token);
        };
    }

    /**
     * Storefront signup tokens. Same shape as the demo decoder, but its own
     * issuer, audience and marker claim, and a secret that may differ.
     */
    private JwtDecoder localJwtDecoder() {
        String secret = localAuthSecret();
        if (secret == null) {
            return null;
        }
        SecretKeySpec key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(Duration.ofSeconds(properties.auth().clockSkewSeconds())),
                new JwtIssuerValidator(LocalAuthService.LOCAL_ISSUER),
                audienceValidator(LocalAuthService.LOCAL_AUDIENCE),
                new JwtClaimValidator<Boolean>(LocalAuthService.LOCAL_CLAIM, Boolean.TRUE::equals)));
        return decoder;
    }

    /** Mirrors {@link LocalAuthService#signingSecret()} without needing the bean at config time. */
    private String localAuthSecret() {
        String local = properties.auth().localJwtSecret();
        if (local != null && local.getBytes(StandardCharsets.UTF_8).length >= 32) {
            return local;
        }
        AppProperties.Demo demo = properties.demo();
        String fallback = demo == null ? null : demo.jwtSecret();
        return fallback != null && fallback.getBytes(StandardCharsets.UTF_8).length >= 32 ? fallback : null;
    }

    private JwtDecoder supabaseJwtDecoder() {
        AppProperties.Auth auth = properties.auth();
        boolean hasJwks = auth.jwkSetUri() != null && !auth.jwkSetUri().isBlank();
        boolean hasSecret = auth.jwtSecret() != null && !auth.jwtSecret().isBlank();

        if (hasJwks == hasSecret) {
            throw new IllegalStateException(
                    "Configure exactly one of dealflow.auth.jwk-set-uri (asymmetric) or "
                            + "dealflow.auth.jwt-secret (shared HS256 secret).");
        }

        NimbusJwtDecoder decoder;
        if (hasJwks) {
            decoder = NimbusJwtDecoder.withJwkSetUri(auth.jwkSetUri())
                    .jwsAlgorithms(algorithms -> {
                        algorithms.add(SignatureAlgorithm.RS256);
                        algorithms.add(SignatureAlgorithm.ES256);
                    })
                    .build();
        } else {
            if (auth.jwtSecret().getBytes(StandardCharsets.UTF_8).length < 32) {
                throw new IllegalStateException("dealflow.auth.jwt-secret must be at least 32 bytes for HS256.");
            }
            SecretKeySpec key = new SecretKeySpec(auth.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        }
        decoder.setJwtValidator(tokenValidator(auth));
        return decoder;
    }

    private JwtDecoder demoJwtDecoder() {
        AppProperties.Demo demo = properties.demo();
        if (demo == null || !demo.authEnabled()) {
            return null;
        }
        String secret = demo.jwtSecret();
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("DEMO_JWT_SECRET must be at least 32 bytes when DEMO_AUTH_ENABLED=true.");
        }
        SecretKeySpec key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(Duration.ofSeconds(properties.auth().clockSkewSeconds())),
                new JwtIssuerValidator(DemoTokenService.DEMO_ISSUER),
                audienceValidator(DemoTokenService.DEMO_AUDIENCE),
                new JwtClaimValidator<Boolean>("dealflow_demo", Boolean.TRUE::equals)));
        return decoder;
    }

    /** Routing uses untrusted claims only to select a decoder; validation still happens inside that decoder. */
    private boolean isIssuedBy(String token, String issuer, String markerClaim) {
        try {
            SignedJWT parsed = SignedJWT.parse(token);
            return JWSAlgorithm.HS256.equals(parsed.getHeader().getAlgorithm())
                    && issuer.equals(parsed.getJWTClaimsSet().getIssuer())
                    && Boolean.TRUE.equals(parsed.getJWTClaimsSet().getBooleanClaim(markerClaim));
        } catch (Exception ignored) {
            return false;
        }
    }

    private OAuth2TokenValidator<Jwt> tokenValidator(AppProperties.Auth auth) {
        List<OAuth2TokenValidator<Jwt>> validators = new ArrayList<>();
        validators.add(new JwtTimestampValidator(Duration.ofSeconds(auth.clockSkewSeconds())));
        if (auth.issuerUri() != null && !auth.issuerUri().isBlank()) {
            validators.add(new JwtIssuerValidator(auth.issuerUri()));
        }
        if (auth.requireAudience()) {
            validators.add(audienceValidator(auth.expectedAudience()));
        }
        return new DelegatingOAuth2TokenValidator<>(validators);
    }

    private OAuth2TokenValidator<Jwt> audienceValidator(String expected) {
        return new JwtClaimValidator<Object>(JwtClaimNames.AUD, claim -> switch (claim) {
                case null -> false;
                case String single -> single.equals(expected);
                case List<?> many -> many.contains(expected);
                default -> false;
            });
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        // An explicit origin allow-list. Credentials are not used (bearer only),
        // but the list still limits which sites a browser will let call the API.
        config.setAllowedOrigins(properties.auth().allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key",
                "X-Request-Id", "X-Expected-Version"));
        config.setExposedHeaders(List.of("X-Request-Id"));
        config.setMaxAge(Duration.ofMinutes(30));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    private void writeUnauthenticated(jakarta.servlet.http.HttpServletRequest request,
                                      HttpServletResponse response,
                                      org.springframework.security.core.AuthenticationException ex) {
        if (ex instanceof ProfileAuthenticationException profileException) {
            write(response, profileException.code(), profileException.getMessage());
        } else {
            write(response, ErrorCode.UNAUTHENTICATED, ErrorCode.UNAUTHENTICATED.defaultMessage());
        }
    }

    private void write(HttpServletResponse response, ErrorCode code, String message) {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(code.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Cache-Control", "no-store");
        try {
            objectMapper.writeValue(response.getWriter(), ErrorResponse.of(code.name(), message, Map.of()));
        } catch (Exception ignored) {
            // The connection is gone; there is nowhere left to report this.
        }
    }
}
