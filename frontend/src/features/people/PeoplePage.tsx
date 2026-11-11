import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { keys, people, ROLE_LABEL, type Profile, type Role } from '@/api'
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  Input,
  Panel,
  PageHeader,
  Pagination,
  RefreshingHint,
  Section,
  Select,
  TabPanel,
  Tabs,
  Textarea,
  useDisclosure,
} from '@/design-system'
import { formatTimestamp, isPast } from '@/lib/dates'

const ROLES: Role[] = ['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']

/**
 * People, teams and delegations.
 *
 * Profiles are pre-provisioned by email and bound to a real identity when
 * someone first signs in — so a profile can exist and be usable in routing
 * before its owner has ever logged in. The list shows that state rather than
 * hiding it, because an unbound approver is a real cause of a stuck queue.
 *
 * There is no delete operation on this API, and none is invented here.
 * Deactivating is the supported way to take someone out of routing.
 */
export default function PeoplePage() {
  const [tab, setTab] = useState('people')

  return (
    <>
      <PageHeader
        title="People"
        description="Profiles, teams and time-boxed approval delegations. A team decides whose quotations and approvals a rep or manager sees."
      />

      <Tabs
        label="Administration sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'people', label: 'Profiles' },
          { value: 'teams', label: 'Teams' },
          { value: 'delegations', label: 'Delegations' },
        ]}
      >
        <TabPanel value="people">
          <ProfilesSection />
        </TabPanel>
        <TabPanel value="teams">
          <TeamsSection />
        </TabPanel>
        <TabPanel value="delegations">
          <DelegationsSection />
        </TabPanel>
      </Tabs>
    </>
  )
}

/* ---------------------------------------------------------------- profiles */

function ProfilesSection() {
  const [role, setRole] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Profile | null>(null)
  const provision = useDisclosure()

  const query = { role: role || undefined, page, pageSize: 25 }
  const profiles = useQuery({
    queryKey: keys.profiles(query),
    queryFn: ({ signal }) => people.profiles(query, signal),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-52 space-y-1.5">
          <label htmlFor="profile-role" className="block text-[13px] font-medium text-text">
            Role
          </label>
          <Select
            id="profile-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value)
              setPage(0)
            }}
          >
            <option value="">Every role</option>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <RefreshingHint visible={profiles.isFetching && !profiles.isLoading} />
          <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={provision.show}>
            Provision a profile
          </Button>
        </div>
      </div>

      <DataTable
        caption="Workspace profiles"
        rows={profiles.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={profiles.isLoading}
        error={profiles.error ? <InlineError error={profiles.error} /> : undefined}
        empty={<EmptyState icon={<Users className="size-5" aria-hidden />} title="No profiles" />}
        onRowClick={setEditing}
        columns={[
          {
            id: 'name',
            header: 'Person',
            cell: (row) => (
              <span>
                <span className="block font-medium text-text">{row.fullName ?? '—'}</span>
                <span className="block truncate text-2xs text-text-muted">{row.email}</span>
              </span>
            ),
          },
          {
            id: 'role',
            header: 'Role',
            cell: (row) => (
              <Badge tone="neutral" size="sm">
                {ROLE_LABEL[row.role] ?? row.role}
              </Badge>
            ),
          },
          {
            id: 'bound',
            header: 'Identity',
            hideBelow: 'md',
            cell: (row) =>
              row.bound ? (
                <Badge tone="ok" size="sm">
                  Signed in before
                </Badge>
              ) : (
                <Badge tone="wait" size="sm">
                  Never signed in
                </Badge>
              ),
          },
          {
            id: 'availability',
            header: 'Availability',
            cell: (row) =>
              !row.active ? (
                <Badge tone="stop" size="sm">
                  Deactivated
                </Badge>
              ) : row.unavailableUntil && !isPast(row.unavailableUntil) ? (
                <Badge tone="wait" size="sm">
                  Away until {formatTimestamp(row.unavailableUntil)}
                </Badge>
              ) : (
                <Badge tone="ok" size="sm">
                  Available
                </Badge>
              ),
          },
        ]}
      />

      {profiles.data ? (
        <Pagination
          page={profiles.data.page}
          pageSize={profiles.data.pageSize}
          totalItems={profiles.data.totalItems}
          totalPages={profiles.data.totalPages}
          busy={profiles.isFetching}
          onPageChange={setPage}
        />
      ) : null}

      <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
        A profile that has never signed in still takes part in approval routing. If a queue is stuck
        with "no available approver", an unbound or deactivated profile is usually why.
      </Panel>

      <ProvisionDialog open={provision.open} onOpenChange={provision.setOpen} />
      <EditProfileDialog profile={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function ProvisionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('REP')
  const [teamId, setTeamId] = useState('')

  const teams = useQuery({
    queryKey: keys.teams(),
    queryFn: ({ signal }) => people.teams(signal),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () =>
      people.provision({
        email: email.trim(),
        fullName: fullName.trim() || null,
        role,
        teamId: teamId || null,
      }),
    onSuccess: () => {
      toast.success('Profile provisioned', {
        description: 'It is usable for routing now; it binds to a real identity on first sign-in.',
      })
      onOpenChange(false)
      setEmail('')
      setFullName('')
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'profiles'] })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Provision a profile"
      description="Creates a workspace profile for an email address. The person claims it the first time they sign in."
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            disabled={!email.trim()}
            disabledReason="An email address is required."
            onClick={() => create.mutate()}
          >
            Provision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Email" required>
          {(props) => (
            <Input {...props} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Full name">
          {(props) => <Input {...props} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" required>
            {(props) => (
              <Select {...props} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.filter((value) => value !== 'CUSTOMER').map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Team" hint="Scope for a rep or a manager.">
            {(props) => (
              <Select {...props} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">No team</option>
                {(teams.data ?? []).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {create.error ? <InlineError error={create.error} /> : null}
      </div>
    </Dialog>
  )
}

function EditProfileDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role | ''>('')
  const [active, setActive] = useState<string>('')
  const [unavailableUntil, setUnavailableUntil] = useState('')

  const save = useMutation({
    mutationFn: () =>
      people.update(profile!.id, {
        role: role || null,
        active: active === '' ? null : active === 'true',
        unavailableUntil: unavailableUntil ? new Date(unavailableUntil).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Profile updated')
      onClose()
      void queryClient.invalidateQueries({ queryKey: [...keys.all(), 'profiles'] })
    },
  })

  return (
    <Dialog
      open={profile !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={profile ? (profile.fullName ?? profile.email) : 'Profile'}
      description="Role, availability and whether this profile takes part in routing."
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </>
      }
    >
      {profile ? (
        <div className="space-y-4">
          <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] text-text-secondary">
            {profile.email} · currently {ROLE_LABEL[profile.role] ?? profile.role} ·{' '}
            {profile.bound ? 'has signed in' : 'has never signed in'}
          </p>

          <Field label="Role" hint="Leave unchanged to keep the current one.">
            {(props) => (
              <Select {...props} value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
                <option value="">Unchanged</option>
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Active"
            hint="A deactivated profile is removed from approval routing but keeps its history."
          >
            {(props) => (
              <Select {...props} value={active} onChange={(e) => setActive(e.target.value)}>
                <option value="">Unchanged</option>
                <option value="true">Active</option>
                <option value="false">Deactivated</option>
              </Select>
            )}
          </Field>

          <Field
            label="Away until"
            hint="Routing skips this person while they are away. Leave empty to clear."
          >
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={unavailableUntil}
                onChange={(e) => setUnavailableUntil(e.target.value)}
              />
            )}
          </Field>

          {save.error ? <InlineError error={save.error} /> : null}
        </div>
      ) : null}
    </Dialog>
  )
}

/* ------------------------------------------------------------------- teams */

function TeamsSection() {
  const queryClient = useQueryClient()
  const dialog = useDisclosure()
  const [name, setName] = useState('')

  const teams = useQuery({
    queryKey: keys.teams(),
    queryFn: ({ signal }) => people.teams(signal),
  })

  const create = useMutation({
    mutationFn: () => people.createTeam(name.trim()),
    onSuccess: () => {
      toast.success('Team created')
      dialog.hide()
      setName('')
      void queryClient.invalidateQueries({ queryKey: keys.teams() })
    },
  })

  return (
    <Section
      id="teams"
      title="Teams"
      description="A team is the scope a rep and a manager see: their team's quotations, their team's approvals."
      actions={
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={dialog.show}>
          New team
        </Button>
      }
    >
      <DataTable
        caption="Teams"
        rows={teams.data ?? []}
        rowKey={(row) => row.id}
        loading={teams.isLoading}
        error={teams.error ? <InlineError error={teams.error} /> : undefined}
        empty={<EmptyState title="No teams" description="Reps and managers need one for scoping." />}
        columns={[
          { id: 'name', header: 'Team', cell: (row) => <span className="font-medium">{row.name}</span> },
          {
            id: 'id',
            header: 'Identifier',
            hideBelow: 'lg',
            cell: (row) => <span className="tabular text-2xs text-text-muted">{row.id}</span>,
          },
        ]}
      />

      <Dialog
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        title="New team"
        description="Reps and managers assigned to it will see one another's quotations."
        busy={create.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={dialog.hide} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={create.isPending}
              disabled={!name.trim()}
              disabledReason="A name is required."
              onClick={() => create.mutate()}
            >
              Create team
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Team name" required>
            {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          {create.error ? <InlineError error={create.error} /> : null}
        </div>
      </Dialog>
    </Section>
  )
}

/* ------------------------------------------------------------- delegations */

function DelegationsSection() {
  const queryClient = useQueryClient()
  const dialog = useDisclosure()

  const delegations = useQuery({
    queryKey: keys.delegations(),
    queryFn: ({ signal }) => people.delegations(signal),
  })

  return (
    <Section
      id="delegations"
      title="Approval delegations"
      description="A time-boxed hand-off so approvals keep moving while someone is away. Only a qualified approver can receive one."
      actions={
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={dialog.show}>
          New delegation
        </Button>
      }
    >
      <DataTable
        caption="Approval delegations"
        rows={delegations.data ?? []}
        rowKey={(row) => row.id}
        loading={delegations.isLoading}
        error={delegations.error ? <InlineError error={delegations.error} /> : undefined}
        empty={
          <EmptyState
            title="No delegations"
            description="Set one up before someone with approval duties goes away."
          />
        }
        columns={[
          {
            id: 'role',
            header: 'For role',
            cell: (row) => (
              <Badge tone="neutral" size="sm">
                {ROLE_LABEL[row.approverRole] ?? row.approverRole}
              </Badge>
            ),
          },
          {
            id: 'window',
            header: 'Window',
            cell: (row) => `${formatTimestamp(row.validFrom)} → ${formatTimestamp(row.validUntil)}`,
          },
          {
            id: 'active',
            header: 'Status',
            cell: (row) => (
              <Badge tone={row.activeNow ? 'ok' : 'neutral'} size="sm">
                {row.activeNow ? 'Active now' : 'Not active'}
              </Badge>
            ),
          },
          {
            id: 'reason',
            header: 'Reason',
            hideBelow: 'lg',
            cell: (row) => <span className="text-text-secondary">{row.reason}</span>,
          },
        ]}
      />

      <DelegationDialog
        open={dialog.open}
        onOpenChange={dialog.setOpen}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: keys.delegations() })}
      />
    </Section>
  )
}

function DelegationDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [approverRole, setApproverRole] = useState<Role>('MANAGER')
  const [delegateProfileId, setDelegateProfileId] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [reason, setReason] = useState('')

  const candidates = useQuery({
    queryKey: keys.profiles({ role: approverRole }),
    queryFn: ({ signal }) => people.profiles({ role: approverRole, pageSize: 100 }, signal),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () =>
      people.delegate({
        approverRole,
        delegateProfileId,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Delegation created')
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New approval delegation"
      description="Approvals for this role route to the delegate for the window below."
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            disabled={!delegateProfileId || !validFrom || !validUntil || reason.trim().length < 3}
            disabledReason="Choose a delegate, a window and a reason."
            onClick={() => create.mutate()}
          >
            Create delegation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Approver role" required>
          {(props) => (
            <Select
              {...props}
              value={approverRole}
              onChange={(e) => {
                setApproverRole(e.target.value as Role)
                setDelegateProfileId('')
              }}
            >
              <option value="MANAGER">{ROLE_LABEL.MANAGER}</option>
              <option value="FINANCE">{ROLE_LABEL.FINANCE}</option>
            </Select>
          )}
        </Field>

        <Field label="Delegate" required hint="Only profiles already qualified for this role.">
          {(props) => (
            <Select
              {...props}
              value={delegateProfileId}
              onChange={(e) => setDelegateProfileId(e.target.value)}
            >
              <option value="">Choose a delegate…</option>
              {(candidates.data?.items ?? [])
                .filter((profile) => profile.active)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.fullName ?? profile.email}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid from" required>
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label="Valid until" required>
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Reason" required>
          {(props) => (
            <Textarea {...props} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>

        {create.error ? <InlineError error={create.error} /> : null}
      </div>
    </Dialog>
  )
}
