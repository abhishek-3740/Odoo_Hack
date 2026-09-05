package com.dealflow.shared.error;

import com.dealflow.shared.web.ErrorResponse;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Turns every failure into the documented error envelope.
 *
 * <p>The important half of this class is what it refuses to do: a SQL message, a
 * Hibernate constraint name or a stack trace never reaches the client. Unmapped
 * failures are logged in full server-side and reported as a bare
 * {@code INTERNAL_ERROR} with the request id, which is enough to find the log
 * line and nothing more.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> handleApi(ApiException ex) {
        if (ex.code().status().is5xxServerError()) {
            log.error("API error {}: {}", ex.code(), ex.getMessage(), ex);
        } else {
            log.debug("API error {}: {}", ex.code(), ex.getMessage());
        }
        return build(ex.code(), ex.getMessage(), ex.details());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleBeanValidation(MethodArgumentNotValidException ex) {
        Map<String, Object> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(error -> fields.putIfAbsent(error.getField(), error.getDefaultMessage()));
        ex.getBindingResult().getGlobalErrors()
                .forEach(error -> fields.putIfAbsent(error.getObjectName(), error.getDefaultMessage()));
        return build(ErrorCode.VALIDATION_FAILED, "Some fields need attention.", Map.of("fields", fields));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolation(ConstraintViolationException ex) {
        Map<String, Object> fields = new LinkedHashMap<>();
        ex.getConstraintViolations()
                .forEach(v -> fields.putIfAbsent(v.getPropertyPath().toString(), v.getMessage()));
        return build(ErrorCode.VALIDATION_FAILED, "Some fields need attention.", Map.of("fields", fields));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException ex) {
        log.debug("Unreadable request body", ex);
        return build(ErrorCode.MALFORMED_REQUEST, ErrorCode.MALFORMED_REQUEST.defaultMessage(), Map.of());
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingRequestHeaderException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ErrorResponse> handleBadRequest(Exception ex) {
        return build(ErrorCode.VALIDATION_FAILED, ex.getMessage(), Map.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNoResource(NoResourceFoundException ex) {
        return build(ErrorCode.NOT_FOUND, ErrorCode.NOT_FOUND.defaultMessage(), Map.of());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDenied(AccessDeniedException ex) {
        return build(ErrorCode.FORBIDDEN, ErrorCode.FORBIDDEN.defaultMessage(), Map.of());
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ErrorResponse> handleAuthentication(AuthenticationException ex) {
        return build(ErrorCode.UNAUTHENTICATED, ErrorCode.UNAUTHENTICATED.defaultMessage(), Map.of());
    }

    /**
     * Optimistic lock loss is a normal outcome, not a defect: two people edited
     * the same quotation and the second one needs to refresh.
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLock(OptimisticLockingFailureException ex) {
        log.debug("Optimistic lock conflict", ex);
        return build(ErrorCode.STALE_VERSION, ErrorCode.STALE_VERSION.defaultMessage(), Map.of());
    }

    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handlePessimisticLock(PessimisticLockingFailureException ex) {
        log.warn("Lock acquisition failed", ex);
        return build(ErrorCode.CONFLICTING_STATE,
                "The record is busy. Try again in a moment.", Map.of());
    }

    /**
     * A unique or check constraint fired. That is the database refusing to
     * record something the service layer should have caught, so it is logged at
     * WARN with the constraint name — but the caller only learns that the state
     * conflicted.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleIntegrity(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", rootMessage(ex));
        return build(ErrorCode.CONFLICTING_STATE, ErrorCode.CONFLICTING_STATE.defaultMessage(), Map.of());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unhandled failure", ex);
        return build(ErrorCode.INTERNAL_ERROR, ErrorCode.INTERNAL_ERROR.defaultMessage(), Map.of());
    }

    private static ResponseEntity<ErrorResponse> build(ErrorCode code, String message, Map<String, Object> details) {
        HttpStatus status = code.status();
        String safeMessage = (message == null || message.isBlank()) ? code.defaultMessage() : message;
        return ResponseEntity.status(status)
                .header("Cache-Control", "no-store")
                .body(ErrorResponse.of(code.name(), safeMessage, details));
    }

    private static String rootMessage(Throwable ex) {
        Throwable cursor = ex;
        while (cursor.getCause() != null && cursor.getCause() != cursor) {
            cursor = cursor.getCause();
        }
        return cursor.getMessage();
    }
}
