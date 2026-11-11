import { api, type Page } from '../client'
import type {
  AuthOptions,
  AuthToken,
  Delegation,
  DelegationRequest,
  DemoAccount,
  InternalRegisterRequest,
  LoginRequest,
  Me,
  Profile,
  ProfileUpdateRequest,
  ProvisionProfileRequest,
  RegisterRequest,
  Team,
  UUID,
} from '../contracts'

/** Identity, session and people administration. */
export const identity = {
  /** Public. Tells the sign-in page which modes the server actually enables. */
  options: () => api.get<AuthOptions>('/auth/options', { anonymous: true }),

  login: (body: LoginRequest) => api.post<AuthToken>('/auth/login', body, { anonymous: true }),

  register: (body: RegisterRequest) =>
    api.post<AuthToken>('/auth/register', body, { anonymous: true }),

  registerInternal: (body: InternalRegisterRequest) =>
    api.post<AuthToken>('/auth/register-internal', body, { anonymous: true }),

  /** Teams offered on the internal sign-up form. */
  publicTeams: () => api.get<Team[]>('/auth/teams', { anonymous: true }),

  /** Only present when the server has demo authentication switched on. */
  demoAccounts: () => api.get<DemoAccount[]>('/auth/demo-accounts', { anonymous: true }),

  demoToken: (body: { email?: string; role?: string }) =>
    api.post<AuthToken>('/auth/demo-token', body, { anonymous: true }),

  me: () => api.get<Me>('/me'),
}

/** `/admin/*` — administrator-only people and team management. */
export const people = {
  profiles: (
    params: { role?: string; page?: number; pageSize?: number; sort?: string } = {},
    signal?: AbortSignal,
  ) => api.get<Page<Profile>>('/admin/profiles', { query: params, signal }),

  provision: (body: ProvisionProfileRequest) => api.post<Profile>('/admin/profiles', body),

  update: (profileId: UUID, body: ProfileUpdateRequest) =>
    api.patch<Profile>(`/admin/profiles/${profileId}`, body),

  delegations: (signal?: AbortSignal) => api.get<Delegation[]>('/admin/delegations', { signal }),

  delegate: (body: DelegationRequest) => api.post<Delegation>('/admin/delegations', body),

  teams: (signal?: AbortSignal) => api.get<Team[]>('/admin/teams', { signal }),

  createTeam: (name: string) => api.post<Team>('/admin/teams', { name }),
}
