'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  getAuthControllerGetSessionQueryKey,
  setCsrfToken,
  useAuthControllerGetSession,
  useInvitationAuthControllerAccept,
  useInvitationAuthControllerPreview,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';

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
  reopenLinkDescription: string;
  retry: string;
  sessionErrorDescription: string;
  sessionErrorTitle: string;
  sessionLoading: string;
  signUpLink: string;
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
  labels,
  loginHref,
  signUpHref,
}: {
  labels: InviteLabels;
  loginHref: string;
  signUpHref: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const didPreview = useRef(false);
  const didRecoverUsedPreview = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<'loading' | 'missing' | 'submitted'>('loading');
  const [isRecoveringSession, setIsRecoveringSession] = useState(false);
  const preview = useInvitationAuthControllerPreview();
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
    if (didPreview.current) {
      return;
    }
    didPreview.current = true;
    const invitationToken = readAndRemoveToken();
    setToken(invitationToken);
    if (invitationToken) {
      preview.mutate({ data: { token: invitationToken } });
    }
    queueMicrotask(() => setTokenStatus(invitationToken ? 'submitted' : 'missing'));
  }, [preview]);

  const previewErrorCode = preview.error?.body?.code;
  useEffect(() => {
    if (previewErrorCode !== 'TOKEN_ALREADY_USED' || didRecoverUsedPreview.current) {
      return;
    }

    didRecoverUsedPreview.current = true;
    setIsRecoveringSession(true);
    void session.refetch().then((refreshedSession) => {
      setIsRecoveringSession(false);
      if (refreshedSession.data?.authenticated && refreshedSession.data.membership) {
        router.replace('/my-issues');
      }
    });
  }, [previewErrorCode, router, session]);

  const acceptInvitation = () => {
    if (!token || accept.isPending) {
      return;
    }

    accept.reset();
    accept.mutate(
      { data: { token } },
      {
        onSuccess: async () => {
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
          setIsRecoveringSession(false);
          if (refreshedSession.data?.authenticated && refreshedSession.data.membership) {
            router.replace('/my-issues');
          }
        },
      },
    );
  };

  const recoverSession = async () => {
    setIsRecoveringSession(true);
    const refreshedSession = await session.refetch();
    setIsRecoveringSession(false);
    if (refreshedSession.data?.authenticated && refreshedSession.data.membership) {
      router.replace('/my-issues');
    }
  };

  if (
    tokenStatus === 'loading' ||
    (tokenStatus === 'submitted' && !preview.data && !preview.error)
  ) {
    return (
      <AuthFrame labels={labels}>
        <div role="status" className="text-muted-foreground flex items-center justify-center gap-2">
          <Spinner aria-hidden="true" />
          {labels.loading}
        </div>
      </AuthFrame>
    );
  }

  if (!preview.data) {
    const code = preview.error?.body?.code;
    const isUsed = code === 'TOKEN_ALREADY_USED';
    const isExpired = code === 'TOKEN_EXPIRED';
    const isInvalid = code === 'TOKEN_INVALID' || tokenStatus === 'missing';
    const isUnexpected = Boolean(preview.error && !isUsed && !isExpired && !isInvalid);

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
              disabled={!token || preview.isPending}
              onClick={() => {
                if (token) {
                  preview.reset();
                  preview.mutate({ data: { token } });
                }
              }}
            >
              {preview.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {labels.retry}
            </Button>
          ) : null}

          {isUsed && session.data?.authenticated && session.data.membership ? (
            <Button type="button" size="lg" onClick={() => router.replace('/my-issues')}>
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
              <AlertTitle>{labels.loginRequiredTitle}</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>{labels.loginRequiredDescription}</span>
                <span>{labels.reopenLinkDescription}</span>
              </AlertDescription>
            </Alert>
            <p className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
              <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
              <AuthLink href={signUpHref}>{labels.signUpLink}</AuthLink>
            </p>
          </>
        ) : hasWorkspace ? (
          <>
            <Alert variant="destructive">
              <AlertTitle>{labels.workspaceLimitTitle}</AlertTitle>
              <AlertDescription>{labels.workspaceLimitDescription}</AlertDescription>
            </Alert>
            <Button type="button" size="lg" onClick={() => router.replace('/my-issues')}>
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
