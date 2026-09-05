package com.dealflow.auth.models;


import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.controller.*;
import java.util.Collection;
import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * An authenticated request, carrying the database-resolved {@link Actor}.
 *
 * <p>{@link #getName()} is the profile id, and that is deliberate: it is the
 * same string used as the STOMP user destination, so a private WebSocket event
 * addressed to a profile reaches exactly the session that authenticated as it.
 */
public class ProfileAuthenticationToken extends AbstractAuthenticationToken {

    private final transient Jwt token;
    private final Actor actor;

    public ProfileAuthenticationToken(Jwt token, Actor actor) {
        super(authoritiesFor(actor));
        this.token = token;
        this.actor = actor;
        setAuthenticated(true);
    }

    private static Collection<GrantedAuthority> authoritiesFor(Actor actor) {
        return List.of(new SimpleGrantedAuthority(actor.role().authority()));
    }

    public Actor actor() {
        return actor;
    }

    @Override
    public Object getCredentials() {
        return token;
    }

    @Override
    public Object getPrincipal() {
        return actor;
    }

    @Override
    public String getName() {
        return actor.profileId() == null ? "system" : actor.profileId().toString();
    }
}
