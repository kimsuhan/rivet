'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  GitBranch,
  MailPlus,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldX,
  UsersRound,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  getTeamsControllerGetQueryKey,
  getTeamsControllerListQueryKey,
  type MemberSummaryResponseDto,
  type TeamResponseDto,
  type TeamSummaryResponseDto,
  useAuthControllerGetSession,
  useTeamInvitationsControllerCreate,
  useTeamsControllerAddMember,
  useTeamsControllerArchive,
  useTeamsControllerCreate,
  useTeamsControllerGet,
  useTeamsControllerList,
  useTeamsControllerRemoveLeader,
  useTeamsControllerRemoveMember,
  useTeamsControllerSetLeader,
  useTeamsControllerUpdate,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useMemberPages } from '@/features/members/member-settings-queries';
import { Link } from '@/i18n/navigation';

import { createTeamKey, normalizeTeamKey } from './team-key';

export type TeamSettingsLabels = {
  activeEmptyDescription: string;
  activeEmptyTitle: string;
  activeTab: string;
  archive: string;
  archiveBlockedDescription: string;
  archiveBlockedTitle: string;
  archiveConfirm: string;
  archiveDescription: string;
  archiveTitle: string;
  archivedBadge: string;
  archivedEmptyDescription: string;
  archivedEmptyTitle: string;
  archivedTab: string;
  cancel: string;
  close: string;
  conflictDescription: string;
  conflictTitle: string;
  create: string;
  createDescription: string;
  createLeaderDescription: string;
  createTitle: string;
  creating: string;
  currentAdmin: string;
  description: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  descriptionTooLong: string;
  discardChanges: string;
  discardDescription: string;
  discardTitle: string;
  edit: string;
  editDescription: string;
  editTitle: string;
  errorDescription: string;
  errorTitle: string;
  forbiddenDescription: string;
  forbiddenTitle: string;
  keyDescription: string;
  keyFormat: string;
  keyInUse: string;
  keyLabel: string;
  keyLockedDescription: string;
  keyLockedTitle: string;
  keyPlaceholder: string;
  keepEditing: string;
  invite: string;
  inviteDescription: string;
  inviteEmailInvalid: string;
  inviteEmailLabel: string;
  inviteEmailPlaceholder: string;
  inviteSend: string;
  inviteTitle: string;
  inviting: string;
  loadMoreMembers: string;
  loadMoreMembersErrorDescription: string;
  loadMoreMembersErrorTitle: string;
  loading: string;
  leaderBadge: string;
  leadersDescription: string;
  leadersLabel: string;
  memberBlockedDescription: string;
  memberBlockedTitle: string;
  memberRequired: string;
  memberUnit: string;
  memberUpdateDescription: string;
  memberUpdateTitle: string;
  membersDescription: string;
  membersLabel: string;
  nameInUse: string;
  nameInvalid: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  nameTooLong: string;
  noLeader: string;
  removeMemberAction: string;
  removeMemberDescription: string;
  removeMemberTitle: string;
  removeLeader: string;
  retry: string;
  save: string;
  saving: string;
  setLeader: string;
  title: string;
  workflow: string;
};

type Notice = 'ARCHIVE_BLOCKED' | 'CONFLICT' | 'ERROR' | null;

function MemberChoice({
  checked,
  currentAdmin,
  disabled,
  labels,
  member,
  onCheckedChange,
}: {
  checked: boolean;
  currentAdmin: boolean;
  disabled?: boolean;
  labels: TeamSettingsLabels;
  member: MemberSummaryResponseDto;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = 'team-member-' + member.id;

  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
      />
      <FieldLabel htmlFor={id} className="min-w-0 items-start">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate">{member.user.displayName}</span>
            {currentAdmin ? <Badge variant="outline">{labels.currentAdmin}</Badge> : null}
          </span>
          {member.email ? (
            <span className="text-muted-foreground block truncate text-xs font-normal">
              {member.email}
            </span>
          ) : null}
        </span>
      </FieldLabel>
    </Field>
  );
}

function TeamCreateDialog({
  hasMemberLoadError,
  hasMoreMembers,
  isLoadingMoreMembers,
  labels,
  members,
  membershipId,
  onClose,
  onLoadMoreMembers,
}: {
  hasMemberLoadError: boolean;
  hasMoreMembers: boolean;
  isLoadingMoreMembers: boolean;
  labels: TeamSettingsLabels;
  members: MemberSummaryResponseDto[];
  membershipId: string;
  onClose: () => void;
  onLoadMoreMembers: () => void;
}) {
  const hasEditedKey = useRef(false);
  const queryClient = useQueryClient();
  const mutation = useTeamsControllerCreate();
  const schema = z.object({
    key: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,5}$/, labels.keyFormat),
    memberIds: z.array(z.string()).min(1, labels.memberRequired),
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
    leaderId: z.string().optional(),
  });
  const {
    clearErrors,
    control,
    formState: { errors, isDirty },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { key: '', memberIds: [], name: '' },
    resolver: zodResolver(schema),
  });
  const selectedMemberIds = useWatch({ control, name: 'memberIds' }) ?? [];
  const selectedLeaderId = useWatch({ control, name: 'leaderId' });
  const nameField = register('name');
  const keyField = register('key');
  const [unexpectedError, setUnexpectedError] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;

    clearErrors();
    setUnexpectedError(false);
    mutation.mutate(
      { data: values },
      {
        onError: (error) => {
          const code = error.body.code;
          const hasNameError = Boolean(
            code === 'TEAM_NAME_IN_USE' || error.body.fieldErrors.name?.length,
          );
          if (hasNameError) {
            setError(
              'name',
              {
                message: code === 'TEAM_NAME_IN_USE' ? labels.nameInUse : labels.nameInvalid,
                type: 'server',
              },
              { shouldFocus: true },
            );
          }
          if (code === 'TEAM_KEY_IN_USE' || error.body.fieldErrors.key?.length) {
            setError(
              'key',
              {
                message: code === 'TEAM_KEY_IN_USE' ? labels.keyInUse : labels.keyFormat,
                type: 'server',
              },
              { shouldFocus: !hasNameError },
            );
          }
          if (
            code !== 'TEAM_NAME_IN_USE' &&
            code !== 'TEAM_KEY_IN_USE' &&
            !error.body.fieldErrors.name?.length &&
            !error.body.fieldErrors.key?.length
          ) {
            setUnexpectedError(true);
          }
        },
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getTeamsControllerListQueryKey() });
          await queryClient.invalidateQueries({
            queryKey: getTeamsControllerListQueryKey({ includeArchived: true }),
          });
          onClose();
        },
      },
    );
  });

  const requestClose = () => {
    if (mutation.isPending) return;
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent closeLabel={labels.close} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.createTitle}</DialogTitle>
            <DialogDescription>{labels.createDescription}</DialogDescription>
          </DialogHeader>
          <form id="create-team-form" noValidate onSubmit={submit} className="flex flex-col gap-5">
            {unexpectedError ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.errorTitle}</AlertTitle>
                <AlertDescription>{labels.errorDescription}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="create-team-name">{labels.nameLabel}</FieldLabel>
                <Input
                  id="create-team-name"
                  autoComplete="off"
                  aria-errormessage={errors.name ? 'create-team-name-error' : undefined}
                  aria-invalid={Boolean(errors.name)}
                  placeholder={labels.namePlaceholder}
                  {...nameField}
                  onChange={(event) => {
                    nameField.onChange(event);

                    if (hasEditedKey.current) {
                      return;
                    }

                    setValue('key', createTeamKey(event.target.value), {
                      shouldDirty: true,
                      shouldValidate: Boolean(errors.key),
                    });
                  }}
                />
                <FieldError id="create-team-name-error" errors={[errors.name]} />
              </Field>
              <Field data-invalid={Boolean(errors.key)}>
                <FieldLabel htmlFor="create-team-key">{labels.keyLabel}</FieldLabel>
                <Input
                  id="create-team-key"
                  autoCapitalize="characters"
                  autoComplete="off"
                  aria-errormessage={errors.key ? 'create-team-key-error' : undefined}
                  aria-invalid={Boolean(errors.key)}
                  maxLength={5}
                  placeholder={labels.keyPlaceholder}
                  spellCheck={false}
                  {...keyField}
                  onChange={(event) => {
                    setValue('key', normalizeTeamKey(event.target.value), {
                      shouldDirty: true,
                      shouldValidate: Boolean(errors.key),
                    });
                    hasEditedKey.current = true;
                  }}
                  onClick={(event) => {
                    if (!hasEditedKey.current) {
                      event.currentTarget.select();
                    }
                  }}
                  onFocus={(event) => {
                    if (!hasEditedKey.current) {
                      event.currentTarget.select();
                    }
                  }}
                />
                <FieldDescription>{labels.keyDescription}</FieldDescription>
                <FieldError id="create-team-key-error" errors={[errors.key]} />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">{labels.membersLabel}</FieldLegend>
                <FieldDescription>{labels.membersDescription}</FieldDescription>
                <div
                  data-slot="checkbox-group"
                  className="flex max-h-52 flex-col gap-3 overflow-y-auto py-1"
                >
                  {members.map((member) => (
                    <MemberChoice
                      key={member.id}
                      checked={selectedMemberIds.includes(member.id)}
                      currentAdmin={member.id === membershipId}
                      labels={labels}
                      member={member}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...new Set([...selectedMemberIds, member.id])]
                          : selectedMemberIds.filter((id) => id !== member.id);
                        setValue('memberIds', next, { shouldDirty: true, shouldValidate: true });
                        if (!checked && selectedLeaderId === member.id) {
                          setValue('leaderId', undefined, { shouldDirty: true });
                        }
                      }}
                    />
                  ))}
                </div>
                {hasMemberLoadError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.loadMoreMembersErrorTitle}</AlertTitle>
                    <AlertDescription>{labels.loadMoreMembersErrorDescription}</AlertDescription>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isLoadingMoreMembers}
                      onClick={onLoadMoreMembers}
                    >
                      {isLoadingMoreMembers ? (
                        <Spinner data-icon="inline-start" aria-hidden="true" />
                      ) : null}
                      {labels.retry}
                    </Button>
                  </Alert>
                ) : null}
                {hasMoreMembers && !hasMemberLoadError ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isLoadingMoreMembers}
                    onClick={onLoadMoreMembers}
                  >
                    {isLoadingMoreMembers ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    {labels.loadMoreMembers}
                  </Button>
                ) : null}
                <FieldError errors={[errors.memberIds]} />
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="create-team-leader">{labels.leadersLabel}</FieldLabel>
                <FieldDescription>{labels.createLeaderDescription}</FieldDescription>
                <Select
                  items={[
                    { label: labels.noLeader, value: '' },
                    ...members
                      .filter((member) => selectedMemberIds.includes(member.id))
                      .map((member) => ({ label: member.user.displayName, value: member.id })),
                  ]}
                  value={selectedLeaderId ?? ''}
                  onValueChange={(value) =>
                    setValue('leaderId', value || undefined, { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="create-team-leader" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value="">{labels.noLeader}</SelectItem>
                      {members
                        .filter((member) => selectedMemberIds.includes(member.id))
                        .map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.user.displayName}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" form="create-team-form" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {mutation.isPending ? labels.creating : labels.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDiscardConfirmation} onOpenChange={setShowDiscardConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.keepEditing}</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" onClick={onClose}>
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TeamEditDialog({
  hasMemberLoadError,
  hasMoreMembers,
  isLoadingMoreMembers,
  isAdmin,
  labels,
  members,
  onClose,
  onLoadMoreMembers,
  team,
}: {
  hasMemberLoadError: boolean;
  hasMoreMembers: boolean;
  isLoadingMoreMembers: boolean;
  isAdmin: boolean;
  labels: TeamSettingsLabels;
  members: MemberSummaryResponseDto[];
  onClose: () => void;
  onLoadMoreMembers: () => void;
  team: TeamResponseDto;
}) {
  const queryClient = useQueryClient();
  const update = useTeamsControllerUpdate();
  const addMember = useTeamsControllerAddMember();
  const removeMember = useTeamsControllerRemoveMember();
  const setLeader = useTeamsControllerSetLeader();
  const removeLeader = useTeamsControllerRemoveLeader();
  const schema = z.object({
    description: z.string().max(500, labels.descriptionTooLong),
    key: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,5}$/, labels.keyFormat),
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
  });
  const {
    clearErrors,
    formState: { dirtyFields, errors, isDirty },
    handleSubmit,
    register,
    resetField,
    setError,
    setValue,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { description: team.description ?? '', key: team.key, name: team.name },
    resolver: zodResolver(schema),
  });
  const [keyLocked, setKeyLocked] = useState(false);
  const [version, setVersion] = useState(team.version);
  const [notice, setNotice] = useState<
    'CONFLICT' | 'MEMBER_BLOCKED' | 'MEMBER_ERROR' | 'UPDATE_ERROR' | null
  >(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [pendingLeaderId, setPendingLeaderId] = useState<string | null>(null);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<MemberSummaryResponseDto | null>(
    null,
  );
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const selectedMemberIds = new Set(team.memberIds);
  const keyField = register('key');

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getTeamsControllerGetQueryKey(team.id) });
    await queryClient.invalidateQueries({ queryKey: getTeamsControllerListQueryKey() });
    const latestTeam = queryClient.getQueryData<TeamResponseDto>(
      getTeamsControllerGetQueryKey(team.id),
    );
    if (latestTeam) {
      setVersion(latestTeam.version);
    }
  };

  const submit = handleSubmit((values) => {
    if (update.isPending || pendingMemberId || pendingLeaderId) return;

    clearErrors();
    setNotice(null);
    update.mutate(
      {
        data: {
          ...(dirtyFields.description ? { description: values.description.trim() || null } : {}),
          ...(dirtyFields.name ? { name: values.name } : {}),
          ...(isAdmin && !keyLocked && dirtyFields.key ? { key: values.key } : {}),
          version,
        },
        teamId: team.id,
      },
      {
        onError: (error) => {
          if (error.body.code === 'VERSION_CONFLICT') {
            setVersion(error.body.currentVersion ?? version);
            setNotice('CONFLICT');
            void refresh();
            return;
          }
          if (error.body.code === 'TEAM_KEY_LOCKED') {
            setKeyLocked(true);
            resetField('key', { defaultValue: team.key });
            return;
          }
          if (error.body.code === 'TEAM_NAME_IN_USE' || error.body.fieldErrors.name?.length) {
            setError(
              'name',
              {
                message:
                  error.body.code === 'TEAM_NAME_IN_USE' ? labels.nameInUse : labels.nameInvalid,
                type: 'server',
              },
              { shouldFocus: true },
            );
            return;
          }
          if (error.body.code === 'TEAM_KEY_IN_USE' || error.body.fieldErrors.key?.length) {
            setError(
              'key',
              {
                message: error.body.code === 'TEAM_KEY_IN_USE' ? labels.keyInUse : labels.keyFormat,
                type: 'server',
              },
              { shouldFocus: true },
            );
            return;
          }
          setNotice('UPDATE_ERROR');
        },
        onSuccess: async () => {
          await refresh();
          onClose();
        },
      },
    );
  });

  const changeMember = (memberId: string, checked: boolean) => {
    if (pendingMemberId) return;

    setPendingMemberId(memberId);
    setNotice(null);
    const mutation = checked ? addMember : removeMember;
    mutation.mutate(
      { membershipId: memberId, teamId: team.id },
      {
        onError: (error) => {
          setNotice(
            error.body.code === 'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS'
              ? 'MEMBER_BLOCKED'
              : 'MEMBER_ERROR',
          );
          setPendingMemberId(null);
        },
        onSuccess: async () => {
          await refresh();
          setPendingMemberId(null);
        },
      },
    );
  };

  const changeLeader = (memberId: string, checked: boolean) => {
    if (!isAdmin || pendingLeaderId) return;

    setPendingLeaderId(memberId);
    setNotice(null);
    const mutation = checked ? setLeader : removeLeader;
    mutation.mutate(
      { membershipId: memberId, teamId: team.id },
      {
        onError: () => {
          setNotice('MEMBER_ERROR');
          setPendingLeaderId(null);
        },
        onSuccess: async () => {
          await refresh();
          setPendingLeaderId(null);
        },
      },
    );
  };

  const requestClose = () => {
    if (update.isPending || pendingMemberId || pendingLeaderId) return;
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent closeLabel={labels.close} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.editTitle}</DialogTitle>
            <DialogDescription>{labels.editDescription}</DialogDescription>
          </DialogHeader>
          <form id="edit-team-form" noValidate onSubmit={submit} className="flex flex-col gap-5">
            {notice === 'CONFLICT' ? (
              <Alert>
                <AlertTitle>{labels.conflictTitle}</AlertTitle>
                <AlertDescription>{labels.conflictDescription}</AlertDescription>
              </Alert>
            ) : null}
            {notice === 'MEMBER_BLOCKED' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.memberBlockedTitle}</AlertTitle>
                <AlertDescription>{labels.memberBlockedDescription}</AlertDescription>
              </Alert>
            ) : null}
            {notice === 'MEMBER_ERROR' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.memberUpdateTitle}</AlertTitle>
                <AlertDescription>{labels.memberUpdateDescription}</AlertDescription>
              </Alert>
            ) : null}
            {notice === 'UPDATE_ERROR' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.errorTitle}</AlertTitle>
                <AlertDescription>{labels.errorDescription}</AlertDescription>
              </Alert>
            ) : null}
            {keyLocked ? (
              <Alert>
                <AlertTitle>{labels.keyLockedTitle}</AlertTitle>
                <AlertDescription>{labels.keyLockedDescription}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="edit-team-name">{labels.nameLabel}</FieldLabel>
                <Input
                  id="edit-team-name"
                  autoComplete="off"
                  aria-errormessage={errors.name ? 'edit-team-name-error' : undefined}
                  aria-invalid={Boolean(errors.name)}
                  {...register('name')}
                />
                <FieldError id="edit-team-name-error" errors={[errors.name]} />
              </Field>
              <Field data-invalid={Boolean(errors.description)}>
                <FieldLabel htmlFor="edit-team-description">{labels.descriptionLabel}</FieldLabel>
                <Textarea
                  id="edit-team-description"
                  aria-errormessage={errors.description ? 'edit-team-description-error' : undefined}
                  aria-invalid={Boolean(errors.description)}
                  maxLength={500}
                  placeholder={labels.descriptionPlaceholder}
                  {...register('description')}
                />
                <FieldError id="edit-team-description-error" errors={[errors.description]} />
              </Field>
              {isAdmin ? (
                <Field data-invalid={Boolean(errors.key)} data-disabled={keyLocked || undefined}>
                  <FieldLabel htmlFor="edit-team-key">{labels.keyLabel}</FieldLabel>
                  <Input
                    id="edit-team-key"
                    autoCapitalize="characters"
                    autoComplete="off"
                    aria-errormessage={errors.key ? 'edit-team-key-error' : undefined}
                    aria-invalid={Boolean(errors.key)}
                    disabled={keyLocked}
                    maxLength={5}
                    spellCheck={false}
                    {...keyField}
                    onChange={(event) => {
                      setValue('key', normalizeTeamKey(event.target.value), {
                        shouldDirty: true,
                        shouldValidate: Boolean(errors.key),
                      });
                    }}
                  />
                  <FieldDescription>{labels.keyDescription}</FieldDescription>
                  <FieldError id="edit-team-key-error" errors={[errors.key]} />
                </Field>
              ) : null}
              <FieldSet>
                <FieldLegend variant="label">{labels.membersLabel}</FieldLegend>
                <FieldDescription>{labels.membersDescription}</FieldDescription>
                <div
                  data-slot="checkbox-group"
                  className="flex max-h-52 flex-col gap-3 overflow-y-auto py-1"
                >
                  {members.map((member) => (
                    <MemberChoice
                      key={member.id}
                      checked={selectedMemberIds.has(member.id)}
                      currentAdmin={false}
                      disabled={
                        pendingMemberId !== null ||
                        pendingLeaderId !== null ||
                        team.leaderIds.includes(member.id)
                      }
                      labels={labels}
                      member={member}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          changeMember(member.id, true);
                        } else {
                          setRemoveMemberTarget(member);
                        }
                      }}
                    />
                  ))}
                </div>
                {hasMemberLoadError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.loadMoreMembersErrorTitle}</AlertTitle>
                    <AlertDescription>{labels.loadMoreMembersErrorDescription}</AlertDescription>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isLoadingMoreMembers}
                      onClick={onLoadMoreMembers}
                    >
                      {isLoadingMoreMembers ? (
                        <Spinner data-icon="inline-start" aria-hidden="true" />
                      ) : null}
                      {labels.retry}
                    </Button>
                  </Alert>
                ) : null}
                {hasMoreMembers && !hasMemberLoadError ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isLoadingMoreMembers}
                    onClick={onLoadMoreMembers}
                  >
                    {isLoadingMoreMembers ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    {labels.loadMoreMembers}
                  </Button>
                ) : null}
              </FieldSet>
              {isAdmin ? (
                <FieldSet>
                  <FieldLegend variant="label">{labels.leadersLabel}</FieldLegend>
                  <FieldDescription>{labels.leadersDescription}</FieldDescription>
                  <div className="flex max-h-52 flex-col gap-3 overflow-y-auto py-1">
                    {members
                      .filter((member) => selectedMemberIds.has(member.id))
                      .map((member) => {
                        const isLeader = team.leaderIds.includes(member.id);
                        const id = 'team-leader-' + member.id;

                        return (
                          <Field key={member.id} orientation="horizontal">
                            <Checkbox
                              id={id}
                              checked={isLeader}
                              disabled={pendingLeaderId !== null}
                              onCheckedChange={(value) => changeLeader(member.id, Boolean(value))}
                            />
                            <FieldLabel htmlFor={id} className="min-w-0">
                              <span className="truncate">{member.user.displayName}</span>
                              {isLeader ? (
                                <Badge variant="outline">{labels.leaderBadge}</Badge>
                              ) : null}
                              <span className="sr-only">
                                {isLeader ? labels.removeLeader : labels.setLeader}
                              </span>
                            </FieldLabel>
                          </Field>
                        );
                      })}
                  </div>
                </FieldSet>
              ) : null}
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose}>
              {labels.close}
            </Button>
            <Button
              type="submit"
              form="edit-team-form"
              disabled={
                update.isPending || pendingMemberId !== null || pendingLeaderId !== null || !isDirty
              }
            >
              {update.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {update.isPending ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(removeMemberTarget)}
        onOpenChange={(open) => {
          if (!open && !removeMember.isPending) {
            setRemoveMemberTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.removeMemberTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.removeMemberDescription.replace(
                '{member}',
                removeMemberTarget?.user.displayName ?? '',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={removeMember.isPending}
              onClick={() => {
                if (removeMemberTarget) {
                  changeMember(removeMemberTarget.id, false);
                  setRemoveMemberTarget(null);
                }
              }}
            >
              {removeMember.isPending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              {labels.removeMemberAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showDiscardConfirmation} onOpenChange={setShowDiscardConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.keepEditing}</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" onClick={onClose}>
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TeamInviteDialog({
  labels,
  onClose,
  team,
}: {
  labels: TeamSettingsLabels;
  onClose: () => void;
  team: TeamSummaryResponseDto;
}) {
  const mutation = useTeamInvitationsControllerCreate();
  const schema = z.object({
    email: z.string().trim().pipe(z.email(labels.inviteEmailInvalid)),
  });
  const {
    formState: { errors },
    handleSubmit,
    register,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { email: '' },
    resolver: zodResolver(schema),
  });
  const [unexpectedError, setUnexpectedError] = useState(false);
  const submit = handleSubmit(({ email }) => {
    if (mutation.isPending) return;
    setUnexpectedError(false);
    mutation.mutate(
      { data: { emails: [email] }, teamId: team.id },
      {
        onError: () => setUnexpectedError(true),
        onSuccess: onClose,
      },
    );
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent closeLabel={labels.close}>
        <DialogHeader>
          <DialogTitle>{labels.inviteTitle}</DialogTitle>
          <DialogDescription>
            {labels.inviteDescription.replace('{team}', team.name)}
          </DialogDescription>
        </DialogHeader>
        <form id="team-invite-form" noValidate onSubmit={submit} className="space-y-4">
          {unexpectedError ? (
            <Alert variant="destructive">
              <AlertTitle>{labels.errorTitle}</AlertTitle>
              <AlertDescription>{labels.errorDescription}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="team-invite-email">{labels.inviteEmailLabel}</FieldLabel>
            <Input
              id="team-invite-email"
              type="email"
              autoComplete="email"
              placeholder={labels.inviteEmailPlaceholder}
              aria-errormessage={errors.email ? 'team-invite-email-error' : undefined}
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            <FieldError id="team-invite-email-error" errors={[errors.email]} />
          </Field>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button type="submit" form="team-invite-form" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
            {mutation.isPending ? labels.inviting : labels.inviteSend}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamRow({
  isAdmin,
  labels,
  onArchive,
  onEdit,
  onInvite,
  team,
}: {
  isAdmin: boolean;
  labels: TeamSettingsLabels;
  onArchive: (team: TeamSummaryResponseDto) => void;
  onEdit: (teamId: string) => void;
  onInvite: (team: TeamSummaryResponseDto) => void;
  team: TeamSummaryResponseDto;
}) {
  return (
    <li className="flex min-h-16 items-center gap-4 border-b py-3 first:border-t">
      <code className="bg-surface-2 text-muted-foreground min-w-14 rounded px-2 py-1 text-center text-xs">
        {team.key}
      </code>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{team.name}</span>
          {team.archived ? <Badge variant="outline">{labels.archivedBadge}</Badge> : null}
        </div>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          <UsersRound aria-hidden="true" className="size-3.5" />
          {team.memberCount}
          {labels.memberUnit}
          {team.leaderCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              {team.leaderCount}
              {labels.leaderBadge}
            </>
          ) : null}
        </span>
        {team.description ? (
          <p className="text-muted-foreground mt-1 truncate text-xs">{team.description}</p>
        ) : null}
      </div>
      {!team.archived && (isAdmin || team.canManage) ? (
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onInvite(team)}>
            <MailPlus data-icon="inline-start" />
            {labels.invite}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(team.id)}>
            <Pencil data-icon="inline-start" />
            {labels.edit}
          </Button>
          <Link
            href={'/settings/teams/' + team.id + '/workflow'}
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
          >
            <GitBranch data-icon="inline-start" />
            {labels.workflow}
          </Link>
          {isAdmin ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onArchive(team)}>
              <Archive data-icon="inline-start" />
              {labels.archive}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function TeamSettingsScreen({ labels }: { labels: TeamSettingsLabels }) {
  const queryClient = useQueryClient();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const teams = useTeamsControllerList({ includeArchived: true }, { query: { retry: false } });
  const members = useMemberPages('ACTIVE');
  const archive = useTeamsControllerArchive();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTeamId, setEditTeamId] = useState<string | null>(null);
  const [inviteTarget, setInviteTarget] = useState<TeamSummaryResponseDto | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TeamSummaryResponseDto | null>(null);
  const [archiveError, setArchiveError] = useState<Notice>(null);
  const detail = useTeamsControllerGet(editTeamId ?? '', {
    query: { enabled: Boolean(editTeamId), retry: false },
  });
  const isAdmin = Boolean(session.data?.authenticated && session.data.membership?.role === 'ADMIN');
  const allTeams = (teams.data?.items ?? []).filter((team) => isAdmin || team.canManage);
  const activeTeams = allTeams.filter((team) => !team.archived);
  const archivedTeams = allTeams.filter((team) => team.archived);
  const membershipId =
    session.data?.authenticated && session.data.membership?.status === 'ACTIVE'
      ? session.data.membership.id
      : null;
  const activeMembers = members.data?.pages.flatMap((page) => page.items) ?? [];
  const forbidden = teams.error?.status === 403 || members.error?.status === 403;

  if (teams.isPending || members.isPending || session.isPending) {
    return <ContentLoading label={labels.loading} />;
  }

  if (forbidden || !membershipId) {
    return (
      <ContentEmpty
        icon={ShieldX}
        title={labels.forbiddenTitle}
        description={labels.forbiddenDescription}
      />
    );
  }

  if (teams.isError || (members.isError && !members.data) || session.isError) {
    return (
      <ContentEmpty
        icon={UsersRound}
        title={labels.errorTitle}
        description={labels.errorDescription}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void teams.refetch();
            void members.refetch();
            void session.refetch();
          }}
        >
          {labels.retry}
        </Button>
      </ContentEmpty>
    );
  }

  const confirmArchive = () => {
    if (!archiveTarget || archive.isPending) return;

    setArchiveError(null);
    archive.mutate(
      { data: { version: archiveTarget.version }, teamId: archiveTarget.id },
      {
        onError: (error) => {
          if (error.body.code === 'VERSION_CONFLICT') {
            setArchiveTarget({
              ...archiveTarget,
              version: error.body.currentVersion ?? archiveTarget.version,
            });
            setArchiveError('CONFLICT');
            void teams.refetch();
            return;
          }
          if (error.body.code === 'TEAM_HAS_OPEN_ISSUES') {
            setArchiveError('ARCHIVE_BLOCKED');
            return;
          }
          setArchiveError('ERROR');
        },
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getTeamsControllerListQueryKey() });
          setArchiveTarget(null);
          setArchiveError(null);
        },
      },
    );
  };

  const openEdit = (teamId: string) => {
    queryClient.removeQueries({
      exact: true,
      queryKey: getTeamsControllerGetQueryKey(teamId),
    });
    setEditTeamId(teamId);
  };

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="flex items-start justify-between gap-6 border-b pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em]">{labels.title}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{labels.description}</p>
        </div>
        {isAdmin ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            {labels.create}
          </Button>
        ) : null}
      </header>

      <Tabs defaultValue="active" className="mt-5">
        <TabsList variant="line" aria-label={labels.title}>
          <TabsTrigger value="active">
            {labels.activeTab}
            <Badge variant="secondary">{activeTeams.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="archived">
            {labels.archivedTab}
            <Badge variant="secondary">{archivedTeams.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="pt-4">
          {activeTeams.length ? (
            <ul>
              {activeTeams.map((team) => (
                <TeamRow
                  key={team.id}
                  isAdmin={isAdmin}
                  labels={labels}
                  onArchive={(target) => {
                    setArchiveError(null);
                    setArchiveTarget(target);
                  }}
                  onEdit={openEdit}
                  onInvite={setInviteTarget}
                  team={team}
                />
              ))}
            </ul>
          ) : (
            <ContentEmpty
              icon={GitBranch}
              title={labels.activeEmptyTitle}
              description={labels.activeEmptyDescription}
            />
          )}
        </TabsContent>
        <TabsContent value="archived" className="pt-4">
          {archivedTeams.length ? (
            <ul>
              {archivedTeams.map((team) => (
                <TeamRow
                  key={team.id}
                  isAdmin={isAdmin}
                  labels={labels}
                  onArchive={setArchiveTarget}
                  onEdit={openEdit}
                  onInvite={setInviteTarget}
                  team={team}
                />
              ))}
            </ul>
          ) : (
            <ContentEmpty
              icon={Archive}
              title={labels.archivedEmptyTitle}
              description={labels.archivedEmptyDescription}
            />
          )}
        </TabsContent>
      </Tabs>

      {createOpen ? (
        <TeamCreateDialog
          hasMemberLoadError={members.isFetchNextPageError}
          hasMoreMembers={Boolean(members.hasNextPage)}
          isLoadingMoreMembers={members.isFetchingNextPage}
          labels={labels}
          members={activeMembers}
          membershipId={membershipId}
          onClose={() => setCreateOpen(false)}
          onLoadMoreMembers={() => void members.fetchNextPage()}
        />
      ) : null}
      {editTeamId && detail.data ? (
        <TeamEditDialog
          hasMemberLoadError={members.isFetchNextPageError}
          hasMoreMembers={Boolean(members.hasNextPage)}
          isLoadingMoreMembers={members.isFetchingNextPage}
          isAdmin={isAdmin}
          labels={labels}
          members={activeMembers}
          onClose={() => setEditTeamId(null)}
          onLoadMoreMembers={() => void members.fetchNextPage()}
          team={detail.data}
        />
      ) : null}
      {inviteTarget ? (
        <TeamInviteDialog
          labels={labels}
          onClose={() => setInviteTarget(null)}
          team={inviteTarget}
        />
      ) : null}
      {editTeamId && detail.isError && !detail.data ? (
        <Dialog open onOpenChange={(open) => !open && setEditTeamId(null)}>
          <DialogContent showCloseButton={false} className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{labels.errorTitle}</DialogTitle>
              <DialogDescription>{labels.errorDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton closeLabel={labels.close}>
              <Button
                type="button"
                disabled={detail.isFetching}
                onClick={() => void detail.refetch()}
              >
                {detail.isFetching ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
                {labels.retry}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) {
            setArchiveTarget(null);
            setArchiveError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.archiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.archiveDescription.replace('{team}', archiveTarget?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError === 'CONFLICT' ? (
            <Alert>
              <AlertTitle>{labels.conflictTitle}</AlertTitle>
              <AlertDescription>{labels.conflictDescription}</AlertDescription>
            </Alert>
          ) : null}
          {archiveError === 'ARCHIVE_BLOCKED' ? (
            <Alert variant="destructive">
              <AlertTitle>{labels.archiveBlockedTitle}</AlertTitle>
              <AlertDescription>{labels.archiveBlockedDescription}</AlertDescription>
            </Alert>
          ) : null}
          {archiveError === 'ERROR' ? (
            <Alert variant="destructive">
              <AlertTitle>{labels.errorTitle}</AlertTitle>
              <AlertDescription>{labels.errorDescription}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={archive.isPending}
              onClick={confirmArchive}
            >
              {archive.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {labels.archiveConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
