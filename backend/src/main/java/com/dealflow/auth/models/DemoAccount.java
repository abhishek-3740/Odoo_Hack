package com.dealflow.auth.models;


import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.controller.*;
import java.util.List;
import java.util.UUID;

/**
 * Metadata and credentials for a DealFlow360 demo persona.
 * Used for Postman API testing and automated integration verification.
 */
public record DemoAccount(
        String email,
        String fullName,
        Role role,
        String description,
        UUID authUserId,
        String teamName,
        String customerName,
        List<String> capabilities,
        String token,
        String curlExample
) {
}
