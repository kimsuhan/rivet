'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  useAuthControllerResendEmailVerification,
  useAuthControllerVerifyEmail,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';

type VerifyEmailLabels = AuthFrameLabels & {
  loading: string;
  successTitle: string;
  successDescription: string;
  alreadyUsedTitle: string;
  alreadyUsedDescription: string;
  expiredTitle: string;
  expiredDescription: string;
  invalidTitle: string;
  invalidDescription: string;
  loginLink: string;
  signUpLink: string;
  resendEmail: string;
  email: string;
  emailInvalid: string;
  resend: string;
  resending: string;
  resentTitle: string;
  resentDescription: string;
  resentEmailLabel: string;
  rateLimited: string;
  retry: string;
  unexpectedError: string;
};

function readAndRemoveToken(): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token');
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  return token;
}

export function VerifyEmailScreen({
  labels,
  loginHref,
  signUpHref,
}: {
  labels: VerifyEmailLabels;
  loginHref: string;
  signUpHref: string;
}) {
  const t = useTranslations('Auth.verifyEmail');
  const didVerify = useRef(false);
  const [resendRetryAfterSeconds, setResendRetryAfterSeconds] = useState(0);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<'loading' | 'missing' | 'submitted'>('loading');
  const verifyEmail = useAuthControllerVerifyEmail();
  const form = useForm<{ email: string }>({
    resolver: zodResolver(
      z.object({ email: z.string().trim().pipe(z.email(labels.emailInvalid)) }),
    ),
    defaultValues: { email: '' },
  });
  const resendEmail = useAuthControllerResendEmailVerification({
    mutation: {
      onSuccess: () => {
        setResendRetryAfterSeconds(0);
        form.clearErrors();
      },
      onError: (error) => {
        setResendRetryAfterSeconds(
          error.body.code === 'RATE_LIMITED' ? (error.retryAfterSeconds ?? 0) : 0,
        );
        const message = error.body.fieldErrors.email?.[0];
        if (message) form.setError('email', { type: 'server', message }, { shouldFocus: true });
      },
    },
  });

  useEffect(() => {
    if (resendRetryAfterSeconds <= 0) {
      return;
    }

    const timeout = window.setTimeout(
      () => setResendRetryAfterSeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );

    return () => window.clearTimeout(timeout);
  }, [resendRetryAfterSeconds]);

  useEffect(() => {
    if (didVerify.current) return;
    didVerify.current = true;
    const token = readAndRemoveToken();
    setVerificationToken(token);
    if (token) {
      verifyEmail.mutate({ data: { token } });
    }
    queueMicrotask(() => setTokenStatus(token ? 'submitted' : 'missing'));
  }, [verifyEmail]);

  if (
    tokenStatus === 'loading' ||
    (tokenStatus === 'submitted' && !verifyEmail.isSuccess && !verifyEmail.error)
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

  if (verifyEmail.isSuccess) {
    return (
      <AuthFrame
        labels={{ ...labels, title: labels.successTitle, description: labels.successDescription }}
      >
        <p className="text-muted-foreground text-center text-sm">
          <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
        </p>
      </AuthFrame>
    );
  }

  const errorCode = verifyEmail.error?.body?.code;
  const isAlreadyUsed = errorCode === 'TOKEN_ALREADY_USED';
  const isExpired = errorCode === 'TOKEN_EXPIRED';
  const isInvalid = errorCode === 'TOKEN_INVALID' || (tokenStatus === 'missing' && !errorCode);
  const isUnexpected = Boolean(
    verifyEmail.error && !isAlreadyUsed && !isExpired && errorCode !== 'TOKEN_INVALID',
  );
  const shouldOfferResend = isExpired || isInvalid;

  return (
    <AuthFrame labels={labels}>
      <div className="space-y-6">
        {isAlreadyUsed ? (
          <Alert>
            <AlertTitle>{labels.alreadyUsedTitle}</AlertTitle>
            <AlertDescription>{labels.alreadyUsedDescription}</AlertDescription>
          </Alert>
        ) : isExpired || isInvalid ? (
          <Alert variant="destructive">
            <AlertTitle>{isExpired ? labels.expiredTitle : labels.invalidTitle}</AlertTitle>
            <AlertDescription>
              {isExpired ? labels.expiredDescription : labels.invalidDescription}
            </AlertDescription>
          </Alert>
        ) : isUnexpected ? (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTitle>{labels.unexpectedError}</AlertTitle>
            </Alert>
            <Button
              type="button"
              variant="outline"
              disabled={!verificationToken || verifyEmail.isPending}
              onClick={() => {
                if (verificationToken) {
                  verifyEmail.mutate({ data: { token: verificationToken } });
                }
              }}
            >
              {labels.retry}
            </Button>
          </div>
        ) : null}

        {resendEmail.data ? (
          <div className="space-y-3">
            <Alert>
              <AlertTitle>{labels.resentTitle}</AlertTitle>
              <AlertDescription>{labels.resentDescription}</AlertDescription>
            </Alert>
            <div className="border-border bg-surface-2 rounded-lg border px-4 py-3">
              <div className="text-muted-foreground text-xs">{labels.resentEmailLabel}</div>
              <div className="mt-1 font-medium">{resendEmail.data.emailMasked}</div>
            </div>
          </div>
        ) : shouldOfferResend ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={form.handleSubmit((values) => {
              if (resendEmail.isPending) return;
              resendEmail.mutate({ data: { email: values.email.trim() } });
            })}
          >
            <h2 className="text-sm font-medium">{labels.resendEmail}</h2>
            <Field data-invalid={Boolean(form.formState.errors.email)}>
              <FieldLabel htmlFor="verify-email-resend">{labels.email}</FieldLabel>
              <Input
                id="verify-email-resend"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-errormessage={
                  form.formState.errors.email ? 'verify-email-resend-error' : undefined
                }
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register('email')}
              />
              <FieldError id="verify-email-resend-error" errors={[form.formState.errors.email]} />
            </Field>
            {resendEmail.error || resendRetryAfterSeconds > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resendRetryAfterSeconds > 0
                    ? t('rateLimitedWithRetry', { seconds: resendRetryAfterSeconds })
                    : resendEmail.error?.body.code === 'RATE_LIMITED'
                      ? labels.rateLimited
                      : labels.unexpectedError}
                </AlertTitle>
              </Alert>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={resendEmail.isPending || resendRetryAfterSeconds > 0}
            >
              {resendEmail.isPending ? <Spinner aria-label={labels.resending} /> : null}
              {labels.resend}
            </Button>
          </form>
        ) : null}

        <div className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
          <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
          {isAlreadyUsed ? null : <AuthLink href={signUpHref}>{labels.signUpLink}</AuthLink>}
        </div>
      </div>
    </AuthFrame>
  );
}
