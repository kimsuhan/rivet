'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { setCsrfToken, useAuthControllerConfirmPasswordReset } from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';
import { countUnicodeCodePoints, normalizePasswordInput } from './auth-validation';
import { PasswordInput } from './password-input';

type ResetPasswordLabels = AuthFrameLabels & {
  password: string;
  confirmPassword: string;
  passwordHelp: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitting: string;
  loading: string;
  passwordTooShort: string;
  passwordTooLong: string;
  passwordMismatch: string;
  invalidTitle: string;
  invalidDescription: string;
  expiredTitle: string;
  expiredDescription: string;
  requestNewLink: string;
  completeTitle: string;
  completeDescription: string;
  loginLink: string;
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

export function ResetPasswordScreen({
  labels,
  forgotPasswordHref,
  loginHref,
}: {
  labels: ResetPasswordLabels;
  forgotPasswordHref: string;
  loginHref: string;
}) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const didReadToken = useRef(false);
  const form = useForm<{ password: string; confirmPassword: string }>({
    resolver: zodResolver(
      z
        .object({
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
    defaultValues: { password: '', confirmPassword: '' },
  });
  const resetPassword = useAuthControllerConfirmPasswordReset({
    mutation: {
      onSuccess: () => {
        form.clearErrors();
        setCsrfToken(null);
      },
      onError: (error) => {
        const message = error.body.fieldErrors.password?.[0];
        if (message) form.setError('password', { type: 'server', message }, { shouldFocus: true });
      },
    },
  });

  useEffect(() => {
    if (didReadToken.current) return;
    didReadToken.current = true;
    setToken(readAndRemoveToken());
  }, []);

  if (token === undefined) {
    return (
      <AuthFrame labels={labels}>
        <div role="status" className="text-muted-foreground flex items-center justify-center gap-2">
          <Spinner aria-hidden="true" />
          {labels.loading}
        </div>
      </AuthFrame>
    );
  }

  if (resetPassword.isSuccess) {
    return (
      <AuthFrame
        labels={{ ...labels, title: labels.completeTitle, description: labels.completeDescription }}
      >
        <p className="text-muted-foreground text-center text-sm">
          <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
        </p>
      </AuthFrame>
    );
  }

  const tokenError = resetPassword.error?.body.code;
  const isExpired = tokenError === 'TOKEN_EXPIRED';
  const isInvalid =
    token === null || tokenError === 'TOKEN_INVALID' || tokenError === 'TOKEN_ALREADY_USED';

  if (isExpired || isInvalid) {
    return (
      <AuthFrame labels={labels}>
        <div className="space-y-6">
          <Alert variant="destructive">
            <AlertTitle>{isExpired ? labels.expiredTitle : labels.invalidTitle}</AlertTitle>
            <AlertDescription>
              {isExpired ? labels.expiredDescription : labels.invalidDescription}
            </AlertDescription>
          </Alert>
          <p className="text-muted-foreground text-center text-sm">
            <AuthLink href={forgotPasswordHref}>{labels.requestNewLink}</AuthLink>
          </p>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame labels={labels}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (resetPassword.isPending) return;
          resetPassword.mutate({ data: { token, password: values.password } });
        })}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.password)}>
            <FieldLabel htmlFor="reset-password">{labels.password}</FieldLabel>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              aria-describedby="reset-password-description"
              aria-errormessage={
                form.formState.errors.password ? 'reset-password-error' : undefined
              }
              aria-invalid={Boolean(form.formState.errors.password)}
              labels={{ show: labels.showPassword, hide: labels.hidePassword }}
              {...form.register('password')}
            />
            <FieldDescription id="reset-password-description">
              {labels.passwordHelp}
            </FieldDescription>
            <FieldError id="reset-password-error" errors={[form.formState.errors.password]} />
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}>
            <FieldLabel htmlFor="reset-confirm-password">{labels.confirmPassword}</FieldLabel>
            <PasswordInput
              id="reset-confirm-password"
              autoComplete="new-password"
              aria-errormessage={
                form.formState.errors.confirmPassword ? 'reset-confirm-password-error' : undefined
              }
              aria-invalid={Boolean(form.formState.errors.confirmPassword)}
              labels={{ show: labels.showPassword, hide: labels.hidePassword }}
              {...form.register('confirmPassword')}
            />
            <FieldError
              id="reset-confirm-password-error"
              errors={[form.formState.errors.confirmPassword]}
            />
          </Field>
        </FieldGroup>

        {resetPassword.error ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.unexpectedError}</AlertTitle>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? <Spinner aria-label={labels.submitting} /> : null}
          {labels.submit}
        </Button>
      </form>
    </AuthFrame>
  );
}
