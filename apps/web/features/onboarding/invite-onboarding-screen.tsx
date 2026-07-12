'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAuthControllerGetSession, useInvitationsControllerCreate } from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/i18n/navigation';

import { OnboardingFrame, type OnboardingFrameLabels } from './onboarding-frame';

type InviteOnboardingLabels = OnboardingFrameLabels & {
  alreadyInvited: string;
  alreadyMember: string;
  description: string;
  emailDescription: string;
  emailInvalid: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailsRequired: string;
  errorDescription: string;
  errorTitle: string;
  failed: string;
  firstIssue: string;
  invited: string;
  limitExceeded: string;
  resultTitle: string;
  retryFailed: string;
  sessionErrorDescription: string;
  sessionErrorTitle: string;
  sessionLoadingDescription: string;
  sessionLoadingTitle: string;
  skip: string;
  submit: string;
  submitting: string;
  title: string;
  toMyIssues: string;
};

function normalizeInvitationEmails(value: string): string[] {
  const emails = new Map<string, string>();
  for (const valuePart of value.split(/[\n,]+/)) {
    const email = valuePart.trim();
    if (email && !emails.has(email.toLowerCase())) {
      emails.set(email.toLowerCase(), email);
    }
  }
  return [...emails.values()];
}

export function InviteOnboardingScreen({ labels }: { labels: InviteOnboardingLabels }) {
  const router = useRouter();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const mutation = useInvitationsControllerCreate();
  const email = z.email();
  const schema = z.object({
    emails: z.string().superRefine((value, context) => {
      const normalized = normalizeInvitationEmails(value);
      if (normalized.length === 0) {
        context.addIssue({ code: 'custom', message: labels.emailsRequired });
        return;
      }
      if (normalized.length > 50) {
        context.addIssue({ code: 'custom', message: labels.limitExceeded });
      }
      if (normalized.some((candidate) => !email.safeParse(candidate).success)) {
        context.addIssue({ code: 'custom', message: labels.emailInvalid });
      }
    }),
  });
  const {
    clearErrors,
    formState: { errors },
    handleSubmit,
    register,
    setError,
    setFocus,
    setValue,
  } = useForm<{ emails: string }>({
    defaultValues: { emails: '' },
    resolver: zodResolver(schema),
  });
  const membership =
    session.data?.authenticated &&
    session.data.membership?.role === 'ADMIN' &&
    session.data.membership.status === 'ACTIVE'
      ? session.data.membership
      : null;
  const results = mutation.data?.items ?? null;
  const failedEmails = results
    ?.filter((result) => result.result === 'FAILED')
    .map((result) => result.email);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusEmailsAfterReset = useRef(false);

  useEffect(() => {
    if (results) {
      resultHeadingRef.current?.focus();
    }
  }, [results]);

  useEffect(() => {
    if (!results && focusEmailsAfterReset.current) {
      focusEmailsAfterReset.current = false;
      setFocus('emails');
    }
  }, [results, setFocus]);

  const submit = handleSubmit((values) => {
    if (!membership || mutation.isPending) {
      return;
    }

    clearErrors('emails');
    mutation.reset();
    mutation.mutate(
      { data: { emails: normalizeInvitationEmails(values.emails) } },
      {
        onError: (error) => {
          if (error.body?.fieldErrors?.emails?.length) {
            setError(
              'emails',
              { message: labels.emailInvalid, type: 'server' },
              { shouldFocus: true },
            );
          }
        },
      },
    );
  });

  const resultLabel = {
    ALREADY_INVITED: labels.alreadyInvited,
    ALREADY_MEMBER: labels.alreadyMember,
    FAILED: labels.failed,
    INVITED: labels.invited,
  } as const;

  return (
    <OnboardingFrame currentStep={3} labels={labels}>
      <form noValidate aria-busy={mutation.isPending} onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{labels.title}</h1>
            </CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {session.isPending ? (
              <Alert>
                <Spinner aria-label={labels.sessionLoadingTitle} />
                <AlertTitle>{labels.sessionLoadingTitle}</AlertTitle>
                <AlertDescription>{labels.sessionLoadingDescription}</AlertDescription>
              </Alert>
            ) : null}
            {!session.isPending && (session.isError || !membership) ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.sessionErrorTitle}</AlertTitle>
                <AlertDescription>{labels.sessionErrorDescription}</AlertDescription>
              </Alert>
            ) : null}

            {membership && !results ? (
              <>
                {mutation.isError && !errors.emails ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.errorTitle}</AlertTitle>
                    <AlertDescription>{labels.errorDescription}</AlertDescription>
                  </Alert>
                ) : null}
                <Field data-invalid={Boolean(errors.emails)}>
                  <FieldLabel htmlFor="invite-emails">{labels.emailLabel}</FieldLabel>
                  <Textarea
                    id="invite-emails"
                    className="min-h-32 resize-y"
                    inputMode="email"
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="invite-emails-description invite-emails-error"
                    aria-errormessage={errors.emails ? 'invite-emails-error' : undefined}
                    aria-invalid={Boolean(errors.emails)}
                    placeholder={labels.emailPlaceholder}
                    {...register('emails')}
                  />
                  <FieldDescription id="invite-emails-description">
                    {labels.emailDescription}
                  </FieldDescription>
                  <FieldError id="invite-emails-error" errors={[errors.emails]} />
                </Field>
              </>
            ) : null}

            {results ? (
              <section aria-labelledby="invite-results-title" className="flex flex-col gap-3">
                <h2
                  ref={resultHeadingRef}
                  id="invite-results-title"
                  tabIndex={-1}
                  className="text-sm font-medium outline-none"
                >
                  {labels.resultTitle}
                </h2>
                <ul className="divide-border overflow-hidden rounded-lg border">
                  {results.map((result) => (
                    <li
                      key={result.email}
                      className="flex min-h-12 flex-col justify-center gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <span className="break-all">{result.email}</span>
                      <span className="text-muted-foreground shrink-0 text-sm">
                        {resultLabel[result.result]}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </CardContent>

          {membership ? (
            <CardFooter className="flex-col gap-3 sm:flex-row">
              {results ? (
                <>
                  <Button
                    type="button"
                    size="lg"
                    className="w-full sm:flex-1"
                    onClick={() => router.replace('/my-issues?create=1')}
                  >
                    {labels.firstIssue}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="w-full sm:flex-1"
                    onClick={() => router.replace('/my-issues')}
                  >
                    {labels.toMyIssues}
                  </Button>
                  {failedEmails && failedEmails.length > 0 ? (
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      className="w-full sm:flex-1"
                      onClick={() => {
                        setValue('emails', failedEmails.join('\n'), { shouldDirty: true });
                        focusEmailsAfterReset.current = true;
                        mutation.reset();
                      }}
                    >
                      {labels.retryFailed}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
                    disabled={mutation.isPending}
                    onClick={() => router.replace('/my-issues')}
                  >
                    {labels.skip}
                  </Button>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    {labels.submit}
                  </Button>
                </>
              )}
              {mutation.isPending ? (
                <span role="status" className="sr-only">
                  {labels.submitting}
                </span>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      </form>
    </OnboardingFrame>
  );
}
