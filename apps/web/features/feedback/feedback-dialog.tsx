'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { useFeedbackControllerSubmit } from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

const schema = z.object({
  body: z.string().trim().min(10).max(4000),
  category: z.enum(['BUG', 'USABILITY', 'IDEA', 'OTHER']),
});

type FeedbackForm = z.infer<typeof schema>;

export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('Feedback');
  const mutation = useFeedbackControllerSubmit();
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<FeedbackForm>({
    defaultValues: { body: '', category: 'USABILITY' },
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (!open) return;
    mutation.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeOpen(next: boolean) {
    if (!next) {
      form.reset();
      setSubmissionId(crypto.randomUUID());
      setSubmitted(false);
      mutation.reset();
    }
    onOpenChange(next);
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({
        data: {
          body: values.body,
          category: values.category,
          currentPath: window.location.pathname,
          submissionId,
        },
      });
      setSubmitted(true);
    } catch {
      // mutation 상태를 인라인으로 표시하고 form/submissionId를 그대로 유지한다.
    }
  });

  const categories = [
    { label: t('categories.BUG'), value: 'BUG' as const },
    { label: t('categories.USABILITY'), value: 'USABILITY' as const },
    { label: t('categories.IDEA'), value: 'IDEA' as const },
    { label: t('categories.OTHER'), value: 'OTHER' as const },
  ];

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {submitted ? (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
            <AlertTitle>{t('successTitle')}</AlertTitle>
            <AlertDescription>{t('successDescription')}</AlertDescription>
          </Alert>
        ) : (
          <form id="feedback-form" onSubmit={submit}>
            <FieldGroup>
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>{t('categoryLabel')}</FieldLabel>
                    <Select items={categories} value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category.value} value={category.value}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Field data-invalid={Boolean(form.formState.errors.body)}>
                <FieldLabel htmlFor="feedback-body">{t('bodyLabel')}</FieldLabel>
                <Textarea
                  id="feedback-body"
                  rows={7}
                  maxLength={4000}
                  placeholder={t('bodyPlaceholder')}
                  aria-invalid={Boolean(form.formState.errors.body)}
                  {...form.register('body')}
                />
                <FieldDescription>{t('privacyDescription')}</FieldDescription>
                <FieldError>{form.formState.errors.body ? t('bodyError') : undefined}</FieldError>
              </Field>
              {mutation.isError ? <FieldError>{t('submitError')}</FieldError> : null}
            </FieldGroup>
          </form>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
            {submitted ? t('done') : t('cancel')}
          </Button>
          {!submitted ? (
            <Button type="submit" form="feedback-form" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner /> : null}
              {mutation.isPending ? t('submitting') : t('submit')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
