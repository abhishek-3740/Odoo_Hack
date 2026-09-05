package com.dealflow.health.models;


import com.dealflow.health.repo.*;
import com.dealflow.health.service.*;
import com.dealflow.health.controller.*;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A durable in-app message for one person.
 *
 * <p>Stored independently of the WebSocket. A frame missed while the browser was
 * asleep is not a lost notification: reconnecting reads this inbox and the user
 * sees what happened. Push is an optimisation, never the record.
 */
@Entity
@Table(name = "notifications")
public class Notification extends BaseEntity {

    @Column(name = "recipient_profile_id", nullable = false, updatable = false)
    private UUID recipientProfileId;

    @Column(name = "notification_type", nullable = false, updatable = false)
    private String notificationType;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "body")
    private String body;

    @Column(name = "quote_id")
    private UUID quoteId;

    @Column(name = "order_id")
    private UUID orderId;

    @Column(name = "invoice_id")
    private UUID invoiceId;

    @Column(name = "alert_id")
    private UUID alertId;

    /** Unique per recipient where present, so one condition yields one message. */
    @Column(name = "dedupe_key")
    private String dedupeKey;

    @Column(name = "read_at")
    private Instant readAt;

    protected Notification() {
    }

    public Notification(UUID recipientProfileId, String notificationType, String title) {
        this.recipientProfileId = recipientProfileId;
        this.notificationType = notificationType;
        this.title = title;
    }

    public void markRead(Instant when) {
        this.readAt = when;
    }

    public UUID getRecipientProfileId() {
        return recipientProfileId;
    }

    public String getNotificationType() {
        return notificationType;
    }

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }

    public void setBody(String body) {
        this.body = body;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public void setQuoteId(UUID quoteId) {
        this.quoteId = quoteId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public void setOrderId(UUID orderId) {
        this.orderId = orderId;
    }

    public UUID getInvoiceId() {
        return invoiceId;
    }

    public void setInvoiceId(UUID invoiceId) {
        this.invoiceId = invoiceId;
    }

    public UUID getAlertId() {
        return alertId;
    }

    public void setAlertId(UUID alertId) {
        this.alertId = alertId;
    }

    public String getDedupeKey() {
        return dedupeKey;
    }

    public void setDedupeKey(String dedupeKey) {
        this.dedupeKey = dedupeKey;
    }

    public Instant getReadAt() {
        return readAt;
    }
}
