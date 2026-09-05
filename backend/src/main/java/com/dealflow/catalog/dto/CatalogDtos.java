package com.dealflow.catalog.dto;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.repo.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.controller.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Configuration API surface.
 *
 * <p>These are working setup forms, not decoration: changing a price rule, a
 * ceiling or a plan policy changes the next evaluation (test T25). Money
 * arrives as decimal strings in major units and is stored as minor units.
 */
public final class CatalogDtos {

    private CatalogDtos() {
    }

    public record CustomerRequest(
            @NotBlank @Size(max = 200) String name,
            @NotNull String tier,
            @Size(min = 3, max = 3) String currency,
            @Size(max = 200) String contactEmail,
            @Size(max = 40) String contactPhone,
            @Size(max = 500) String billingAddress,
            UUID ownerRepProfileId,
            Boolean active) {
    }

    public record CustomerResponse(UUID id, String name, String tier, String currency, String contactEmail,
                                   String contactPhone, String billingAddress, UUID ownerRepProfileId,
                                   boolean active) {
    }

    public record CategoryRequest(
            @NotBlank @Size(max = 40) String code,
            @NotBlank @Size(max = 120) String name,
            @NotNull String kind,
            Boolean active) {
    }

    public record CategoryResponse(UUID id, String code, String name, String kind, boolean active) {
    }

    public record ProductRequest(
            @NotNull UUID categoryId,
            @NotBlank @Size(max = 60) String code,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 2000) String description,
            @Size(max = 20) String unit,
            @NotNull BigDecimal basePrice,
            @NotNull BigDecimal baseCost,
            @Size(min = 3, max = 3) String currency,
            @Min(0) @Max(10000) Integer taxRateBp,
            @NotNull String fulfillmentKind,
            @NotNull String chargeKind,
            String quantityMode,
            Boolean promoted,
            Boolean active) {
    }

    public record ProductResponse(UUID id, UUID categoryId, String categoryCode, String code, String name,
                                  String description, String unit, BigDecimal basePrice, BigDecimal baseCost,
                                  String currency, int taxRateBp, String fulfillmentKind, String chargeKind,
                                  String quantityMode, boolean promoted, boolean active) {
    }

    public record VariantRequest(
            @NotNull UUID productId,
            @NotBlank @Size(max = 60) String sku,
            @NotBlank @Size(max = 200) String name,
            String attributesJson,
            BigDecimal priceExtra,
            BigDecimal cost,
            @Min(0) Integer weightGrams,
            @Size(max = 60) String substitutionGroup,
            Boolean active) {
    }

    public record VariantResponse(UUID id, UUID productId, String sku, String name, String attributesJson,
                                  BigDecimal priceExtra, BigDecimal cost, int weightGrams,
                                  String substitutionGroup, boolean active) {
    }

    public record PriceRuleRequest(
            @NotNull UUID variantId,
            @NotNull String tier,
            @Size(min = 3, max = 3) String currency,
            @NotNull BigDecimal unitPrice,
            Integer priority,
            @NotNull LocalDate activeFrom,
            LocalDate activeUntil) {
    }

    public record PriceRuleResponse(UUID id, UUID variantId, String tier, String currency, BigDecimal unitPrice,
                                    int priority, LocalDate activeFrom, LocalDate activeUntil) {
    }

    public record PlanRequest(
            @NotNull UUID productId,
            @NotBlank @Size(max = 60) String code,
            @NotBlank @Size(max = 200) String name,
            @NotNull Integer intervalMonths,
            @Size(min = 3, max = 3) String currency,
            @NotNull BigDecimal intervalPrice,
            BigDecimal intervalCost,
            @Min(0) @Max(10000) Integer taxRateBp,
            String billingAnchor,
            String prorationPolicy,
            String cancellationPolicy,
            Boolean active) {
    }

    public record PlanResponse(UUID id, UUID productId, String code, String name, int intervalMonths,
                               String currency, BigDecimal intervalPrice, BigDecimal intervalCost, int taxRateBp,
                               String billingAnchor, String prorationPolicy, String cancellationPolicy,
                               String clawbackPolicy, boolean active) {
    }

    public record WarehouseRequest(
            @NotBlank @Size(max = 40) String code,
            @NotBlank @Size(max = 120) String name,
            @Size(max = 200) String location,
            BigDecimal shippingFixedCost,
            BigDecimal shippingCostPerKg,
            Integer sortOrder,
            Boolean active) {
    }

    public record WarehouseResponse(UUID id, String code, String name, String location,
                                    BigDecimal shippingFixedCost, BigDecimal shippingCostPerKg,
                                    int sortOrder, boolean active) {
    }
}
