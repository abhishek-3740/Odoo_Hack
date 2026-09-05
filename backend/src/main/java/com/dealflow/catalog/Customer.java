package com.dealflow.catalog;

import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "customers")
public class Customer extends TimestampedEntity {

    @Column(name = "name", nullable = false)
    private String name;

    /** Drives the tier ceiling in the discount policy and the price rule lookup. */
    @Enumerated(EnumType.STRING)
    @Column(name = "tier", nullable = false)
    private CustomerTier tier;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency = "INR";

    @Column(name = "contact_email")
    private String contactEmail;

    @Column(name = "contact_phone")
    private String contactPhone;

    @Column(name = "billing_address")
    private String billingAddress;

    @Column(name = "owner_rep_profile_id")
    private UUID ownerRepProfileId;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    protected Customer() {
    }

    public Customer(String name, CustomerTier tier, String currency) {
        this.name = name;
        this.tier = tier;
        this.currency = currency;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public CustomerTier getTier() {
        return tier;
    }

    public void setTier(CustomerTier tier) {
        this.tier = tier;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public String getContactEmail() {
        return contactEmail;
    }

    public void setContactEmail(String contactEmail) {
        this.contactEmail = contactEmail;
    }

    public String getContactPhone() {
        return contactPhone;
    }

    public void setContactPhone(String contactPhone) {
        this.contactPhone = contactPhone;
    }

    public String getBillingAddress() {
        return billingAddress;
    }

    public void setBillingAddress(String billingAddress) {
        this.billingAddress = billingAddress;
    }

    public UUID getOwnerRepProfileId() {
        return ownerRepProfileId;
    }

    public void setOwnerRepProfileId(UUID ownerRepProfileId) {
        this.ownerRepProfileId = ownerRepProfileId;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
