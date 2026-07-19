'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  Building2Icon,
  CircleAlertIcon,
  CircleHelpIcon,
  MailIcon,
} from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  getAuthControllerGetSessionQueryKey,
  useAuthControllerGetSession,
  useWorkspacesControllerCreate,
} from '@rivet/api-client';

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
import { useRouter } from '@/i18n/navigation';

import { OnboardingFrame, type OnboardingFrameLabels } from './onboarding-frame';

function subscribeToHost() {
  return () => undefined;
}

type WorkspaceOnboardingLabels = OnboardingFrameLabels & {
  addressPreviewLabel: string;
  addressPrefix: string;
  backToChoices: string;
  creationChoiceDescription: string;
  creationChoiceTitle: string;
  creationWarningDescription: string;
  creationWarningTitle: string;
  entryDescription: string;
  entryTitle: string;
  errorDescription: string;
  errorTitle: string;
  invitationChoiceDescription: string;
  invitationChoiceTitle: string;
  nameInvalid: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  nameTooLong: string;
  slugDescription: string;
  slugExample: string;
  slugFormat: string;
  slugInUse: string;
  slugInvalid: string;
  slugLabel: string;
  slugPlaceholder: string;
  slugTooLong: string;
  slugTooShort: string;
  submit: string;
  submitting: string;
  title: string;
  description: string;
  waitingDescription: string;
  waitingEmailLabel: string;
  waitingEmailUnavailable: string;
  waitingHelpDescription: string;
  waitingHelpTitle: string;
  waitingTitle: string;
};

function hashWorkspaceName(name: string) {
  let hash = 2_166_136_261;

  for (const character of name) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

function createWorkspaceSlug(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return '';
  }

  const asciiSlug = trimmedName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!asciiSlug) {
    return `workspace-${hashWorkspaceName(trimmedName)}`;
  }

  const validLengthSlug = asciiSlug.length < 3 ? `${asciiSlug}-workspace` : asciiSlug;
  const slug = validLengthSlug.slice(0, 50).replace(/-+$/g, '');

  return slug;
}

function BackToChoicesButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="self-start" onClick={onClick}>
      <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  );
}

export function WorkspaceOnboardingScreen({ labels }: { labels: WorkspaceOnboardingLabels }) {
  const [view, setView] = useState<'choice' | 'create' | 'waiting'>('choice');
  const hasEditedSlug = useRef(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const mutation = useWorkspacesControllerCreate();
  const addressPrefix = useSyncExternalStore(
    subscribeToHost,
    () => `${window.location.host}/`,
    () => labels.addressPrefix,
  );
  const schema = z.object({
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
    slug: z
      .string()
      .trim()
      .min(3, labels.slugTooShort)
      .max(50, labels.slugTooLong)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, labels.slugFormat),
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
    defaultValues: { name: '', slug: '' },
    resolver: zodResolver(schema),
  });
  const nameField = register('name');
  const slugField = register('slug');
  const slug = useWatch({ control, name: 'slug' });
  const accountEmail = session.data?.authenticated ? session.data.user.email : null;
  const hasMappedError = Boolean(
    mutation.error &&
    (mutation.error.body.code === 'WORKSPACE_SLUG_IN_USE' ||
      mutation.error.body.fieldErrors.name?.length ||
      mutation.error.body.fieldErrors.slug?.length),
  );

  const submit = handleSubmit((values) => {
    if (mutation.isPending) {
      return;
    }

    clearErrors(['name', 'slug']);
    mutation.reset();
    mutation.mutate(
      { data: values },
      {
        onError: (error) => {
          const hasNameError = Boolean(error.body.fieldErrors.name?.length);
          const hasSlugError = Boolean(error.body.fieldErrors.slug?.length);

          if (hasNameError) {
            setError('name', { message: labels.nameInvalid, type: 'server' });
          }
          if (hasSlugError || error.body.code === 'WORKSPACE_SLUG_IN_USE') {
            setError('slug', {
              message:
                error.body.code === 'WORKSPACE_SLUG_IN_USE' ? labels.slugInUse : labels.slugInvalid,
              type: 'server',
            });
          }

          if (hasNameError) {
            setFocus('name');
          } else if (hasSlugError || error.body.code === 'WORKSPACE_SLUG_IN_USE') {
            setFocus('slug');
          }
        },
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: getAuthControllerGetSessionQueryKey(),
          });
          router.replace('/onboarding/team');
        },
      },
    );
  });

  if (view === 'choice') {
    return (
      <OnboardingFrame currentStep={1} labels={labels}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{labels.entryTitle}</h1>
            </CardTitle>
            <CardDescription>{labels.entryDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              aria-label={labels.invitationChoiceTitle}
              aria-describedby="invitation-choice-description"
              className="h-auto w-full items-start justify-start px-4 py-4 text-left whitespace-normal"
              onClick={() => setView('waiting')}
            >
              <MailIcon data-icon="inline-start" aria-hidden="true" />
              <span className="flex flex-col items-start gap-1">
                <span>{labels.invitationChoiceTitle}</span>
                <span
                  id="invitation-choice-description"
                  className="text-muted-foreground text-xs leading-relaxed font-normal"
                >
                  {labels.invitationChoiceDescription}
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-label={labels.creationChoiceTitle}
              aria-describedby="creation-choice-description"
              className="h-auto w-full items-start justify-start px-4 py-4 text-left whitespace-normal"
              onClick={() => setView('create')}
            >
              <Building2Icon data-icon="inline-start" aria-hidden="true" />
              <span className="flex flex-col items-start gap-1">
                <span>{labels.creationChoiceTitle}</span>
                <span
                  id="creation-choice-description"
                  className="text-muted-foreground text-xs leading-relaxed font-normal"
                >
                  {labels.creationChoiceDescription}
                </span>
              </span>
            </Button>
          </CardContent>
        </Card>
      </OnboardingFrame>
    );
  }

  if (view === 'waiting') {
    return (
      <OnboardingFrame currentStep={1} labels={labels}>
        <BackToChoicesButton label={labels.backToChoices} onClick={() => setView('choice')} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{labels.waitingTitle}</h1>
            </CardTitle>
            <CardDescription>{labels.waitingDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert>
              <MailIcon aria-hidden="true" />
              <AlertTitle>{labels.waitingEmailLabel}</AlertTitle>
              <AlertDescription className="break-all">
                {accountEmail ?? labels.waitingEmailUnavailable}
              </AlertDescription>
            </Alert>
            <Alert>
              <CircleHelpIcon aria-hidden="true" />
              <AlertTitle>{labels.waitingHelpTitle}</AlertTitle>
              <AlertDescription>{labels.waitingHelpDescription}</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setView('create')}
            >
              <Building2Icon data-icon="inline-start" aria-hidden="true" />
              {labels.creationChoiceTitle}
            </Button>
          </CardFooter>
        </Card>
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame currentStep={1} labels={labels}>
      <BackToChoicesButton label={labels.backToChoices} onClick={() => setView('choice')} />
      <form noValidate aria-busy={mutation.isPending} onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{labels.title}</h1>
            </CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Alert>
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>{labels.creationWarningTitle}</AlertTitle>
              <AlertDescription>{labels.creationWarningDescription}</AlertDescription>
            </Alert>
            {mutation.isError && !hasMappedError ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.errorTitle}</AlertTitle>
                <AlertDescription>{labels.errorDescription}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="workspace-name">{labels.nameLabel}</FieldLabel>
                <Input
                  id="workspace-name"
                  autoComplete="organization"
                  aria-describedby="workspace-name-error"
                  aria-invalid={Boolean(errors.name)}
                  placeholder={labels.namePlaceholder}
                  {...nameField}
                  onChange={(event) => {
                    nameField.onChange(event);

                    if (hasEditedSlug.current) {
                      return;
                    }

                    setValue('slug', createWorkspaceSlug(event.target.value), {
                      shouldDirty: true,
                      shouldValidate: Boolean(errors.slug),
                    });
                  }}
                />
                <FieldError id="workspace-name-error" errors={[errors.name]} />
              </Field>
              <Field data-invalid={Boolean(errors.slug)}>
                <FieldLabel htmlFor="workspace-slug">{labels.slugLabel}</FieldLabel>
                <Input
                  id="workspace-slug"
                  autoCapitalize="none"
                  autoComplete="off"
                  aria-describedby="workspace-slug-description workspace-slug-error"
                  aria-invalid={Boolean(errors.slug)}
                  placeholder={labels.slugPlaceholder}
                  spellCheck={false}
                  {...slugField}
                  onChange={(event) => {
                    slugField.onChange(event);
                    hasEditedSlug.current = true;
                  }}
                />
                <FieldDescription id="workspace-slug-description">
                  {labels.slugDescription}
                </FieldDescription>
                <FieldError id="workspace-slug-error" errors={[errors.slug]} />
              </Field>
            </FieldGroup>
            <output
              htmlFor="workspace-slug"
              aria-live="polite"
              className="bg-surface-1 flex flex-col gap-1 rounded-md border px-3 py-2"
            >
              <span className="text-muted-foreground text-xs">{labels.addressPreviewLabel}</span>
              <code className="text-foreground text-sm break-all">
                {addressPrefix}
                {slug || labels.slugExample}
              </code>
            </output>
          </CardContent>
          <CardFooter>
            <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {labels.submit}
            </Button>
            {mutation.isPending ? (
              <span role="status" className="sr-only">
                {labels.submitting}
              </span>
            ) : null}
          </CardFooter>
        </Card>
      </form>
    </OnboardingFrame>
  );
}
