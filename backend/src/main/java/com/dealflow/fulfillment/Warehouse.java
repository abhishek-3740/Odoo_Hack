package com.dealflow.fulfillment;

import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

@Entity
@Table(name = "warehouses")
public class Warehouse extends TimestampedEntity {

    @Column(name = "code", nullable = false, unique = true)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "location")
    private String location;

    /** Configured shipping estimate, not a live courier quote. Labelled as such in the UI. */
    @Column(name = "shipping_fixed_cost_minor", nullable = false)
    private long shippingFixedCostMinor;

    @Column(name = "shipping_cost_per_kg_minor", nullable = false)
    private long shippingCostPerKgMinor;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    protected Warehouse() {
    }

    public Warehouse(String code, String name, long shippingFixedCostMinor, int sortOrder) {
        this.code = code;
        this.name = name;
        this.shippingFixedCostMinor = shippingFixedCostMinor;
        this.sortOrder = sortOrder;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getLocation() {
        return location;
    }

    public void setLocation(String location) {
        this.location = location;
    }

    public long getShippingFixedCostMinor() {
        return shippingFixedCostMinor;
    }

    public void setShippingFixedCostMinor(long shippingFixedCostMinor) {
        this.shippingFixedCostMinor = shippingFixedCostMinor;
    }

    public long getShippingCostPerKgMinor() {
        return shippingCostPerKgMinor;
    }

    public void setShippingCostPerKgMinor(long shippingCostPerKgMinor) {
        this.shippingCostPerKgMinor = shippingCostPerKgMinor;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
