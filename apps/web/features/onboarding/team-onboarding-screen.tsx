'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { useAuthControllerGetSession, useTeamsControllerCreate } from '@rivet/api-client';

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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { createTeamKey, normalizeTeamKey } from '@/features/teams/team-key';

import { OnboardingFrame, type OnboardingFrameLabels } from './onboarding-frame';

type TeamOnboardingLabels = OnboardingFrameLabels & {
  creatorDescription: string;
  creatorTitle: string;
  description: string;
  errorDescription: string;
  errorTitle: string;
  issueIdExampleLabel: string;
  issueIdPlaceholder: string;
  keyFormat: string;
  keyImmutableDescription: string;
  keyInUse: string;
  keyLabel: string;
  keyPlaceholder: string;
  nameInUse: string;
  nameInvalid: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  nameTooLong: string;
  sessionErrorDescription: string;
  sessionErrorTitle: string;
  sessionLoadingDescription: string;
  sessionLoadingTitle: string;
  submit: string;
  submitting: string;
  title: string;
};

export function TeamOnboardingScreen({ labels }: { labels: TeamOnboardingLabels }) {
  const hasEditedKey = useRef(false);
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const mutation = useTeamsControllerCreate();
  const schema = z.object({
    key: z
      .string()
      .trim()
      .regex(/^[A-Z]{2,5}$/, labels.keyFormat),
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
  });
  const {
    clearErrors,
    control,
    formState: { errors },
    handleSubmit,
    register,
    setError,
    setFocus,
    setValue,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { key: '', name: '' },
    resolver: zodResolver(schema),
  });
  const nameField = register('name');
  const keyField = register('key');
  const key = useWatch({ control, name: 'key' });
  const membership =
    !session.isPending &&
    session.data?.authenticated &&
    session.data.membership?.role === 'ADMIN' &&
    session.data.membership.status === 'ACTIVE'
      ? session.data.membership
      : null;
  const creatorName = session.data?.authenticated ? session.data.user.displayName : null;
  const hasMappedError = Boolean(
    mutation.error &&
    (mutation.error.body.code === 'TEAM_NAME_IN_USE' ||
      mutation.error.body.code === 'TEAM_KEY_IN_USE' ||
      mutation.error.body.fieldErrors.name?.length ||
      mutation.error.body.fieldErrors.key?.length),
  );

  const submit = handleSubmit((values) => {
    if (!membership || mutation.isPending) {
      return;
    }

    clearErrors(['key', 'name']);
    mutation.reset();
    mutation.mutate(
      { data: { ...values, memberIds: [membership.id] } },
      {
        onError: (error) => {
          const hasNameError = Boolean(error.body.fieldErrors.name?.length);
          const hasKeyError = Boolean(error.body.fieldErrors.key?.length);

          if (hasNameError || error.body.code === 'TEAM_NAME_IN_USE') {
            setError('name', {
              message:
                error.body.code === 'TEAM_NAME_IN_USE' ? labels.nameInUse : labels.nameInvalid,
              type: 'server',
            });
          }
          if (hasKeyError || error.body.code === 'TEAM_KEY_IN_USE') {
            setError('key', {
              message: error.body.code === 'TEAM_KEY_IN_USE' ? labels.keyInUse : labels.keyFormat,
              type: 'server',
            });
          }

          if (hasNameError || error.body.code === 'TEAM_NAME_IN_USE') {
            setFocus('name');
          } else if (hasKeyError || error.body.code === 'TEAM_KEY_IN_USE') {
            setFocus('key');
          }
        },
        onSuccess: () => {
          const pathname = globalThis.location.pathname;
          const invitePath = pathname.replace(/\/onboarding\/team\/?$/, '/onboarding/invite');
          globalThis.location.replace(invitePath === pathname ? '/onboarding/invite' : invitePath);
        },
      },
    );
  });

  return (
    <OnboardingFrame currentStep={2} labels={labels}>
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
            {!session.isPending && (session.isError || !membership || !creatorName) ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.sessionErrorTitle}</AlertTitle>
                <AlertDescription>{labels.sessionErrorDescription}</AlertDescription>
              </Alert>
            ) : null}
            {membership && creatorName ? (
              <>
                {mutation.isError && !hasMappedError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.errorTitle}</AlertTitle>
                    <AlertDescription>{labels.errorDescription}</AlertDescription>
                  </Alert>
                ) : null}
                <FieldGroup>
                  <Field data-invalid={Boolean(errors.name)}>
                    <FieldLabel htmlFor="team-name">{labels.nameLabel}</FieldLabel>
                    <Input
                      id="team-name"
                      autoComplete="off"
                      aria-describedby="team-name-error"
                      aria-invalid={Boolean(errors.name)}
                      placeholder={labels.namePlaceholder}
                      {...nameField}
                      onChange={(event) => {
                        nameField.onChange(event);

                        if (hasEditedKey.current) {
                          return;
                        }

                        setValue('key', createTeamKey(event.target.value), {
                          shouldDirty: true,
                          shouldValidate: Boolean(errors.key),
                        });
                      }}
                    />
                    <FieldError id="team-name-error" errors={[errors.name]} />
                  </Field>
                  <Field data-invalid={Boolean(errors.key)}>
                    <FieldLabel htmlFor="team-key">{labels.keyLabel}</FieldLabel>
                    <Input
                      id="team-key"
                      autoCapitalize="characters"
                      autoComplete="off"
                      aria-describedby="team-key-description team-key-error"
                      aria-invalid={Boolean(errors.key)}
                      maxLength={5}
                      placeholder={labels.keyPlaceholder}
                      spellCheck={false}
                      {...keyField}
                      onChange={(event) => {
                        const normalizedKey = normalizeTeamKey(event.target.value);
                        setValue('key', normalizedKey, {
                          shouldDirty: true,
                          shouldValidate: Boolean(errors.key),
                        });
                        hasEditedKey.current = true;
                      }}
                      onClick={(event) => {
                        if (!hasEditedKey.current) {
                          event.currentTarget.select();
                        }
                      }}
                      onFocus={(event) => {
                        if (!hasEditedKey.current) {
                          event.currentTarget.select();
                        }
                      }}
                    />
                    <FieldDescription id="team-key-description">
                      {labels.keyImmutableDescription}
                    </FieldDescription>
                    <FieldError id="team-key-error" errors={[errors.key]} />
                  </Field>
                </FieldGroup>
                <output
                  htmlFor="team-key"
                  aria-live="polite"
                  className="bg-surface-1 flex flex-col gap-1 rounded-md border px-3 py-2"
                >
                  <span className="text-muted-foreground text-xs">
                    {labels.issueIdExampleLabel}
                  </span>
                  <code className="text-foreground text-sm">
                    {key || labels.issueIdPlaceholder}-1
                  </code>
                </output>
                <Alert>
                  <AlertTitle>{labels.creatorTitle}</AlertTitle>
                  <AlertDescription className="flex flex-col gap-1">
                    <span className="text-foreground">{creatorName}</span>
                    <span>{labels.creatorDescription}</span>
                  </AlertDescription>
                </Alert>
              </>
            ) : null}
          </CardContent>
          {membership && creatorName ? (
            <CardFooter>
              <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {labels.submit}
              </Button>
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
