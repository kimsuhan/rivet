'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAuthControllerRequestPasswordReset } from '@rivet/api-client';

import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

import { AuthFrame, type AuthFrameLabels, AuthLink } from './auth-frame';

type ForgotPasswordLabels = AuthFrameLabels & {
  email: string;
  submit: string;
  submitting: string;
  loginLink: string;
  completeTitle: string;
  completeDescription: string;
  emailInvalid: string;
  rateLimited: string;
  unexpectedError: string;
};

export function ForgotPasswordScreen({
  labels,
  loginHref,
}: {
  labels: ForgotPasswordLabels;
  loginHref: string;
}) {
  const form = useForm<{ email: string }>({
    resolver: zodResolver(
      z.object({ email: z.string().trim().pipe(z.email(labels.emailInvalid)) }),
    ),
    defaultValues: { email: '' },
  });
  const requestReset = useAuthControllerRequestPasswordReset({
    mutation: {
      onSuccess: () => form.clearErrors(),
      onError: (error) => {
        const message = error.body.fieldErrors.email?.[0];
        if (message) form.setError('email', { type: 'server', message }, { shouldFocus: true });
      },
    },
  });

  if (requestReset.isSuccess) {
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

  const formError = requestReset.error
    ? requestReset.error.body.code === 'RATE_LIMITED'
      ? labels.rateLimited
      : labels.unexpectedError
    : null;

  return (
    <AuthFrame labels={labels}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (requestReset.isPending) return;
          requestReset.mutate({ data: { email: values.email.trim() } });
        })}
      >
        <Field data-invalid={Boolean(form.formState.errors.email)}>
          <FieldLabel htmlFor="forgot-password-email">{labels.email}</FieldLabel>
          <Input
            id="forgot-password-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-errormessage={
              form.formState.errors.email ? 'forgot-password-email-error' : undefined
            }
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register('email')}
          />
          <FieldError id="forgot-password-email-error" errors={[form.formState.errors.email]} />
        </Field>

        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{formError}</AlertTitle>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={requestReset.isPending}>
          {requestReset.isPending ? <Spinner aria-label={labels.submitting} /> : null}
          {labels.submit}
        </Button>

        <p className="text-muted-foreground text-center text-sm">
          <AuthLink href={loginHref}>{labels.loginLink}</AuthLink>
        </p>
      </form>
    </AuthFrame>
  );
}
