package com.dealflow.catalog.models;


import com.dealflow.catalog.repo.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A dated price for one variant at one customer tier.
 *
 * <p>Resolution takes the highest {@code priority} rule that is in date. Two
 * in-date rules at the same priority are an ambiguity, and resolution refuses
 * them rather than picking one arbitrarily — a quote must never depend on row
 * order for its price.
 */
@Entity
@Table(name = "price_rules")
public class PriceRule extends TimestampedEntity {

    @Column(name = "variant_id", nullable = false)
    private UUID variantId;

    @Enumerated(EnumType.STRING)
    @Column(name = "tier", nullable = false)
    private CustomerTier tier;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "unit_price_minor", nullable = false)
    private long unitPriceMinor;

    @Column(name = "priority", nullable = false)
    private int priority;

    @Column(name = "active_from", nullable = false)
    private LocalDate activeFrom;

    @Column(name = "active_until")
    private LocalDate activeUntil;

    protected PriceRule() {
    }

    public PriceRule(UUID variantId, CustomerTier tier, String currency, long unitPriceMinor,
                     int priority, LocalDate activeFrom) {
        this.variantId = variantId;
        this.tier = tier;
        this.currency = currency;
        this.unitPriceMinor = unitPriceMinor;
        this.priority = priority;
        this.activeFrom = activeFrom;
    }

    public boolean isActiveOn(LocalDate date) {
        return !date.isBefore(activeFrom) && (activeUntil == null || date.isBefore(activeUntil));
    }

    public UUID getVariantId() {
        return variantId;
    }

    public CustomerTier getTier() {
        return tier;
    }

    public String getCurrency() {
        return currency;
    }

    public long getUnitPriceMinor() {
        return unitPriceMinor;
    }

    public void setUnitPriceMinor(long unitPriceMinor) {
        this.unitPriceMinor = unitPriceMinor;
    }

    public int getPriority() {
        return priority;
    }

    public void setPriority(int priority) {
        this.priority = priority;
    }

    public LocalDate getActiveFrom() {
        return activeFrom;
    }

    public void setActiveFrom(LocalDate activeFrom) {
        this.activeFrom = activeFrom;
    }

    public LocalDate getActiveUntil() {
        return activeUntil;
    }

    public void setActiveUntil(LocalDate activeUntil) {
        this.activeUntil = activeUntil;
    }
}
