'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  getAuthControllerGetSessionQueryKey,
  setCsrfToken,
  useAuthControllerLogin,
  useAuthControllerResendEmailVerification,
  useAuthControllerSignUp,
  useInvitationAuthControllerAccept,
  useInvitationAuthControllerGetContinuation,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';
import { countUnicodeCodePoints, normalizePasswordInput } from './auth-validation';
import { PasswordInput } from './password-input';

type SignUpLabels = AuthFrameLabels & {
  displayName: string;
  email: string;
  invitationLoading: string;
  invitationDescription: string;
  invitationEmailDescription: string;
  invitationEmailFixed: string;
  invitationCompleting: string;
  invitationErrorTitle: string;
  invitationErrorDescription: string;
  invitationSubmit: string;
  password: string;
  confirmPassword: string;
  passwordHelp: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  loginPrompt: string;
  loginLink: string;
  passwordResetLink: string;
  acceptedTitle: string;
  acceptedDescription: string;
  acceptedEmailLabel: string;
  resend: string;
  resending: string;
  resentTitle: string;
  resentDescription: string;
  resendRateLimited: string;
  resendUnexpectedError: string;
  displayNameRequired: string;
  displayNameTooLong: string;
  emailInvalid: string;
  passwordTooShort: string;
  passwordTooLong: string;
  passwordMismatch: string;
  rateLimited: string;
  unexpectedError: string;
};

export function SignUpScreen({
  forgotPasswordHref,
  isInvitationSignUp = false,
  labels,
  loginHref,
}: {
  forgotPasswordHref: string;
  isInvitationSignUp?: boolean;
  labels: SignUpLabels;
  loginHref: string;
}) {
  const t = useTranslations('Auth.signUp');
  const queryClient = useQueryClient();
  const router = useRouter();
  const [resendRetryAfterSeconds, setResendRetryAfterSeconds] = useState(0);
  const invitationContinuation = useInvitationAuthControllerGetContinuation({
    query: { enabled: isInvitationSignUp, retry: false },
  });
  const invitedEmail = invitationContinuation.data?.email;
  const form = useForm<{
    displayName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }>({
    mode: 'onBlur',
    resolver: zodResolver(
      z
        .object({
          displayName: z
            .string()
            .transform((value) => value.trim())
            .refine((value) => countUnicodeCodePoints(value) >= 1, {
              message: labels.displayNameRequired,
            })
            .refine((value) => countUnicodeCodePoints(value) <= 50, {
              message: labels.displayNameTooLong,
            }),
          email: z.string().trim().pipe(z.email(labels.emailInvalid)),
          password: z
            .string()
            .transform(normalizePasswordInput)
            .refine((value) => countUnicodeCodePoints(value) >= 12, {
              message: labels.passwordTooShort,
            })
            .refine((value) => countUnicodeCodePoints(value) <= 128, {
              message: labels.passwordTooLong,
            }),
          confirmPassword: z.string().transform(normalizePasswordInput),
        })
        .refine((values) => values.password === values.confirmPassword, {
          path: ['confirmPassword'],
          message: labels.passwordMismatch,
        }),
    ),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  });
  const signUp = useAuthControllerSignUp({
    mutation: {
      onSuccess: () => form.clearErrors(),
      onError: (error) => {
        const fieldErrors = error.body.fieldErrors;
        let shouldFocus = true;
        for (const field of ['displayName', 'email', 'password'] as const) {
          const message = fieldErrors[field]?.[0];
          if (message) {
            form.setError(field, { type: 'server', message }, { shouldFocus });
            shouldFocus = false;
          }
        }
      },
    },
  });
  const invitationLogin = useAuthControllerLogin();
  const acceptInvitation = useInvitationAuthControllerAccept();
  const resendEmail = useAuthControllerResendEmailVerification({
    mutation: {
      onSuccess: () => setResendRetryAfterSeconds(0),
      onError: (error) => {
        setResendRetryAfterSeconds(
          error.body.code === 'RATE_LIMITED' ? (error.retryAfterSeconds ?? 0) : 0,
        );
      },
    },
  });

  const { setValue } = form;
  useEffect(() => {
    if (!invitedEmail) return;

    setValue('email', invitedEmail, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [invitedEmail, setValue]);

  useEffect(() => {
    if (resendRetryAfterSeconds <= 0) return;

    const timeout = window.setTimeout(
      () => setResendRetryAfterSeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );

    return () => window.clearTimeout(timeout);
  }, [resendRetryAfterSeconds]);

  const frameLabels = isInvitationSignUp
    ? { ...labels, description: labels.invitationDescription }
    : labels;

  if (isInvitationSignUp && invitationContinuation.isPending) {
    return (
      <AuthFrame labels={frameLabels}>
        <div role="status" className="text-muted-foreground flex items-center justify-center gap-2">
          <Spinner aria-hidden="true" />
          {labels.invitationLoading}
        </div>
      </AuthFrame>
    );
  }

  if (isInvitationSignUp && invitationContinuation.error) {
    return (
      <AuthFrame labels={frameLabels}>
        <Alert variant="destructive">
          <AlertTitle>{labels.invitationErrorTitle}</AlertTitle>
          <AlertDescription>{labels.invitationErrorDescription}</AlertDescription>
        </Alert>
      </AuthFrame>
    );
  }

  if (signUp.data) {
    if (isInvitationSignUp && signUp.data.nextStep === 'LOGIN') {
      return (
        <AuthFrame labels={frameLabels}>
          <div
            role="status"
            className="text-muted-foreground flex items-center justify-center gap-2"
          >
            <Spinner aria-hidden="true" />
            {labels.invitationCompleting}
          </div>
        </AuthFrame>
      );
    }

    return (
      <AuthFrame
        labels={{
          ...labels,
          title: labels.acceptedTitle,
          description: labels.acceptedDescription,
        }}
      >
        <div className="flex flex-col gap-6">
          <div className="border-border bg-surface-2 rounded-lg border px-4 py-3">
            <div className="text-muted-foreground text-xs">{labels.acceptedEmailLabel}</div>
            <div className="mt-1 font-medium">{signUp.data.emailMasked}</div>
          </div>

          <div className="flex flex-col gap-3">
            {resendEmail.data ? (
              <Alert>
                <AlertTitle>{labels.resentTitle}</AlertTitle>
                <AlertDescription>{labels.resentDescription}</AlertDescription>
              </Alert>
            ) : resendEmail.error || resendRetryAfterSeconds > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resendRetryAfterSeconds > 0
                    ? t('resendRateLimitedWithRetry', { seconds: resendRetryAfterSeconds })
                    : resendEmail.error?.body.code === 'RATE_LIMITED'
                      ? labels.resendRateLimited
                      : labels.resendUnexpectedError}
                </AlertTitle>
              </Alert>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled={resendEmail.isPending || resendRetryAfterSeconds > 0}
              onClick={() => {
                if (resendEmail.isPending || resendRetryAfterSeconds > 0) return;
                resendEmail.mutate({ data: { email: form.getValues('email').trim() } });
              }}
            >
              {resendEmail.isPending ? <Spinner aria-label={labels.resending} /> : null}
              {labels.resend}
            </Button>
          </div>

          <div className="text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
            <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
            <AuthLink href={forgotPasswordHref}>{labels.passwordResetLink}</AuthLink>
          </div>
        </div>
      </AuthFrame>
    );
  }

  const formError = signUp.error
    ? signUp.error.body.code === 'RATE_LIMITED'
      ? labels.rateLimited
      : labels.unexpectedError
    : null;

  return (
    <AuthFrame labels={frameLabels}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (signUp.isPending) return;
          const email = values.email.trim();
          const request = {
            data: {
              displayName: values.displayName.trim(),
              email,
              password: values.password,
            },
          };
          if (!isInvitationSignUp) {
            signUp.mutate(request);
            return;
          }
          signUp.mutate(request, {
            onSuccess: (result) => {
              if (result.nextStep !== 'LOGIN') return;

              invitationLogin.mutate(
                { data: { email, password: values.password } },
                {
                  onSuccess: (session) => {
                    setCsrfToken(session.csrfToken);
                    queryClient.setQueryData(getAuthControllerGetSessionQueryKey(), session);
                    acceptInvitation.mutate(undefined, {
                      onSuccess: async () => {
                        await queryClient.invalidateQueries({
                          queryKey: getAuthControllerGetSessionQueryKey(),
                        });
                        router.replace('/my-issues');
                      },
                      onError: () => router.replace('/invite'),
                    });
                  },
                  onError: () => router.replace(loginHref),
                },
              );
            },
          });
        })}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.displayName)}>
            <FieldLabel htmlFor="sign-up-display-name">{labels.displayName}</FieldLabel>
            <Input
              id="sign-up-display-name"
              autoComplete="name"
              aria-errormessage={
                form.formState.errors.displayName ? 'sign-up-display-name-error' : undefined
              }
              aria-invalid={Boolean(form.formState.errors.displayName)}
              {...form.register('displayName')}
            />
            <FieldError
              id="sign-up-display-name-error"
              errors={[form.formState.errors.displayName]}
            />
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.email)}>
            <FieldLabel htmlFor="sign-up-email">{labels.email}</FieldLabel>
            {invitedEmail ? (
              <InputGroup data-readonly="true">
                <InputGroupAddon>
                  <LockKeyhole aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="sign-up-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  readOnly
                  aria-describedby="sign-up-email-description"
                  aria-errormessage={
                    form.formState.errors.email ? 'sign-up-email-error' : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.email)}
                  {...form.register('email')}
                />
                <InputGroupAddon align="inline-end">
                  <Badge variant="secondary">{labels.invitationEmailFixed}</Badge>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <Input
                id="sign-up-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-errormessage={form.formState.errors.email ? 'sign-up-email-error' : undefined}
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register('email')}
              />
            )}
            {invitedEmail ? (
              <FieldDescription id="sign-up-email-description">
                {labels.invitationEmailDescription}
              </FieldDescription>
            ) : null}
            <FieldError id="sign-up-email-error" errors={[form.formState.errors.email]} />
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.password)}>
            <FieldLabel htmlFor="sign-up-password">{labels.password}</FieldLabel>
            <PasswordInput
              id="sign-up-password"
              autoComplete="new-password"
              excludeToggleFromTabOrder
              aria-describedby="sign-up-password-description"
              aria-errormessage={
                form.formState.errors.password ? 'sign-up-password-error' : undefined
              }
              aria-invalid={Boolean(form.formState.errors.password)}
              labels={{ show: labels.showPassword, hide: labels.hidePassword }}
              {...form.register('password')}
            />
            <FieldDescription id="sign-up-password-description">
              {labels.passwordHelp}
            </FieldDescription>
            <FieldError id="sign-up-password-error" errors={[form.formState.errors.password]} />
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}>
            <FieldLabel htmlFor="sign-up-confirm-password">{labels.confirmPassword}</FieldLabel>
            <PasswordInput
              id="sign-up-confirm-password"
              autoComplete="new-password"
              excludeToggleFromTabOrder
              aria-errormessage={
                form.formState.errors.confirmPassword ? 'sign-up-confirm-password-error' : undefined
              }
              aria-invalid={Boolean(form.formState.errors.confirmPassword)}
              labels={{ show: labels.showPassword, hide: labels.hidePassword }}
              {...form.register('confirmPassword')}
            />
            <FieldError
              id="sign-up-confirm-password-error"
              errors={[form.formState.errors.confirmPassword]}
            />
          </Field>
        </FieldGroup>

        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{formError}</AlertTitle>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={signUp.isPending}>
          {signUp.isPending ? (
            <Spinner
              aria-label={isInvitationSignUp ? labels.invitationCompleting : labels.submitting}
            />
          ) : null}
          {isInvitationSignUp ? labels.invitationSubmit : labels.submit}
        </Button>

        <p className="text-muted-foreground text-center text-sm">
          {labels.loginPrompt} <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
        </p>
      </form>
    </AuthFrame>
  );
}
