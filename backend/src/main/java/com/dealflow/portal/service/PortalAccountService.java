package com.dealflow.portal.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.auth.service.DemoTokenService;
import com.dealflow.auth.service.LocalAuthService;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.portal.dto.PortalAccountDtos.AccountResponse;
import com.dealflow.portal.dto.PortalAccountDtos.AccountUpdateRequest;
import com.dealflow.portal.dto.PortalAccountDtos.ContactView;
import com.dealflow.portal.dto.PortalAccountDtos.OrganisationView;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * A customer's own account: contact details, organisation record and UI
 * preferences. Bound to the caller's profile and customer; nothing here takes
 * an id from the request.
 */
@Service
public class PortalAccountService {

    /** The preference keys the portal understands. Anything else is dropped, not stored. */
    private static final Set<String> PREFERENCE_KEYS = Set.of(
            "emailNotifications", "dealUpdates", "invoiceReminders", "marketingUpdates",
            "compactTables", "defaultLanding", "showPricesWithTax");

    private final ProfileRepository profiles;
    private final CustomerRepository customers;
    private final LocalAuthService localAuth;
    private final DemoTokenService demoTokens;
    private final AuditService audit;
    private final ObjectMapper objectMapper;

    public PortalAccountService(ProfileRepository profiles, CustomerRepository customers,
                                LocalAuthService localAuth, DemoTokenService demoTokens,
                                AuditService audit, ObjectMapper objectMapper) {
        this.profiles = profiles;
        this.customers = customers;
        this.localAuth = localAuth;
        this.demoTokens = demoTokens;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public AccountResponse get(Actor actor) {
        Profile profile = loadProfile(actor);
        return toResponse(profile);
    }

    @Transactional
    public AccountResponse update(Actor actor, AccountUpdateRequest request) {
        Profile profile = loadProfile(actor);
        Customer customer = loadCustomer(profile);
        Map<String, Object> before = Map.of("fullName", String.valueOf(profile.getFullName()),
                "phone", String.valueOf(profile.getPhone()),
                "billingAddress", String.valueOf(customer.getBillingAddress()));

        if (request.fullName() != null) {
            profile.setFullName(trimToNull(request.fullName()));
        }
        if (request.phone() != null) {
            profile.setPhone(trimToNull(request.phone()));
        }
        if (request.contactEmail() != null) {
            customer.setContactEmail(trimToNull(request.contactEmail()));
        }
        if (request.contactPhone() != null) {
            customer.setContactPhone(trimToNull(request.contactPhone()));
        }
        if (request.billingAddress() != null) {
            customer.setBillingAddress(trimToNull(request.billingAddress()));
        }

        audit.record(actor, "PORTAL_ACCOUNT_UPDATED", "Profile", profile.getId())
                .before(before)
                .after(Map.of("fullName", String.valueOf(profile.getFullName()),
                        "phone", String.valueOf(profile.getPhone()),
                        "billingAddress", String.valueOf(customer.getBillingAddress())))
                .save();
        return toResponse(profile);
    }

    @Transactional
    public AccountResponse updatePreferences(Actor actor, Map<String, Object> preferences) {
        Profile profile = loadProfile(actor);
        Map<String, Object> accepted = new LinkedHashMap<>(readPreferences(profile));
        for (Map.Entry<String, Object> entry : preferences.entrySet()) {
            if (!PREFERENCE_KEYS.contains(entry.getKey())) {
                continue;
            }
            Object value = entry.getValue();
            if (value instanceof Boolean || value instanceof Number
                    || (value instanceof String text && text.length() <= 100)) {
                accepted.put(entry.getKey(), value);
            } else {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "Preference \"" + entry.getKey() + "\" must be a boolean, number or short text.");
            }
        }
        profile.setPreferences(objectMapper.writeValueAsString(accepted));
        return toResponse(profile);
    }

    public void changePassword(Actor actor, String currentPassword, String newPassword) {
        localAuth.changePassword(actor, currentPassword, newPassword);
    }

    // -------------------------------------------------------------- helpers

    private Profile loadProfile(Actor actor) {
        if (!actor.isCustomer() || actor.customerId() == null) {
            throw ApiException.forbidden("This area is for customer accounts.");
        }
        return profiles.findById(actor.profileId())
                .orElseThrow(() -> ApiException.notFound("Your profile"));
    }

    private Customer loadCustomer(Profile profile) {
        return customers.findById(profile.getCustomerId())
                .orElseThrow(() -> ApiException.notFound("Your organisation"));
    }

    private AccountResponse toResponse(Profile profile) {
        Customer customer = loadCustomer(profile);
        ContactView manager = null;
        if (customer.getOwnerRepProfileId() != null) {
            manager = profiles.findById(customer.getOwnerRepProfileId())
                    .map(rep -> new ContactView(rep.getFullName() != null ? rep.getFullName() : rep.getEmail(),
                            rep.getEmail()))
                    .orElse(null);
        }
        String provider = localAuth.hasLocalCredential(profile) ? "LOCAL"
                : demoTokens.isDemoPersona(profile.getEmail()) ? "DEMO" : "SUPABASE";
        return new AccountResponse(profile.getId(), profile.getEmail(), profile.getFullName(),
                profile.getPhone(), profile.getRole().name(), provider,
                localAuth.hasLocalCredential(profile), profile.getCreatedAt(),
                new OrganisationView(customer.getId(), customer.getName(), customer.getTier().name(),
                        customer.getCurrency(), customer.getContactEmail(), customer.getContactPhone(),
                        customer.getBillingAddress()),
                manager, readPreferences(profile));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readPreferences(Profile profile) {
        String json = profile.getPreferences();
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (RuntimeException ex) {
            return Map.of();
        }
    }

    private static String trimToNull(String value) {
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
