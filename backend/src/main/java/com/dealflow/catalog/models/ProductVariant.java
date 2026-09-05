package com.dealflow.catalog.models;


import com.dealflow.catalog.repo.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "product_variants")
public class ProductVariant extends TimestampedEntity {

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "sku", nullable = false, unique = true)
    private String sku;

    @Column(name = "name", nullable = false)
    private String name;

    /** Free-form attributes (colour, size, RAM) kept as raw JSON text. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "attributes", nullable = false)
    private String attributes = "{}";

    /** Added to the product base price when no tier rule matches. */
    @Column(name = "price_extra_minor", nullable = false)
    private long priceExtraMinor;

    /** Null means "inherit the product base cost". */
    @Column(name = "cost_minor")
    private Long costMinor;

    @Column(name = "weight_grams", nullable = false)
    private int weightGrams;

    /**
     * Explicit equivalence set for upsell and substitution.
     *
     * <p>Only variants sharing a group may be offered as replacements. Generic
     * co-purchase statistics are allowed to ADD a complementary item and are
     * never allowed to swap one product for another (section 7.3).
     */
    @Column(name = "substitution_group")
    private String substitutionGroup;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    protected ProductVariant() {
    }

    public ProductVariant(UUID productId, String sku, String name) {
        this.productId = productId;
        this.sku = sku;
        this.name = name;
    }

    /** Effective unit cost, falling back to the product's base cost. */
    public long resolveCostMinor(Product product) {
        return costMinor != null ? costMinor : product.getBaseCostMinor();
    }

    /** Default list price when no tier price rule applies. */
    public long resolveDefaultPriceMinor(Product product) {
        return product.getBasePriceMinor() + priceExtraMinor;
    }

    public UUID getProductId() {
        return productId;
    }

    public void setProductId(UUID productId) {
        this.productId = productId;
    }

    public String getSku() {
        return sku;
    }

    public void setSku(String sku) {
        this.sku = sku;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getAttributes() {
        return attributes;
    }

    public void setAttributes(String attributes) {
        this.attributes = attributes;
    }

    public long getPriceExtraMinor() {
        return priceExtraMinor;
    }

    public void setPriceExtraMinor(long priceExtraMinor) {
        this.priceExtraMinor = priceExtraMinor;
    }

    public Long getCostMinor() {
        return costMinor;
    }

    public void setCostMinor(Long costMinor) {
        this.costMinor = costMinor;
    }

    public int getWeightGrams() {
        return weightGrams;
    }

    public void setWeightGrams(int weightGrams) {
        this.weightGrams = weightGrams;
    }

    public String getSubstitutionGroup() {
        return substitutionGroup;
    }

    public void setSubstitutionGroup(String substitutionGroup) {
        this.substitutionGroup = substitutionGroup;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
