package com.dealflow.health.controller;


import com.dealflow.health.models.*;
import com.dealflow.health.repo.*;
import com.dealflow.health.service.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Role;
import com.dealflow.health.models.AlertEnums.AlertStatus;
import com.dealflow.health.models.AlertEnums.AlertType;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.time.BusinessClock;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Deal health alerts, nudges and the durable notification inbox. */
@RestController
@RequestMapping("/api/v1")
public class AlertController {

    private static final Set<String> SORTS = Set.of("lastSeenAt", "firstSeenAt", "severity");

    public record NudgeRequest(@Size(max = 500) String message) {
    }

    public record AlertResponse(UUID id, String alertType, String severity, String status, String title,
                                Object reasons, UUID quoteId, UUID orderId, UUID subscriptionId,
                                UUID invoiceId, UUID variantId, UUID ownerProfileId, Instant firstSeenAt,
                                Instant lastSeenAt, Instant resolvedAt, Instant lastNudgedAt, int nudgeCount) {
    }

    public record NotificationResponse(UUID id, String type, String title, String body, UUID quoteId,
                                       UUID orderId, UUID invoiceId, UUID alertId, Instant readAt,
                                       Instant createdAt) {
    }

    private final AlertRepository alerts;
    private final NotificationRepository notifications;
    private final DealHealthService healthService;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public AlertController(AlertRepository alerts, NotificationRepository notifications,
                           DealHealthService healthService, BusinessClock clock, ObjectMapper objectMapper) {
        this.alerts = alerts;
        this.notifications = notifications;
        this.healthService = healthService;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/alerts")
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<AlertResponse>> alerts(@RequestParam(required = false, defaultValue = "OPEN") String status,
                                                           @RequestParam(required = false) String type,
                                                           @RequestParam(required = false) Integer page,
                                                           @RequestParam(required = false) Integer pageSize,
                                                           @RequestParam(required = false) String sort,
                                                           Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Alerts are internal.");
        }
        AlertStatus statusFilter = "ALL".equalsIgnoreCase(status) ? null
                : AlertStatus.valueOf(status.toUpperCase(java.util.Locale.ROOT));
        AlertType typeFilter = type == null || type.isBlank() ? null
                : AlertType.valueOf(type.toUpperCase(java.util.Locale.ROOT));
        // A rep sees alerts on their own deals; a manager, their team's; others, all.
        UUID owner = actor.role() == Role.REP ? actor.profileId() : null;
        UUID team = actor.role() == Role.MANAGER ? actor.teamId() : null;

        Page<Alert> result = alerts.search(statusFilter, typeFilter, owner, team,
                Paging.of(page, pageSize, sort, SORTS, "lastSeenAt"));
        return ApiResponse.of(PageResponse.of(result, this::toResponse));
    }

    @PostMapping("/alerts/{alertId}/nudges")
    public ApiResponse<NotificationResponse> nudge(@PathVariable UUID alertId,
                                                   @RequestBody(required = false) NudgeRequest request,
                                                   Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Alerts are internal.");
        }
        Notification notification = healthService.nudge(alertId, request == null ? null : request.message(), actor);
        return ApiResponse.of(toResponse(notification));
    }

    /** Runs the health sweep now, for a demo or a manual check. */
    @PostMapping("/alerts/sweeps")
    public ApiResponse<Map<String, Object>> sweep(Actor actor) {
        if (!(actor.role() == Role.MANAGER || actor.role() == Role.FINANCE || actor.isAdmin())) {
            throw ApiException.forbidden("Only managers, finance and administrators can run a sweep.");
        }
        var summary = healthService.sweepAll();
        return ApiResponse.of(Map.of("open", summary.opened(), "resolved", summary.resolved()));
    }

    @GetMapping("/notifications")
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<NotificationResponse>> inbox(@RequestParam(required = false) Integer page,
                                                                 @RequestParam(required = false) Integer pageSize,
                                                                 Actor actor) {
        Page<Notification> result = notifications.findByRecipientProfileIdOrderByCreatedAtDesc(
                actor.profileId(), Paging.of(page, pageSize, null, Set.of("createdAt"), "createdAt"));
        return ApiResponse.of(PageResponse.of(result, this::toResponse),
                Map.of("unread", notifications.countByRecipientProfileIdAndReadAtIsNull(actor.profileId())));
    }

    @PostMapping("/notifications/{notificationId}/reads")
    @Transactional
    public ApiResponse<NotificationResponse> markRead(@PathVariable UUID notificationId, Actor actor) {
        Notification notification = notifications.findById(notificationId)
                .filter(row -> row.getRecipientProfileId().equals(actor.profileId()))
                .orElseThrow(() -> ApiException.notFound("Notification " + notificationId));
        if (notification.getReadAt() == null) {
            notification.markRead(clock.now());
        }
        return ApiResponse.of(toResponse(notification));
    }

    private AlertResponse toResponse(Alert alert) {
        Object reasons;
        try {
            reasons = objectMapper.readValue(alert.getReasons(), List.class);
        } catch (RuntimeException ex) {
            reasons = List.of();
        }
        return new AlertResponse(alert.getId(), alert.getAlertType().name(), alert.getSeverity().name(),
                alert.getStatus().name(), alert.getTitle(), reasons, alert.getQuoteId(), alert.getOrderId(),
                alert.getSubscriptionId(), alert.getInvoiceId(), alert.getVariantId(), alert.getOwnerProfileId(),
                alert.getFirstSeenAt(), alert.getLastSeenAt(), alert.getResolvedAt(), alert.getLastNudgedAt(),
                alert.getNudgeCount());
    }

    private NotificationResponse toResponse(Notification notification) {
        return new NotificationResponse(notification.getId(), notification.getNotificationType(),
                notification.getTitle(), notification.getBody(), notification.getQuoteId(),
                notification.getOrderId(), notification.getInvoiceId(), notification.getAlertId(),
                notification.getReadAt(), notification.getCreatedAt());
    }
}
