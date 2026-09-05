package com.dealflow.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Request shapes for the public authentication endpoints. */
public final class AuthDtos {

    private AuthDtos() {
    }

    /**
     * Customer self-registration.
     *
     * <p>A signup never chooses a role: every account created here is a portal
     * identity bound to a brand-new customer organisation. Internal roles are
     * still granted only by an administrator.
     */
    public record RegisterRequest(
            @NotBlank @Email @Size(max = 200) String email,
            @NotBlank @Size(min = 8, max = 128) String password,
            @NotBlank @Size(max = 200) String fullName,
            @NotBlank @Size(max = 200) String companyName,
            @Size(max = 40) String phone) {
    }

    public record LoginRequest(
            @NotBlank @Size(max = 200) String email,
            @Size(max = 128) String password) {
    }

    public record ChangePasswordRequest(
            @NotBlank @Size(max = 128) String currentPassword,
            @NotBlank @Size(min = 8, max = 128) String newPassword) {
    }
}
