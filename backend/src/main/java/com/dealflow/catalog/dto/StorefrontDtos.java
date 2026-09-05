package com.dealflow.catalog.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The public storefront view of the catalogue.
 *
 * <p>Separate types on purpose: there is no field here for cost, margin, stock
 * quantity or warehouse, so the anonymous homepage cannot leak one however the
 * internal DTOs evolve. "In stock" is a yes/no statement, never a count.
 */
public final class StorefrontDtos {

    private StorefrontDtos() {
    }

    public record StoreCategory(UUID id, String code, String name, String kind) {
    }

    public record StoreProduct(UUID id, UUID categoryId, String categoryCode, String categoryKind,
                               String code, String name, String description, String unit,
                               BigDecimal basePrice, String currency, int taxRateBp,
                               String fulfillmentKind, String chargeKind, String quantityMode,
                               boolean promoted) {
    }

    public record StoreVariant(UUID id, UUID productId, String sku, String name, String attributesJson,
                               BigDecimal listPrice, boolean inStock, String substitutionGroup) {
    }

    public record StorePlan(UUID id, UUID productId, String code, String name, int intervalMonths,
                            String currency, BigDecimal intervalPrice, int taxRateBp,
                            String billingAnchor, String prorationPolicy, String cancellationPolicy) {
    }

    public record StorefrontCatalog(List<StoreCategory> categories, List<StoreProduct> products,
                                    List<StoreVariant> variants, List<StorePlan> plans) {
    }
}
