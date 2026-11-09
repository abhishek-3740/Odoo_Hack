"""Auth request/response shapes — port of auth/dto/AuthDtos.java,
DemoAuthController.{DemoTokenRequest, AuthTokenResponse}, MeController.MeResponse
and ProfileAdminController.{ProvisionRequest, ProfileUpdateRequest,
DelegationRequest, TeamRequest, ProfileResponse, DelegationResponse}.

Wire names are camelCase (Java records); snake_case attributes use aliases.
Role fields are plain str (parsed/validated in the service).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

_model = ConfigDict(populate_by_name=True, from_attributes=True)


class RegisterRequest(BaseModel):
    model_config = _model
    email: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=200, alias="fullName")
    company_name: str = Field(min_length=1, max_length=200, alias="companyName")
    phone: str | None = Field(default=None, max_length=40)


class InternalRegisterRequest(BaseModel):
    model_config = _model
    email: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=200, alias="fullName")
    role: str
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    team_name: str | None = Field(default=None, alias="teamName")
    phone: str | None = Field(default=None, max_length=40)


class LoginRequest(BaseModel):
    model_config = _model
    email: str = Field(min_length=1, max_length=200)
    password: str | None = Field(default=None, max_length=128)


class DemoTokenRequest(BaseModel):
    model_config = _model
    email: str | None = None
    role: str | None = None
    password: str | None = None


class ProvisionRequest(BaseModel):
    model_config = _model
    email: str = Field(min_length=1, max_length=200)
    full_name: str | None = Field(default=None, max_length=200, alias="fullName")
    role: str
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    customer_id: uuid.UUID | None = Field(default=None, alias="customerId")


class ProfileUpdateRequest(BaseModel):
    model_config = _model
    role: str | None = None
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    customer_id: uuid.UUID | None = Field(default=None, alias="customerId")
    active: bool | None = None
    unavailable_until: datetime | None = Field(default=None, alias="unavailableUntil")
    full_name: str | None = Field(default=None, max_length=200, alias="fullName")


class DelegationRequest(BaseModel):
    model_config = _model
    approver_role: str = Field(alias="approverRole")
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    delegate_profile_id: uuid.UUID = Field(alias="delegateProfileId")
    valid_from: datetime = Field(alias="validFrom")
    valid_until: datetime = Field(alias="validUntil")
    reason: str = Field(min_length=1, max_length=500)


class TeamRequest(BaseModel):
    model_config = _model
    name: str = Field(min_length=1, max_length=120)


class AuthTokenResponse(BaseModel):
    model_config = _model
    email: str
    full_name: str | None = Field(default=None, alias="fullName")
    role: str
    token_type: str = Field(alias="tokenType")
    access_token: str = Field(alias="accessToken")
    expires_in: int = Field(alias="expiresIn")
    capabilities: list[str] = []
    sample_curl: str | None = Field(default=None, alias="sampleCurl")


class MeResponse(BaseModel):
    model_config = _model
    profile_id: uuid.UUID | None = Field(default=None, alias="profileId")
    email: str
    full_name: str | None = Field(default=None, alias="fullName")
    phone: str | None = None
    role: str
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    customer_id: uuid.UUID | None = Field(default=None, alias="customerId")
    customer_name: str | None = Field(default=None, alias="customerName")
    customer_tier: str | None = Field(default=None, alias="customerTier")
    internal: bool = False
    auth_provider: str = Field(alias="authProvider")
    capabilities: list[str] = []


class ProfileResponse(BaseModel):
    model_config = _model
    id: uuid.UUID
    auth_user_id: uuid.UUID | None = Field(default=None, alias="authUserId")
    email: str
    full_name: str | None = Field(default=None, alias="fullName")
    role: str
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    customer_id: uuid.UUID | None = Field(default=None, alias="customerId")
    active: bool = True
    unavailable_until: datetime | None = Field(default=None, alias="unavailableUntil")
    bound: bool = False


class DelegationResponse(BaseModel):
    model_config = _model
    id: uuid.UUID
    approver_role: str = Field(alias="approverRole")
    team_id: uuid.UUID | None = Field(default=None, alias="teamId")
    delegate_profile_id: uuid.UUID = Field(alias="delegateProfileId")
    valid_from: datetime = Field(alias="validFrom")
    valid_until: datetime = Field(alias="validUntil")
    reason: str
    active_now: bool = Field(alias="activeNow")
