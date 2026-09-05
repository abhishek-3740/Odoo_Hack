package com.dealflow.auth;

import com.dealflow.shared.error.ErrorCode;
import org.springframework.security.core.AuthenticationException;

/**
 * The token verified, but the account behind it cannot act: it has no workspace
 * profile yet, or it has been deactivated. Distinct from an authentication
 * failure so the response can be a truthful 403 rather than a misleading 401.
 */
public class ProfileAuthenticationException extends AuthenticationException {

    private final ErrorCode code;

    public ProfileAuthenticationException(ErrorCode code, String message) {
        super(message);
        this.code = code;
    }

    public ErrorCode code() {
        return code;
    }
}
