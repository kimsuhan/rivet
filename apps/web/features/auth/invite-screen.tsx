'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getAuthControllerGetSessionQueryKey,
  setCsrfToken,
  useAuthControllerGetSession,
  useInvitationAuthControllerAccept,
  useInvitationAuthControllerDismissContinuation,
  useInvitationAuthControllerGetContinuation,
  useInvitationAuthControllerStartContinuation,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Link, useRouter } from '@/i18n/navigation';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';

type InviteLabels = AuthFrameLabels & {
  accept: string;
  accepting: string;
  accountSwitchLink: string;
  currentAccountLabel: string;
  currentWorkspace: string;
  emailMismatchDescription: string;
  emailMismatchTitle: string;
  expiredDescription: string;
  expiredTitle: string;
  invalidDescription: string;
  invalidTitle: string;
  inviteEmailLabel: string;
  invitedByLabel: string;
  loading: string;
  loginLink: string;
  loginRequiredDescription: string;
  loginRequiredTitle: string;
  redirecting: string;
  retry: string;
  sessionErrorDescription: string;
  sessionErrorTitle: string;
  sessionLoading: string;
  signUpLink: string;
  signUpRequiredDescription: string;
  signUpRequiredTitle: string;
  unexpectedDescription: string;
  unexpectedTitle: string;
  usedDescription: string;
  usedTitle: string;
  workspaceLabel: string;
  workspaceLimitDescription: string;
  workspaceLimitTitle: string;
};

function readAndRemoveToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  return token;
}

function InvitationSummary({
  email,
  invitedBy,
  labels,
  workspace,
}: {
  email: string;
  invitedBy: string;
  labels: Pick<InviteLabels, 'inviteEmailLabel' | 'invitedByLabel' | 'workspaceLabel'>;
  workspace: string;
}) {
  return (
    <dl className="bg-surface-2 flex flex-col gap-3 rounded-lg px-4 py-3">
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs">{labels.workspaceLabel}</dt>
        <dd className="font-medium">{workspace}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs">{labels.invitedByLabel}</dt>
        <dd>{invitedBy}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted-foreground text-xs">{labels.inviteEmailLabel}</dt>
        <dd>{email}</dd>
      </div>
    </dl>
  );
}

export function InviteScreen({
  invitationSignUpHref,
  labels,
  loginHref,
  signUpHref,
}: {
  invitationSignUpHref: string;
  labels: InviteLabels;
  loginHref: string;
  signUpHref: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const didStart = useRef(false);
  const didRecoverUsedPreview = useRef(false);
  const rawToken = useRef<string | null>(null);
  const [previewSource, setPreviewSource] = useState<'loading' | 'start' | 'current'>('loading');
  const [isRecoveringSession, setIsRecoveringSession] = useState(false);
  const [isAutoRecovering, setIsAutoRecovering] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const startContinuation = useInvitationAuthControllerStartContinuation();
  const currentContinuation = useInvitationAuthControllerGetContinuation({
    query: { enabled: previewSource === 'current', retry: false },
  });
  const dismissContinuation = useInvitationAuthControllerDismissContinuation();
  const accept = useInvitationAuthControllerAccept();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const sessionCsrfToken = session.data?.authenticated ? session.data.csrfToken : null;
  const isSessionResolved = session.data !== undefined;

  useEffect(() => {
    if (isSessionResolved) {
      setCsrfToken(sessionCsrfToken);
    }
  }, [isSessionResolved, sessionCsrfToken]);

  useEffect(() => {
    if (didStart.current) {
      return;
    }
    didStart.current = true;
    const invitationToken = readAndRemoveToken();
    queueMicrotask(() => {
      if (invitationToken) {
        rawToken.current = invitationToken;
        setPreviewSource('start');
        startContinuation.mutate(
          { data: { token: invitationToken } },
          { onSuccess: () => (rawToken.current = null) },
        );
        return;
      }
      setPreviewSource('current');
    });
  }, [startContinuation]);

  const goToWorkspace = useCallback(() => {
    setIsLeaving(true);
    router.replace('/my-issues');
  }, [router]);

  const preview =
    previewSource === 'start'
      ? startContinuation
      : previewSource === 'current'
        ? currentContinuation
        : null;
  const previewErrorCode = preview?.error?.body?.code;
  useEffect(() => {
    if (previewErrorCode !== 'TOKEN_ALREADY_USED' || didRecoverUsedPreview.current) {
      return;
    }

    didRecoverUsedPreview.current = true;
    setIsAutoRecovering(true);
    void session.refetch().then((refreshedSession) => {
      if (refreshedSession.data?.authenticated && refreshedSession.data.membership) {
        goToWorkspace();
        return;
      }
      setIsAutoRecovering(false);
    });
  }, [goToWorkspace, previewErrorCode, session]);

  const acceptInvitation = () => {
    if (accept.isPending) {
      return;
    }

    accept.reset();
    accept.mutate(undefined, {
      onSuccess: async () => {
        setIsLeaving(true);
        await queryClient.invalidateQueries({
          queryKey: getAuthControllerGetSessionQueryKey(),
        });
        router.replace('/my-issues');
      },
      onError: async (error) => {
        if (
          error.body?.code !== 'TOKEN_ALREADY_USED' &&
          error.body?.code !== 'WORKSPACE_LIMIT_REACHED'
        ) {
          return;
        }

        setIsRecoveringSession(true);
        const refreshedSession = await session.refetch();
        if (refreshedSession.data?.authenticated && refreshedSession.data.membership) {
          goToWorkspace();
          return;
        }
        setIsRecoveringSession(false);
      },
    });
  };

  const recoverSession = async () => {
    setIsRecoveringSession(true);
    const refreshedSession = await session.refetch();
    if (refreshedSession.data?.authenticated && refreshedSession.data.membership) {
      goToWorkspace();
      return;
    }
    setIsRecoveringSession(false);
  };

  const continueInCurrentWorkspace = () => {
    if (dismissContinuation.isPending) {
      return;
    }
    dismissContinuation.mutate(undefined, {
      onSuccess: async () => {
        setIsLeaving(true);
        await queryClient.invalidateQueries({ queryKey: getAuthControllerGetSessionQueryKey() });
        router.replace('/my-issues');
      },
    });
  };

  if (
    isLeaving ||
    isAutoRecovering ||
    previewSource === 'loading' ||
    (preview && !preview.data && !preview.error)
  ) {
    return (
      <AuthFrame labels={labels}>
        <div role="status" className="text-muted-foreground flex items-center justify-center gap-2">
          <Spinner aria-hidden="true" />
          {isLeaving
            ? labels.redirecting
            : isAutoRecovering
              ? labels.sessionLoading
              : labels.loading}
        </div>
      </AuthFrame>
    );
  }

  if (!preview?.data) {
    const code = preview?.error?.body?.code;
    const isUsed = code === 'TOKEN_ALREADY_USED';
    const isExpired = code === 'TOKEN_EXPIRED';
    const isInvalid = code === 'TOKEN_INVALID' || code === 'INVITATION_CONTINUATION_NOT_FOUND';
    const isUnexpected = Boolean(preview?.error && !isUsed && !isExpired && !isInvalid);

    return (
      <AuthFrame labels={labels}>
        <div className="flex flex-col gap-5">
          <Alert variant={isUsed ? 'default' : 'destructive'}>
            <AlertTitle>
              {isUsed
                ? labels.usedTitle
                : isExpired
                  ? labels.expiredTitle
                  : isInvalid
                    ? labels.invalidTitle
                    : labels.unexpectedTitle}
            </AlertTitle>
            <AlertDescription>
              {isUsed
                ? labels.usedDescription
                : isExpired
                  ? labels.expiredDescription
                  : isInvalid
                    ? labels.invalidDescription
                    : labels.unexpectedDescription}
            </AlertDescription>
          </Alert>

          {isUnexpected ? (
            <Button
              type="button"
              variant="outline"
              disabled={preview?.isPending}
              onClick={() => {
                if (previewSource === 'start' && rawToken.current) {
                  startContinuation.reset();
                  startContinuation.mutate(
                    { data: { token: rawToken.current } },
                    { onSuccess: () => (rawToken.current = null) },
                  );
                } else if (previewSource === 'current') {
                  void currentContinuation.refetch();
                }
              }}
            >
              {preview?.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {labels.retry}
            </Button>
          ) : null}

          {isUsed && session.data?.authenticated && session.data.membership ? (
            <Button type="button" size="lg" onClick={continueInCurrentWorkspace}>
              {labels.currentWorkspace}
            </Button>
          ) : (
            <>
              {isUsed ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isRecoveringSession}
                  onClick={() => void recoverSession()}
                >
                  {isRecoveringSession ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : null}
                  {labels.retry}
                </Button>
              ) : null}
              <p className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
                <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
                <AuthLink href={signUpHref}>{labels.signUpLink}</AuthLink>
              </p>
            </>
          )}
        </div>
      </AuthFrame>
    );
  }

  const authenticatedSession = session.data?.authenticated ? session.data : null;
  const acceptErrorCode = accept.error?.body?.code;
  const hasWorkspace = Boolean(authenticatedSession?.membership);
  const cannotRetryAccept =
    acceptErrorCode === 'INVITATION_EMAIL_MISMATCH' ||
    acceptErrorCode === 'WORKSPACE_LIMIT_REACHED' ||
    acceptErrorCode === 'TOKEN_ALREADY_USED' ||
    acceptErrorCode === 'TOKEN_EXPIRED' ||
    acceptErrorCode === 'TOKEN_INVALID';

  return (
    <AuthFrame labels={labels}>
      <div className="flex flex-col gap-5">
        <InvitationSummary
          email={preview.data.emailMasked}
          invitedBy={preview.data.invitedByDisplayName}
          labels={labels}
          workspace={preview.data.workspaceName}
        />

        {session.isPending ? (
          <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner aria-hidden="true" />
            {labels.sessionLoading}
          </div>
        ) : session.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.sessionErrorTitle}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{labels.sessionErrorDescription}</span>
              <Button type="button" variant="outline" onClick={() => void session.refetch()}>
                {labels.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : !authenticatedSession ? (
          <>
            <Alert>
              <AlertTitle>
                {preview.data.nextAction === 'SIGN_UP'
                  ? labels.signUpRequiredTitle
                  : labels.loginRequiredTitle}
              </AlertTitle>
              <AlertDescription>
                {preview.data.nextAction === 'SIGN_UP'
                  ? labels.signUpRequiredDescription
                  : labels.loginRequiredDescription}
              </AlertDescription>
            </Alert>
            <Button
              render={
                <Link
                  href={preview.data.nextAction === 'SIGN_UP' ? invitationSignUpHref : loginHref}
                />
              }
              size="lg"
              className="w-full"
            >
              {preview.data.nextAction === 'SIGN_UP' ? labels.signUpLink : labels.loginLink}
            </Button>
          </>
        ) : hasWorkspace ? (
          <>
            <Alert variant="destructive">
              <AlertTitle>{labels.workspaceLimitTitle}</AlertTitle>
              <AlertDescription>{labels.workspaceLimitDescription}</AlertDescription>
            </Alert>
            <Button
              type="button"
              size="lg"
              disabled={dismissContinuation.isPending}
              onClick={continueInCurrentWorkspace}
            >
              {dismissContinuation.isPending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              {labels.currentWorkspace}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">{labels.currentAccountLabel}</span>
              <span>{authenticatedSession.user.email}</span>
            </div>

            {acceptErrorCode === 'INVITATION_EMAIL_MISMATCH' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.emailMismatchTitle}</AlertTitle>
                <AlertDescription>
                  {labels.emailMismatchDescription}{' '}
                  <AuthLink href={loginHref}>{labels.accountSwitchLink}</AuthLink>
                </AlertDescription>
              </Alert>
            ) : acceptErrorCode === 'WORKSPACE_LIMIT_REACHED' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.workspaceLimitTitle}</AlertTitle>
                <AlertDescription>{labels.workspaceLimitDescription}</AlertDescription>
              </Alert>
            ) : acceptErrorCode === 'TOKEN_ALREADY_USED' ? (
              <Alert>
                <AlertTitle>{labels.usedTitle}</AlertTitle>
                <AlertDescription>{labels.usedDescription}</AlertDescription>
              </Alert>
            ) : acceptErrorCode === 'TOKEN_EXPIRED' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.expiredTitle}</AlertTitle>
                <AlertDescription>{labels.expiredDescription}</AlertDescription>
              </Alert>
            ) : acceptErrorCode === 'TOKEN_INVALID' ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.invalidTitle}</AlertTitle>
                <AlertDescription>{labels.invalidDescription}</AlertDescription>
              </Alert>
            ) : acceptErrorCode ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.unexpectedTitle}</AlertTitle>
                <AlertDescription>{labels.unexpectedDescription}</AlertDescription>
              </Alert>
            ) : null}

            {(acceptErrorCode === 'TOKEN_ALREADY_USED' ||
              acceptErrorCode === 'WORKSPACE_LIMIT_REACHED') &&
            !hasWorkspace ? (
              <Button
                type="button"
                variant="outline"
                disabled={isRecoveringSession}
                onClick={() => void recoverSession()}
              >
                {isRecoveringSession ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {labels.retry}
              </Button>
            ) : null}

            {!cannotRetryAccept || !acceptErrorCode ? (
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={accept.isPending}
                onClick={acceptInvitation}
              >
                {accept.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
                {labels.accept}
              </Button>
            ) : null}
            {accept.isPending ? (
              <span role="status" className="sr-only">
                {labels.accepting}
              </span>
            ) : null}
          </>
        )}
      </div>
    </AuthFrame>
  );
}
