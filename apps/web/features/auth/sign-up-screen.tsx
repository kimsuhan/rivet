'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAuthControllerSignUp } from '@rivet/api-client';

import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';
import { countUnicodeCodePoints, normalizePasswordInput } from './auth-validation';
import { PasswordInput } from './password-input';

type SignUpLabels = AuthFrameLabels & {
  displayName: string;
  email: string;
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
  labels,
  loginHref,
}: {
  forgotPasswordHref: string;
  labels: SignUpLabels;
  loginHref: string;
}) {
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

  if (signUp.data) {
    return (
      <AuthFrame
        labels={{ ...labels, title: labels.acceptedTitle, description: labels.acceptedDescription }}
      >
        <div className="space-y-6">
          <div className="border-border bg-surface-2 rounded-lg border px-4 py-3">
            <div className="text-muted-foreground text-xs">{labels.acceptedEmailLabel}</div>
            <div className="mt-1 font-medium">{signUp.data.emailMasked}</div>
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
    <AuthFrame labels={labels}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (signUp.isPending) return;
          signUp.mutate({
            data: {
              displayName: values.displayName.trim(),
              email: values.email.trim(),
              password: values.password,
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
          {signUp.isPending ? <Spinner aria-label={labels.submitting} /> : null}
          {labels.submit}
        </Button>

        <p className="text-muted-foreground text-center text-sm">
          {labels.loginPrompt} <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
        </p>
      </form>
    </AuthFrame>
  );
}
