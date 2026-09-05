package com.dealflow.catalog.models;


import com.dealflow.catalog.repo.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import com.dealflow.catalog.models.CatalogEnums.ChargeKind;
import com.dealflow.catalog.models.CatalogEnums.FulfillmentKind;
import com.dealflow.catalog.models.CatalogEnums.QuantityMode;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "products")
public class Product extends TimestampedEntity {

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @Column(name = "code", nullable = false, unique = true)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "unit", nullable = false)
    private String unit = "unit";

    @Column(name = "base_price_minor", nullable = false)
    private long basePriceMinor;

    @Column(name = "base_cost_minor", nullable = false)
    private long baseCostMinor;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency = "INR";

    @Column(name = "tax_rate_bp", nullable = false)
    private int taxRateBp;

    @Enumerated(EnumType.STRING)
    @Column(name = "fulfillment_kind", nullable = false)
    private FulfillmentKind fulfillmentKind = FulfillmentKind.STOCK;

    @Enumerated(EnumType.STRING)
    @Column(name = "charge_kind", nullable = false)
    private ChargeKind chargeKind = ChargeKind.ONE_TIME;

    @Enumerated(EnumType.STRING)
    @Column(name = "quantity_mode", nullable = false)
    private QuantityMode quantityMode = QuantityMode.INTEGER;

    /**
     * Promotion flag.
     *
     * <p>This raises a product's rank in the recommendation panel and nothing
     * else. It is never a discount exemption: a promoted item still passes every
     * category ceiling, margin floor and approval rule (edge case E04).
     */
    @Column(name = "promoted", nullable = false)
    private boolean promoted;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    protected Product() {
    }

    public Product(UUID categoryId, String code, String name, long basePriceMinor, long baseCostMinor,
                   FulfillmentKind fulfillmentKind, ChargeKind chargeKind) {
        this.categoryId = categoryId;
        this.code = code;
        this.name = name;
        this.basePriceMinor = basePriceMinor;
        this.baseCostMinor = baseCostMinor;
        this.fulfillmentKind = fulfillmentKind;
        this.chargeKind = chargeKind;
    }

    public boolean requiresStock() {
        return fulfillmentKind == FulfillmentKind.STOCK;
    }

    public boolean isRecurring() {
        return chargeKind == ChargeKind.RECURRING;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(UUID categoryId) {
        this.categoryId = categoryId;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getUnit() {
        return unit;
    }

    public void setUnit(String unit) {
        this.unit = unit;
    }

    public long getBasePriceMinor() {
        return basePriceMinor;
    }

    public void setBasePriceMinor(long basePriceMinor) {
        this.basePriceMinor = basePriceMinor;
    }

    public long getBaseCostMinor() {
        return baseCostMinor;
    }

    public void setBaseCostMinor(long baseCostMinor) {
        this.baseCostMinor = baseCostMinor;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public int getTaxRateBp() {
        return taxRateBp;
    }

    public void setTaxRateBp(int taxRateBp) {
        this.taxRateBp = taxRateBp;
    }

    public FulfillmentKind getFulfillmentKind() {
        return fulfillmentKind;
    }

    public void setFulfillmentKind(FulfillmentKind fulfillmentKind) {
        this.fulfillmentKind = fulfillmentKind;
    }

    public ChargeKind getChargeKind() {
        return chargeKind;
    }

    public void setChargeKind(ChargeKind chargeKind) {
        this.chargeKind = chargeKind;
    }

    public QuantityMode getQuantityMode() {
        return quantityMode;
    }

    public void setQuantityMode(QuantityMode quantityMode) {
        this.quantityMode = quantityMode;
    }

    public boolean isPromoted() {
        return promoted;
    }

    public void setPromoted(boolean promoted) {
        this.promoted = promoted;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
