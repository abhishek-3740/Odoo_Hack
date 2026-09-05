package com.dealflow.portal.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Customer account, settings and catalogue-driven quotation requests. */
public final class PortalAccountDtos {

    private PortalAccountDtos() {
    }

    // ------------------------------------------------------------- account

    public record OrganisationView(UUID id, String name, String tier, String currency, String contactEmail,
                                   String contactPhone, String billingAddress) {
    }

    public record ContactView(String name, String email) {
    }

    public record AccountResponse(UUID profileId, String email, String fullName, String phone, String role,
                                  /* LOCAL | DEMO | SUPABASE — which system holds the credential. */
                                  String authProvider,
                                  boolean canChangePassword,
                                  Instant memberSince,
                                  OrganisationView organisation,
                                  ContactView accountManager,
                                  Map<String, Object> preferences) {
    }

    public record AccountUpdateRequest(
            @Size(max = 200) String fullName,
            @Size(max = 40) String phone,
            @Email @Size(max = 200) String contactEmail,
            @Size(max = 40) String contactPhone,
            @Size(max = 500) String billingAddress) {
    }

    public record PreferencesRequest(@NotNull Map<String, Object> preferences) {
    }

    // ------------------------------------------------------ quote requests

    /** One catalogue item the customer wants priced: a variant or a plan, never both. */
    public record QuoteRequestLine(
            UUID variantId,
            UUID planId,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal quantity) {
    }

    public record QuoteRequest(
            @Size(max = 200) String title,
            @Size(max = 2000) String note,
            @NotEmpty @Size(max = 50) List<@Valid QuoteRequestLine> lines) {
    }
}
