package com.dealflow.auth;

import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Reads the authenticated {@link Actor} out of the security context. */
public final class CurrentActor {

    private CurrentActor() {
    }

    public static Actor require() {
        Actor actor = find();
        if (actor == null) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED);
        }
        return actor;
    }

    public static Actor find() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof ProfileAuthenticationToken token && token.isAuthenticated()) {
            return token.actor();
        }
        return null;
    }
}
