package com.dealflow.auth;

import com.dealflow.config.AppProperties;
import com.dealflow.shared.error.ErrorCode;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns a verified Supabase token into an authenticated actor.
 *
 * <p>The token proves <em>who</em> signed in. It never decides <em>what they may
 * do</em>: role, team, customer binding and active status are read from
 * {@code dealflow.profiles} on every request. That is what makes a deactivation
 * take effect immediately rather than whenever the access token happens to
 * expire (edge cases E07 and I05). Any {@code role} or {@code customer_id} the
 * client puts in the token's user metadata is ignored outright.
 */
@Component
public class ProfileJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    private static final Logger log = LoggerFactory.getLogger(ProfileJwtAuthenticationConverter.class);

    private final ProfileRepository profiles;
    private final AppProperties properties;

    public ProfileJwtAuthenticationConverter(ProfileRepository profiles, AppProperties properties) {
        this.profiles = profiles;
        this.properties = properties;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AbstractAuthenticationToken convert(Jwt jwt) {
        UUID authUserId = parseSubject(jwt.getSubject());
        Profile profile = profiles.findByAuthUserId(authUserId)
                .orElseGet(() -> provisionOrReject(jwt, authUserId));

        if (!profile.isActive()) {
            throw new ProfileAuthenticationException(ErrorCode.PROFILE_INACTIVE,
                    "This account is deactivated.");
        }
        return new ProfileAuthenticationToken(jwt, profile.toActor());
    }

    /**
     * First sign-in for an unknown subject.
     *
     * <p>Auto-provisioning only ever creates a Sales Rep. A portal identity is
     * bound to a customer by an administrator; nobody self-serves their way into
     * a customer's data, and nobody self-serves an approver role.
     */
    private Profile provisionOrReject(Jwt jwt, UUID authUserId) {
        if (!properties.auth().autoProvisionRep()) {
            throw new ProfileAuthenticationException(ErrorCode.PROFILE_NOT_PROVISIONED,
                    "This account has no workspace profile yet. Ask an administrator to add it.");
        }
        String email = claimAsString(jwt, "email");
        if (email == null || email.isBlank()) {
            throw new ProfileAuthenticationException(ErrorCode.PROFILE_NOT_PROVISIONED,
                    "This account has no email address and cannot be provisioned automatically.");
        }

        // An administrator may have pre-created the profile by email, before the
        // person ever signed in. Claim that row rather than creating a second one.
        Profile existing = profiles.findByEmailIgnoreCase(email).orElse(null);
        if (existing != null) {
            if (existing.getAuthUserId() == null) {
                existing.setAuthUserId(authUserId);
                return profiles.save(existing);
            }
            if (!existing.getAuthUserId().equals(authUserId)) {
                log.warn("Email {} is already bound to a different auth user", email);
                throw new ProfileAuthenticationException(ErrorCode.PROFILE_NOT_PROVISIONED,
                        "This email address is already linked to another account.");
            }
            return existing;
        }

        Profile created = new Profile(authUserId, email, claimAsString(jwt, "full_name"), Role.REP);
        log.info("Provisioned new REP profile for {}", email);
        return profiles.save(created);
    }

    private static UUID parseSubject(String subject) {
        if (subject == null || subject.isBlank()) {
            throw new ProfileAuthenticationException(ErrorCode.UNAUTHENTICATED, "The token has no subject.");
        }
        try {
            return UUID.fromString(subject);
        } catch (IllegalArgumentException ex) {
            throw new ProfileAuthenticationException(ErrorCode.UNAUTHENTICATED, "The token subject is not a user id.");
        }
    }

    private static String claimAsString(Jwt jwt, String claim) {
        Object direct = jwt.getClaim(claim);
        if (direct instanceof String value && !value.isBlank()) {
            return value;
        }
        // Supabase nests profile attributes under user_metadata.
        Object metadata = jwt.getClaim("user_metadata");
        if (metadata instanceof java.util.Map<?, ?> map) {
            Object nested = map.get(claim);
            if (nested instanceof String value && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }
}
