package com.dealflow.auth.dto;

import com.dealflow.auth.models.Role;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** Request shapes for the public authentication endpoints. */
public final class AuthDtos {

    private AuthDtos() {
    }

    /**
     * Customer self-registration.
     */
    public record RegisterRequest(
            @NotBlank @Email @Size(max = 200) String email,
            @NotBlank @Size(min = 8, max = 128) String password,
            @NotBlank @Size(max = 200) String fullName,
            @NotBlank @Size(max = 200) String companyName,
            @Size(max = 40) String phone) {
    }

    /**
     * Enterprise internal staff registration (Admin, Sales Rep, Manager, Finance).
     */
    public record InternalRegisterRequest(
            @NotBlank @Email @Size(max = 200) String email,
            @NotBlank @Size(min = 8, max = 128) String password,
            @NotBlank @Size(max = 200) String fullName,
            @NotNull Role role,
            UUID teamId,
            String teamName,
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
