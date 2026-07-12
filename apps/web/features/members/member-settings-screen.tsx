'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, MailPlus, RefreshCw, Send, ShieldX, UserRoundCheck, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  getInvitationsControllerListQueryKey,
  getMembersControllerListQueryKey,
  type InvitationResponseDto,
  type MemberSummaryResponseDto,
  useAuthControllerGetSession,
  useInvitationsControllerCancel,
  useInvitationsControllerCreate,
  useInvitationsControllerResend,
  useMembersControllerDeactivate,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/i18n/navigation';

import { useInvitationPages, useMemberPages } from './member-settings-queries';

export type MemberSettingsLabels = {
  acceptedAt: string;
  acceptedStatus: string;
  activeEmptyDescription: string;
  activeEmptyTitle: string;
  activeStatus: string;
  activeTab: string;
  adminProtected: string;
  adminRole: string;
  alreadyInvited: string;
  alreadyMember: string;
  blockedDescription: string;
  blockedResolution: string;
  blockedTitle: string;
  cancel: string;
  cancelInvitation: string;
  cancelInvitationAction: string;
  cancelInvitationDescription: string;
  cancelInvitationTitle: string;
  canceledAt: string;
  canceledSuccess: string;
  canceledStatus: string;
  canceling: string;
  close: string;
  conflictDescription: string;
  conflictTitle: string;
  currentUser: string;
  deactivate: string;
  deactivateAction: string;
  deactivateDescription: string;
  deactivateTitle: string;
  deactivatedAt: string;
  deactivatedSuccess: string;
  deactivating: string;
  description: string;
  discardChanges: string;
  discardDescription: string;
  discardTitle: string;
  emailInvalid: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailRequired: string;
  errorDescription: string;
  errorTitle: string;
  expiredAt: string;
  expiresAt: string;
  expiredStatus: string;
  forbiddenDescription: string;
  forbiddenTitle: string;
  historyTitle: string;
  inactiveEmptyDescription: string;
  inactiveEmptyTitle: string;
  inactiveStatus: string;
  inactiveTab: string;
  invite: string;
  inviteAction: string;
  inviteDescription: string;
  inviteFailed: string;
  inviteTitle: string;
  invitedBy: string;
  invitedSuccess: string;
  inviting: string;
  joinedAt: string;
  keepEditing: string;
  loadMoreInvitations: string;
  loadMoreErrorDescription: string;
  loadMoreErrorTitle: string;
  loadMoreMembers: string;
  loadMorePendingInvitations: string;
  loading: string;
  memberRole: string;
  noPendingDescription: string;
  noPendingTitle: string;
  notFoundDescription: string;
  notFoundTitle: string;
  openIssue: string;
  pendingEmptyDescription: string;
  pendingEmptyTitle: string;
  pendingStatus: string;
  pendingTab: string;
  rateLimitedDescription: string;
  rateLimitedTitle: string;
  refreshInvitations: string;
  refreshList: string;
  resend: string;
  resendSuccess: string;
  resending: string;
  retry: string;
  staleDescription: string;
  staleTitle: string;
  tabsLabel: string;
  teamSettings: string;
  title: string;
  unexpectedDescription: string;
  unexpectedTitle: string;
};

type OpenIssue = { id: string; identifier: string; title: string };
type Notice = {
  issues?: OpenIssue[];
  subject?: string;
  type:
    | 'BLOCKED'
    | 'CANCELED'
    | 'CONFLICT'
    | 'DEACTIVATED'
    | 'FORBIDDEN'
    | 'INVITED'
    | 'RATE_LIMITED'
    | 'RESENT'
    | 'STALE'
    | 'UNEXPECTED';
};

const dateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' });

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOpenIssues(details: unknown): OpenIssue[] {
  if (!isRecord(details) || !Array.isArray(details.issues)) {
    return [];
  }

  return details.issues.flatMap((issue) =>
    isRecord(issue) &&
    typeof issue.id === 'string' &&
    typeof issue.identifier === 'string' &&
    typeof issue.title === 'string'
      ? [{ id: issue.id, identifier: issue.identifier, title: issue.title }]
      : [],
  );
}

function InviteMemberDialog({
  labels,
  onClose,
  onInvited,
}: {
  labels: MemberSettingsLabels;
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const queryClient = useQueryClient();
  const invite = useInvitationsControllerCreate();
  const [formError, setFormError] = useState<
    'FORBIDDEN' | 'FAILED' | 'RATE_LIMITED' | 'UNEXPECTED' | null
  >(null);
  const schema = z.object({
    email: z.string().trim().min(1, labels.emailRequired).pipe(z.email(labels.emailInvalid)),
  });
  const {
    clearErrors,
    formState: { errors, isDirty },
    handleSubmit,
    register,
    setError,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { email: '' },
    resolver: zodResolver(schema),
  });
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);

  const submit = handleSubmit((values) => {
    if (invite.isPending) {
      return;
    }

    const email = values.email.trim();
    clearErrors();
    setFormError(null);
    invite.mutate(
      { data: { emails: [email] } },
      {
        onError: (error) => {
          if (error.status === 403) {
            setFormError('FORBIDDEN');
            return;
          }
          if (error.status === 429) {
            setFormError('RATE_LIMITED');
            return;
          }
          if (error.body?.fieldErrors?.emails?.length) {
            setError(
              'email',
              { message: labels.emailInvalid, type: 'server' },
              { shouldFocus: true },
            );
            return;
          }
          setFormError('UNEXPECTED');
        },
        onSuccess: async (response) => {
          const result = response.items[0];
          if (!result) {
            setFormError('UNEXPECTED');
            return;
          }
          if (result.result === 'ALREADY_MEMBER') {
            setError(
              'email',
              { message: labels.alreadyMember, type: 'server' },
              { shouldFocus: true },
            );
            return;
          }
          if (result.result === 'ALREADY_INVITED') {
            await queryClient.invalidateQueries({
              queryKey: getInvitationsControllerListQueryKey(),
            });
            setError(
              'email',
              { message: labels.alreadyInvited, type: 'server' },
              { shouldFocus: true },
            );
            return;
          }
          if (result.result === 'FAILED') {
            setFormError('FAILED');
            return;
          }

          await queryClient.invalidateQueries({ queryKey: getInvitationsControllerListQueryKey() });
          onInvited(email);
          onClose();
        },
      },
    );
  });

  function requestClose() {
    if (invite.isPending) {
      return;
    }
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            requestClose();
          }
        }}
      >
        <DialogContent closeLabel={labels.close}>
          <DialogHeader>
            <DialogTitle>{labels.inviteTitle}</DialogTitle>
            <DialogDescription>{labels.inviteDescription}</DialogDescription>
          </DialogHeader>

          <form id="invite-member-form" noValidate onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="invite-member-email">{labels.emailLabel}</FieldLabel>
                <Input
                  id="invite-member-email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  spellCheck={false}
                  aria-errormessage={errors.email ? 'invite-member-email-error' : undefined}
                  aria-invalid={Boolean(errors.email)}
                  placeholder={labels.emailPlaceholder}
                  {...register('email')}
                />
                <FieldError id="invite-member-email-error" errors={[errors.email]} />
              </Field>
            </FieldGroup>
          </form>

          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>
                {formError === 'FORBIDDEN'
                  ? labels.forbiddenTitle
                  : formError === 'RATE_LIMITED'
                    ? labels.rateLimitedTitle
                    : labels.unexpectedTitle}
              </AlertTitle>
              <AlertDescription>
                {formError === 'FORBIDDEN'
                  ? labels.forbiddenDescription
                  : formError === 'RATE_LIMITED'
                    ? labels.rateLimitedDescription
                    : formError === 'FAILED'
                      ? labels.inviteFailed
                      : labels.unexpectedDescription}
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={invite.isPending}
              onClick={requestClose}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" form="invite-member-form" disabled={invite.isPending}>
              {invite.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {labels.inviteAction}
            </Button>
          </DialogFooter>
          {invite.isPending ? (
            <span role="status" className="sr-only">
              {labels.inviting}
            </span>
          ) : null}
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

function MemberRows({
  currentMembershipId,
  items,
  labels,
  onDeactivate,
}: {
  currentMembershipId: string;
  items: MemberSummaryResponseDto[];
  labels: MemberSettingsLabels;
  onDeactivate: (member: MemberSummaryResponseDto) => void;
}) {
  return (
    <ul className="border-t">
      {items.map((member) => {
        const isCurrentUser = member.id === currentMembershipId;
        const canDeactivate =
          member.status === 'ACTIVE' && member.role === 'MEMBER' && !isCurrentUser;

        return (
          <li
            key={member.id}
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b py-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{member.user.displayName}</span>
                <Badge variant="outline">
                  {member.role === 'ADMIN' ? labels.adminRole : labels.memberRole}
                </Badge>
                <Badge variant={member.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                  {member.status === 'ACTIVE' ? labels.activeStatus : labels.inactiveStatus}
                </Badge>
                {isCurrentUser ? <Badge variant="secondary">{labels.currentUser}</Badge> : null}
                {!isCurrentUser && member.role === 'ADMIN' ? (
                  <Badge variant="outline">{labels.adminProtected}</Badge>
                ) : null}
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {member.email ? <span className="truncate">{member.email}</span> : null}
                <span>
                  {member.status === 'INACTIVE' && member.deactivatedAt
                    ? labels.deactivatedAt
                    : labels.joinedAt}{' '}
                  <time dateTime={member.deactivatedAt ?? member.joinedAt}>
                    {formatDate(member.deactivatedAt ?? member.joinedAt)}
                  </time>
                </span>
              </div>
            </div>

            {member.status === 'ACTIVE' ? (
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  href="/settings/teams"
                  className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                >
                  <UsersRound data-icon="inline-start" aria-hidden="true" />
                  {labels.teamSettings}
                </Link>
                {canDeactivate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeactivate(member)}
                  >
                    <Ban data-icon="inline-start" aria-hidden="true" />
                    {labels.deactivate}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function InvitationRows({
  items,
  labels,
  onCancel,
  onResend,
  resendingId,
}: {
  items: InvitationResponseDto[];
  labels: MemberSettingsLabels;
  onCancel: (invitation: InvitationResponseDto) => void;
  onResend: (invitation: InvitationResponseDto) => void;
  resendingId: string | null;
}) {
  const statusLabels = {
    ACCEPTED: labels.acceptedStatus,
    CANCELED: labels.canceledStatus,
    EXPIRED: labels.expiredStatus,
    PENDING: labels.pendingStatus,
  };

  return (
    <ul className="border-t">
      {items.map((invitation) => {
        const date =
          invitation.status === 'ACCEPTED' && invitation.acceptedAt
            ? invitation.acceptedAt
            : invitation.status === 'CANCELED' && invitation.canceledAt
              ? invitation.canceledAt
              : invitation.expiresAt;
        const dateLabel =
          invitation.status === 'ACCEPTED'
            ? labels.acceptedAt
            : invitation.status === 'CANCELED'
              ? labels.canceledAt
              : invitation.status === 'EXPIRED'
                ? labels.expiredAt
                : labels.expiresAt;

        return (
          <li
            key={invitation.id}
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b py-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{invitation.email}</span>
                <Badge variant={invitation.status === 'PENDING' ? 'secondary' : 'outline'}>
                  {statusLabels[invitation.status]}
                </Badge>
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>
                  {labels.invitedBy} {invitation.invitedByDisplayName}
                </span>
                <span>
                  {dateLabel} <time dateTime={date}>{formatDate(date)}</time>
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resendingId === invitation.id}
                onClick={() => onResend(invitation)}
              >
                {resendingId === invitation.id ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Send data-icon="inline-start" aria-hidden="true" />
                )}
                {labels.resend}
              </Button>
              {invitation.status === 'PENDING' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(invitation)}
                >
                  <Ban data-icon="inline-start" aria-hidden="true" />
                  {labels.cancelInvitation}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
      {resendingId ? (
        <li role="status" className="sr-only">
          {labels.resending}
        </li>
      ) : null}
    </ul>
  );
}

function ActionNotice({
  labels,
  notice,
  onRefresh,
}: {
  labels: MemberSettingsLabels;
  notice: Notice;
  onRefresh: () => void;
}) {
  const isError = !['CANCELED', 'DEACTIVATED', 'INVITED', 'RESENT'].includes(notice.type);
  const title =
    notice.type === 'BLOCKED'
      ? labels.blockedTitle
      : notice.type === 'FORBIDDEN'
        ? labels.forbiddenTitle
        : notice.type === 'STALE'
          ? labels.staleTitle
          : notice.type === 'CONFLICT'
            ? labels.conflictTitle
            : notice.type === 'RATE_LIMITED'
              ? labels.rateLimitedTitle
              : (notice.subject ?? labels.unexpectedTitle);
  const description =
    notice.type === 'BLOCKED'
      ? labels.blockedDescription
      : notice.type === 'FORBIDDEN'
        ? labels.forbiddenDescription
        : notice.type === 'STALE'
          ? labels.staleDescription
          : notice.type === 'CONFLICT'
            ? labels.conflictDescription
            : notice.type === 'RATE_LIMITED'
              ? labels.rateLimitedDescription
              : notice.type === 'INVITED'
                ? labels.invitedSuccess
                : notice.type === 'RESENT'
                  ? labels.resendSuccess
                  : notice.type === 'CANCELED'
                    ? labels.canceledSuccess
                    : notice.type === 'DEACTIVATED'
                      ? labels.deactivatedSuccess
                      : labels.unexpectedDescription;

  return (
    <Alert variant={isError ? 'destructive' : 'default'}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{description}</span>
        {notice.type === 'BLOCKED' && notice.issues?.length ? (
          <>
            <span>{labels.blockedResolution}</span>
            <ul className="flex flex-col gap-1">
              {notice.issues.map((issue) => (
                <li key={issue.id}>
                  <Link href={`/issues/${encodeURIComponent(issue.identifier)}`}>
                    {issue.identifier} · {issue.title} · {labels.openIssue}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </AlertDescription>
      {isError && notice.type !== 'BLOCKED' ? (
        <AlertAction>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            {labels.refreshList}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

function LoadMoreError({
  isPending,
  labels,
  onRetry,
}: {
  isPending: boolean;
  labels: MemberSettingsLabels;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{labels.loadMoreErrorTitle}</AlertTitle>
      <AlertDescription>{labels.loadMoreErrorDescription}</AlertDescription>
      <AlertAction>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onRetry}>
          {isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
          {labels.retry}
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function MemberSettingsScreen({ labels }: { labels: MemberSettingsLabels }) {
  const queryClient = useQueryClient();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const activeMembersQuery = useMemberPages('ACTIVE');
  const inactiveMembersQuery = useMemberPages('INACTIVE');
  const pendingInvitationsQuery = useInvitationPages('PENDING');
  const invitationHistoryQuery = useInvitationPages('ACCEPTED,CANCELED,EXPIRED');
  const deactivate = useMembersControllerDeactivate();
  const resend = useInvitationsControllerResend();
  const cancelInvitation = useInvitationsControllerCancel();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MemberSummaryResponseDto | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvitationResponseDto | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const activeMembers = activeMembersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const inactiveMembers = inactiveMembersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const pendingInvitations =
    pendingInvitationsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const invitationHistory = invitationHistoryQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const currentMembershipId = session.data?.authenticated ? session.data.membership?.id : null;
  const errorStatuses = [
    activeMembersQuery.error?.status,
    inactiveMembersQuery.error?.status,
    pendingInvitationsQuery.error?.status,
    invitationHistoryQuery.error?.status,
    session.error?.status,
  ];

  const refresh = async () => {
    await Promise.all([
      activeMembersQuery.refetch(),
      inactiveMembersQuery.refetch(),
      pendingInvitationsQuery.refetch(),
      invitationHistoryQuery.refetch(),
      session.refetch(),
    ]);
  };

  if (
    activeMembersQuery.isPending ||
    inactiveMembersQuery.isPending ||
    pendingInvitationsQuery.isPending ||
    invitationHistoryQuery.isPending ||
    session.isPending
  ) {
    return <ContentLoading label={labels.loading} />;
  }

  if (errorStatuses.includes(403) || !currentMembershipId) {
    return (
      <ContentEmpty
        icon={ShieldX}
        title={labels.forbiddenTitle}
        description={labels.forbiddenDescription}
      />
    );
  }

  if (errorStatuses.includes(404)) {
    return (
      <ContentEmpty
        icon={UsersRound}
        title={labels.notFoundTitle}
        description={labels.notFoundDescription}
      >
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          {labels.retry}
        </Button>
      </ContentEmpty>
    );
  }

  if (
    (activeMembersQuery.isError && !activeMembersQuery.data) ||
    (inactiveMembersQuery.isError && !inactiveMembersQuery.data) ||
    (pendingInvitationsQuery.isError && !pendingInvitationsQuery.data) ||
    (invitationHistoryQuery.isError && !invitationHistoryQuery.data) ||
    session.isError
  ) {
    return (
      <ContentError
        title={labels.errorTitle}
        description={labels.errorDescription}
        retryLabel={labels.retry}
        onRetry={() => void refresh()}
      />
    );
  }

  const handleResend = (invitation: InvitationResponseDto) => {
    if (resend.isPending) {
      return;
    }

    setNotice(null);
    setResendingId(invitation.id);
    resend.mutate(
      { invitationId: invitation.id },
      {
        onError: (error) => {
          setResendingId(null);
          setNotice({
            type:
              error.status === 403
                ? 'FORBIDDEN'
                : error.status === 404
                  ? 'STALE'
                  : error.status === 429
                    ? 'RATE_LIMITED'
                    : error.status === 409
                      ? 'CONFLICT'
                      : 'UNEXPECTED',
          });
          if (error.status === 404) {
            void Promise.all([pendingInvitationsQuery.refetch(), invitationHistoryQuery.refetch()]);
          }
        },
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getInvitationsControllerListQueryKey() });
          setResendingId(null);
          setNotice({ subject: invitation.email, type: 'RESENT' });
        },
      },
    );
  };

  const confirmCancel = () => {
    if (!cancelTarget || cancelInvitation.isPending) {
      return;
    }

    setNotice(null);
    cancelInvitation.mutate(
      { invitationId: cancelTarget.id },
      {
        onError: (error) => {
          setNotice({
            type:
              error.status === 403
                ? 'FORBIDDEN'
                : error.status === 404
                  ? 'STALE'
                  : error.status === 409
                    ? 'CONFLICT'
                    : 'UNEXPECTED',
          });
          if (error.status === 404) {
            void Promise.all([pendingInvitationsQuery.refetch(), invitationHistoryQuery.refetch()]);
          }
          setCancelTarget(null);
        },
        onSuccess: async () => {
          const email = cancelTarget.email;
          await queryClient.invalidateQueries({ queryKey: getInvitationsControllerListQueryKey() });
          setCancelTarget(null);
          setNotice({ subject: email, type: 'CANCELED' });
        },
      },
    );
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget || deactivate.isPending) {
      return;
    }

    setNotice(null);
    deactivate.mutate(
      { membershipId: deactivateTarget.id },
      {
        onError: (error) => {
          const code = error.body?.code;
          setNotice(
            code === 'MEMBER_HAS_OPEN_ASSIGNMENTS'
              ? { issues: readOpenIssues(error.body?.details), type: 'BLOCKED' }
              : {
                  type:
                    error.status === 403
                      ? 'FORBIDDEN'
                      : error.status === 404
                        ? 'STALE'
                        : error.status === 409
                          ? 'CONFLICT'
                          : 'UNEXPECTED',
                },
          );
          if (error.status === 404) {
            void Promise.all([activeMembersQuery.refetch(), inactiveMembersQuery.refetch()]);
          }
          setDeactivateTarget(null);
        },
        onSuccess: async () => {
          const displayName = deactivateTarget.user.displayName;
          await queryClient.invalidateQueries({ queryKey: getMembersControllerListQueryKey() });
          setDeactivateTarget(null);
          setNotice({ subject: displayName, type: 'DEACTIVATED' });
        },
      },
    );
  };

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="flex items-start justify-between gap-6 border-b pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em]">{labels.title}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{labels.description}</p>
        </div>
        <Button type="button" onClick={() => setInviteOpen(true)}>
          <MailPlus data-icon="inline-start" aria-hidden="true" />
          {labels.invite}
        </Button>
      </header>

      {notice ? (
        <ActionNotice
          labels={labels}
          notice={notice}
          onRefresh={() => {
            setNotice(null);
            void refresh();
          }}
        />
      ) : null}

      <Tabs defaultValue="active">
        <TabsList variant="line" aria-label={labels.tabsLabel}>
          <TabsTrigger value="active">
            {labels.activeTab}
            <Badge variant="secondary">{activeMembers.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="pending">
            {labels.pendingTab}
            <Badge variant="secondary">{pendingInvitations.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="inactive">
            {labels.inactiveTab}
            <Badge variant="secondary">{inactiveMembers.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="pt-4">
          {activeMembers.length > 0 ? (
            <div className="flex flex-col gap-4">
              <MemberRows
                currentMembershipId={currentMembershipId}
                items={activeMembers}
                labels={labels}
                onDeactivate={setDeactivateTarget}
              />
              {activeMembersQuery.isFetchNextPageError ? (
                <LoadMoreError
                  isPending={activeMembersQuery.isFetchingNextPage}
                  labels={labels}
                  onRetry={() => void activeMembersQuery.fetchNextPage()}
                />
              ) : null}
              {activeMembersQuery.hasNextPage && !activeMembersQuery.isFetchNextPageError ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={activeMembersQuery.isFetchingNextPage}
                    onClick={() => void activeMembersQuery.fetchNextPage()}
                  >
                    {activeMembersQuery.isFetchingNextPage ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    {labels.loadMoreMembers}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <ContentEmpty
              icon={UserRoundCheck}
              title={labels.activeEmptyTitle}
              description={labels.activeEmptyDescription}
            />
          )}
        </TabsContent>

        <TabsContent value="pending" className="pt-4">
          <div className="flex flex-col gap-5">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingInvitationsQuery.isFetching || invitationHistoryQuery.isFetching}
                onClick={() =>
                  void Promise.all([
                    pendingInvitationsQuery.refetch(),
                    invitationHistoryQuery.refetch(),
                  ])
                }
              >
                {pendingInvitationsQuery.isFetching || invitationHistoryQuery.isFetching ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                )}
                {labels.refreshInvitations}
              </Button>
            </div>

            {pendingInvitations.length > 0 ? (
              <InvitationRows
                items={pendingInvitations}
                labels={labels}
                onCancel={setCancelTarget}
                onResend={handleResend}
                resendingId={resendingId}
              />
            ) : invitationHistory.length > 0 ? (
              <Alert>
                <AlertTitle>{labels.noPendingTitle}</AlertTitle>
                <AlertDescription>{labels.noPendingDescription}</AlertDescription>
              </Alert>
            ) : (
              <ContentEmpty
                icon={Send}
                title={labels.pendingEmptyTitle}
                description={labels.pendingEmptyDescription}
              >
                <Button type="button" onClick={() => setInviteOpen(true)}>
                  <MailPlus data-icon="inline-start" aria-hidden="true" />
                  {labels.invite}
                </Button>
              </ContentEmpty>
            )}

            {pendingInvitationsQuery.isFetchNextPageError ? (
              <LoadMoreError
                isPending={pendingInvitationsQuery.isFetchingNextPage}
                labels={labels}
                onRetry={() => void pendingInvitationsQuery.fetchNextPage()}
              />
            ) : null}
            {pendingInvitationsQuery.hasNextPage &&
            !pendingInvitationsQuery.isFetchNextPageError ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingInvitationsQuery.isFetchingNextPage}
                  onClick={() => void pendingInvitationsQuery.fetchNextPage()}
                >
                  {pendingInvitationsQuery.isFetchingNextPage ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : null}
                  {labels.loadMorePendingInvitations}
                </Button>
              </div>
            ) : null}

            {invitationHistory.length > 0 ? (
              <section aria-labelledby="invitation-history-title" className="flex flex-col gap-4">
                <h2 id="invitation-history-title" className="mb-3 text-sm font-medium">
                  {labels.historyTitle}
                </h2>
                <InvitationRows
                  items={invitationHistory}
                  labels={labels}
                  onCancel={setCancelTarget}
                  onResend={handleResend}
                  resendingId={resendingId}
                />
                {invitationHistoryQuery.isFetchNextPageError ? (
                  <LoadMoreError
                    isPending={invitationHistoryQuery.isFetchingNextPage}
                    labels={labels}
                    onRetry={() => void invitationHistoryQuery.fetchNextPage()}
                  />
                ) : null}
                {invitationHistoryQuery.hasNextPage &&
                !invitationHistoryQuery.isFetchNextPageError ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={invitationHistoryQuery.isFetchingNextPage}
                      onClick={() => void invitationHistoryQuery.fetchNextPage()}
                    >
                      {invitationHistoryQuery.isFetchingNextPage ? (
                        <Spinner data-icon="inline-start" aria-hidden="true" />
                      ) : null}
                      {labels.loadMoreInvitations}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="inactive" className="pt-4">
          {inactiveMembers.length > 0 ? (
            <div className="flex flex-col gap-4">
              <MemberRows
                currentMembershipId={currentMembershipId}
                items={inactiveMembers}
                labels={labels}
                onDeactivate={setDeactivateTarget}
              />
              {inactiveMembersQuery.isFetchNextPageError ? (
                <LoadMoreError
                  isPending={inactiveMembersQuery.isFetchingNextPage}
                  labels={labels}
                  onRetry={() => void inactiveMembersQuery.fetchNextPage()}
                />
              ) : null}
              {inactiveMembersQuery.hasNextPage && !inactiveMembersQuery.isFetchNextPageError ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={inactiveMembersQuery.isFetchingNextPage}
                    onClick={() => void inactiveMembersQuery.fetchNextPage()}
                  >
                    {inactiveMembersQuery.isFetchingNextPage ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    {labels.loadMoreMembers}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <ContentEmpty
              icon={Ban}
              title={labels.inactiveEmptyTitle}
              description={labels.inactiveEmptyDescription}
            />
          )}
        </TabsContent>
      </Tabs>

      {inviteOpen ? (
        <InviteMemberDialog
          labels={labels}
          onClose={() => setInviteOpen(false)}
          onInvited={(email) => setNotice({ subject: email, type: 'INVITED' })}
        />
      ) : null}

      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open && !cancelInvitation.isPending) {
            setCancelTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.cancelInvitationTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{cancelTarget?.email}</strong> {labels.cancelInvitationDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelInvitation.isPending}>
              {labels.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={cancelInvitation.isPending}
              onClick={confirmCancel}
            >
              {cancelInvitation.isPending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              {labels.cancelInvitationAction}
            </AlertDialogAction>
          </AlertDialogFooter>
          {cancelInvitation.isPending ? (
            <span role="status" className="sr-only">
              {labels.canceling}
            </span>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => {
          if (!open && !deactivate.isPending) {
            setDeactivateTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.deactivateTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deactivateTarget?.user.displayName}</strong> {labels.deactivateDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivate.isPending}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={deactivate.isPending}
              onClick={confirmDeactivate}
            >
              {deactivate.isPending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              {labels.deactivateAction}
            </AlertDialogAction>
          </AlertDialogFooter>
          {deactivate.isPending ? (
            <span role="status" className="sr-only">
              {labels.deactivating}
            </span>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
