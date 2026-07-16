'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  getAuthControllerGetSessionQueryKey,
  setCsrfToken,
  useAuthControllerLogin,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';
import { PasswordInput } from './password-input';

type LoginLabels = AuthFrameLabels & {
  email: string;
  password: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  forgotPassword: string;
  signUpPrompt: string;
  signUpLink: string;
  emailInvalid: string;
  passwordRequired: string;
  invalidCredentialsTitle: string;
  invalidCredentialsDescription: string;
  emailNotVerifiedTitle: string;
  emailNotVerifiedDescription: string;
  verifyEmailLink: string;
  membershipInactiveTitle: string;
  membershipInactiveDescription: string;
  rateLimited: string;
  unexpectedError: string;
};

export function LoginScreen({
  labels,
  forgotPasswordHref,
  signUpHref,
  verifyEmailHref,
  returnTo,
}: {
  labels: LoginLabels;
  forgotPasswordHref: string;
  signUpHref: string;
  verifyEmailHref: string;
  returnTo?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<{ email: string; password: string }>({
    resolver: zodResolver(
      z.object({
        email: z.string().trim().pipe(z.email(labels.emailInvalid)),
        password: z.string().min(1, labels.passwordRequired),
      }),
    ),
    defaultValues: { email: '', password: '' },
  });
  const login = useAuthControllerLogin({
    mutation: {
      onSuccess: (session) => {
        form.clearErrors();
        setCsrfToken(session.csrfToken);
        queryClient.setQueryData(getAuthControllerGetSessionQueryKey(), session);
        router.replace(
          session.onboardingStep === 'ACCEPT_INVITATION'
            ? '/invite'
            : session.onboardingStep === 'CREATE_WORKSPACE'
            ? '/onboarding/workspace'
            : session.onboardingStep === 'CREATE_TEAM'
              ? '/onboarding/team'
              : returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')
                ? returnTo
                : '/my-issues',
        );
      },
      onError: (error) => {
        const fieldErrors = error.body.fieldErrors;
        let shouldFocus = true;
        for (const field of ['email', 'password'] as const) {
          const message = fieldErrors[field]?.[0];
          if (message) {
            form.setError(field, { type: 'server', message }, { shouldFocus });
            shouldFocus = false;
          }
        }
      },
    },
  });

  const errorCode = login.error?.body.code;

  return (
    <AuthFrame labels={labels}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (login.isPending) return;
          login.mutate({ data: { email: values.email.trim(), password: values.password } });
        })}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.email)}>
            <FieldLabel htmlFor="login-email">{labels.email}</FieldLabel>
            <Input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              aria-errormessage={form.formState.errors.email ? 'login-email-error' : undefined}
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
            <FieldError id="login-email-error" errors={[form.formState.errors.email]} />
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.password)}>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="login-password">{labels.password}</FieldLabel>
              <AuthLink href={forgotPasswordHref}>{labels.forgotPassword}</AuthLink>
            </div>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              aria-errormessage={
                form.formState.errors.password ? 'login-password-error' : undefined
              }
              aria-invalid={Boolean(form.formState.errors.password)}
              labels={{ show: labels.showPassword, hide: labels.hidePassword }}
              {...form.register('password')}
            />
            <FieldError id="login-password-error" errors={[form.formState.errors.password]} />
          </Field>
        </FieldGroup>

        {errorCode === 'INVALID_CREDENTIALS' ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.invalidCredentialsTitle}</AlertTitle>
            <AlertDescription>{labels.invalidCredentialsDescription}</AlertDescription>
          </Alert>
        ) : errorCode === 'EMAIL_NOT_VERIFIED' ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.emailNotVerifiedTitle}</AlertTitle>
            <AlertDescription>
              {labels.emailNotVerifiedDescription}{' '}
              <AuthLink href={verifyEmailHref}>{labels.verifyEmailLink}</AuthLink>
            </AlertDescription>
          </Alert>
        ) : errorCode === 'MEMBERSHIP_INACTIVE' ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.membershipInactiveTitle}</AlertTitle>
            <AlertDescription>{labels.membershipInactiveDescription}</AlertDescription>
          </Alert>
        ) : errorCode ? (
          <Alert variant="destructive">
            <AlertTitle>
              {errorCode === 'RATE_LIMITED' ? labels.rateLimited : labels.unexpectedError}
            </AlertTitle>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          {login.isPending ? <Spinner aria-label={labels.submitting} /> : null}
          {labels.submit}
        </Button>

        <p className="text-muted-foreground text-center text-sm">
          {labels.signUpPrompt} <AuthLink href={signUpHref}>{labels.signUpLink}</AuthLink>
        </p>
      </form>
    </AuthFrame>
  );
}
