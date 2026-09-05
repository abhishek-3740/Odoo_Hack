package com.dealflow.auth.controller;


import com.dealflow.auth.models.*;
import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.catalog.models.Team;
import com.dealflow.catalog.repo.TeamRepository;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * User administration.
 *
 * <p>Roles are granted here and nowhere else. A signup never chooses one, and a
 * token never carries one that is trusted. Mapping a portal identity binds an
 * email to exactly one customer; the person's first verified sign-in then
 * attaches their Supabase user id to the pre-provisioned row.
 */
@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasRole('ADMIN')")
public class ProfileAdminController {

    private static final Set<String> SORTS = Set.of("email", "createdAt", "role");

    public record ProvisionRequest(@NotBlank @Email @Size(max = 200) String email,
                                   @Size(max = 200) String fullName,
                                   @NotNull String role,
                                   UUID teamId,
                                   UUID customerId) {
    }

    public record ProfileUpdateRequest(String role, UUID teamId, UUID customerId, Boolean active,
                                       Instant unavailableUntil, @Size(max = 200) String fullName) {
    }

    public record DelegationRequest(@NotNull String approverRole, UUID teamId,
                                    @NotNull UUID delegateProfileId, @NotNull Instant validFrom,
                                    @NotNull Instant validUntil, @NotBlank @Size(max = 500) String reason) {
    }

    public record TeamRequest(@NotBlank @Size(max = 120) String name) {
    }

    public record ProfileResponse(UUID id, UUID authUserId, String email, String fullName, String role,
                                  UUID teamId, UUID customerId, boolean active, Instant unavailableUntil,
                                  boolean bound) {
    }

    public record DelegationResponse(UUID id, String approverRole, UUID teamId, UUID delegateProfileId,
                                     Instant validFrom, Instant validUntil, String reason, boolean activeNow) {
    }

    private final ProfileRepository profiles;
    private final ApprovalDelegationRepository delegations;
    private final TeamRepository teams;
    private final CustomerRepository customers;
    private final AuditService audit;
    private final BusinessClock clock;

    public ProfileAdminController(ProfileRepository profiles, ApprovalDelegationRepository delegations,
                                  TeamRepository teams, CustomerRepository customers, AuditService audit,
                                  BusinessClock clock) {
        this.profiles = profiles;
        this.delegations = delegations;
        this.teams = teams;
        this.customers = customers;
        this.audit = audit;
        this.clock = clock;
    }

    // ------------------------------------------------------------- profiles

    @GetMapping("/profiles")
    public ApiResponse<PageResponse<ProfileResponse>> profiles(@RequestParam(required = false) String role,
                                                               @RequestParam(required = false) Integer page,
                                                               @RequestParam(required = false) Integer pageSize,
                                                               @RequestParam(required = false) String sort) {
        var pageable = Paging.of(page, pageSize, sort, SORTS, "email");
        var result = role == null || role.isBlank()
                ? profiles.findAll(pageable)
                : profiles.findByRole(parseRole(role), pageable);
        return ApiResponse.of(PageResponse.of(result, ProfileAdminController::toResponse));
    }

    /** Pre-provisions a profile by email, with its role and any customer binding. */
    @PostMapping("/profiles")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<ProfileResponse> provision(@Valid @RequestBody ProvisionRequest request, Actor actor) {
        if (profiles.findByEmailIgnoreCase(request.email()).isPresent()) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "A profile for " + request.email() + " already exists.");
        }
        Role role = parseRole(request.role());
        validateBinding(role, request.customerId(), request.teamId());

        Profile profile = new Profile(null, request.email().trim().toLowerCase(java.util.Locale.ROOT),
                request.fullName(), role);
        profile.setTeamId(request.teamId());
        profile.setCustomerId(request.customerId());
        profiles.save(profile);

        audit.record(actor, "PROFILE_PROVISIONED", "Profile", profile.getId())
                .after(Map.of("email", profile.getEmail(), "role", role.name(),
                        "customerId", String.valueOf(request.customerId()))).save();
        return ApiResponse.of(toResponse(profile));
    }

    @PatchMapping("/profiles/{profileId}")
    @Transactional
    public ApiResponse<ProfileResponse> update(@PathVariable UUID profileId,
                                               @RequestBody ProfileUpdateRequest request, Actor actor) {
        Profile profile = profiles.findById(profileId)
                .orElseThrow(() -> ApiException.notFound("Profile " + profileId));
        String roleBefore = profile.getRole().name();

        Role role = request.role() == null ? profile.getRole() : parseRole(request.role());
        UUID customerId = request.customerId() != null ? request.customerId()
                : role == Role.CUSTOMER ? profile.getCustomerId() : null;
        UUID teamId = request.teamId() != null ? request.teamId() : profile.getTeamId();
        validateBinding(role, customerId, teamId);

        if (profile.getId().equals(actor.profileId()) && (role != Role.ADMIN
                || (request.active() != null && !request.active()))) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "An administrator cannot demote or deactivate their own account.");
        }

        profile.setRole(role);
        profile.setCustomerId(role == Role.CUSTOMER ? customerId : null);
        profile.setTeamId(role == Role.CUSTOMER ? null : teamId);
        if (request.active() != null) {
            profile.setActive(request.active());
        }
        if (request.fullName() != null) {
            profile.setFullName(request.fullName());
        }
        profile.setUnavailableUntil(request.unavailableUntil());

        audit.record(actor, "PROFILE_UPDATED", "Profile", profile.getId())
                .before(Map.of("role", roleBefore))
                .after(Map.of("role", profile.getRole().name(), "active", profile.isActive(),
                        "unavailableUntil", String.valueOf(profile.getUnavailableUntil()))).save();
        return ApiResponse.of(toResponse(profile));
    }

    // ---------------------------------------------------------- delegations

    @GetMapping("/delegations")
    public ApiResponse<List<DelegationResponse>> delegations() {
        Instant now = clock.now();
        return ApiResponse.of(delegations.findAll().stream()
                .map(delegation -> toResponse(delegation, now)).toList());
    }

    /** A dated, role-qualified stand-in. Never confers a role the delegate does not hold. */
    @PostMapping("/delegations")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<DelegationResponse> delegate(@Valid @RequestBody DelegationRequest request, Actor actor) {
        Role role = parseRole(request.approverRole());
        if (!role.isApprover()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "approverRole must be MANAGER or FINANCE.");
        }
        Profile delegate = profiles.findById(request.delegateProfileId())
                .orElseThrow(() -> ApiException.notFound("Profile " + request.delegateProfileId()));
        if (delegate.getRole() != role) {
            throw new ApiException(ErrorCode.APPROVER_NOT_QUALIFIED,
                    "A delegate must already hold the " + role.name().toLowerCase() + " role.");
        }
        if (!request.validUntil().isAfter(request.validFrom())) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "validUntil must be after validFrom.");
        }
        ApprovalDelegation delegation = delegations.save(new ApprovalDelegation(role, request.teamId(),
                delegate.getId(), request.validFrom(), request.validUntil(), request.reason(), actor.profileId()));
        audit.record(actor, "DELEGATION_CREATED", "ApprovalDelegation", delegation.getId())
                .after(Map.of("role", role.name(), "delegate", delegate.getEmail()))
                .reason(request.reason()).save();
        return ApiResponse.of(toResponse(delegation, clock.now()));
    }

    // ---------------------------------------------------------------- teams

    @GetMapping("/teams")
    public ApiResponse<List<Map<String, Object>>> teams() {
        return ApiResponse.of(teams.findAll().stream()
                .map(team -> Map.<String, Object>of("id", team.getId(), "name", team.getName())).toList());
    }

    @PostMapping("/teams")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<Map<String, Object>> createTeam(@Valid @RequestBody TeamRequest request, Actor actor) {
        if (teams.findByName(request.name()).isPresent()) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE, "That team already exists.");
        }
        Team team = teams.save(new Team(request.name()));
        audit.record(actor, "TEAM_CREATED", "Team", team.getId()).after(Map.of("name", team.getName())).save();
        return ApiResponse.of(Map.of("id", team.getId(), "name", team.getName()));
    }

    // -------------------------------------------------------------- helpers

    private void validateBinding(Role role, UUID customerId, UUID teamId) {
        if (role == Role.CUSTOMER) {
            if (customerId == null) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED, "A customer profile needs a customerId.");
            }
            customers.findById(customerId).orElseThrow(() -> ApiException.notFound("Customer " + customerId));
        } else if (customerId != null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "Only a CUSTOMER profile may be bound to a customer.");
        }
        if (teamId != null) {
            teams.findById(teamId).orElseThrow(() -> ApiException.notFound("Team " + teamId));
        }
    }

    private static Role parseRole(String value) {
        try {
            return Role.valueOf(value.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException | NullPointerException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unknown role \"" + value + "\".");
        }
    }

    private static ProfileResponse toResponse(Profile profile) {
        return new ProfileResponse(profile.getId(), profile.getAuthUserId(), profile.getEmail(),
                profile.getFullName(), profile.getRole().name(), profile.getTeamId(), profile.getCustomerId(),
                profile.isActive(), profile.getUnavailableUntil(), profile.getAuthUserId() != null);
    }

    private static DelegationResponse toResponse(ApprovalDelegation delegation, Instant now) {
        return new DelegationResponse(delegation.getId(), delegation.getApproverRole().name(),
                delegation.getTeamId(), delegation.getDelegateProfileId(), delegation.getValidFrom(),
                delegation.getValidUntil(), delegation.getReason(), delegation.isValidAt(now));
    }
}
