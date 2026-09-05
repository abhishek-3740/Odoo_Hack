package com.dealflow.shared.error;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A deliberate, expected failure with a stable {@link ErrorCode}.
 *
 * <p>Anything thrown as an {@code ApiException} is a business outcome the API
 * promises to describe precisely. Everything else — a constraint violation, a
 * Hibernate exception, a null — is an internal error and is reported as one,
 * without leaking SQL or a stack trace to the caller.
 */
public class ApiException extends RuntimeException {

    private final ErrorCode code;
    private final Map<String, Object> details;

    public ApiException(ErrorCode code) {
        this(code, code.defaultMessage(), Map.of());
    }

    public ApiException(ErrorCode code, String message) {
        this(code, message, Map.of());
    }

    public ApiException(ErrorCode code, String message, Map<String, Object> details) {
        super(message);
        this.code = code;
        this.details = details == null ? Map.of() : new LinkedHashMap<>(details);
    }

    public static ApiException of(ErrorCode code, String message, Object... keyValuePairs) {
        Map<String, Object> details = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValuePairs.length; i += 2) {
            details.put(String.valueOf(keyValuePairs[i]), keyValuePairs[i + 1]);
        }
        return new ApiException(code, message, details);
    }

    public static ApiException notFound(String what) {
        return new ApiException(ErrorCode.NOT_FOUND, what + " does not exist.");
    }

    public static ApiException forbidden(String message) {
        return new ApiException(ErrorCode.FORBIDDEN, message);
    }

    public ErrorCode code() {
        return code;
    }

    public Map<String, Object> details() {
        return details;
    }
}
