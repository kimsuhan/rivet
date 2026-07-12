'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  getAuthControllerGetSessionQueryKey,
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
  errorDescription: string;
  errorTitle: string;
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
};

export function WorkspaceOnboardingScreen({ labels }: { labels: WorkspaceOnboardingLabels }) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { name: '', slug: '' },
    resolver: zodResolver(schema),
  });
  const slug = useWatch({ control, name: 'slug' });
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

  return (
    <OnboardingFrame currentStep={1} labels={labels}>
      <form noValidate aria-busy={mutation.isPending} onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>{labels.title}</h1>
            </CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
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
                  {...register('name')}
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
                  {...register('slug')}
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
