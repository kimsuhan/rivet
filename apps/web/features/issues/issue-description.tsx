'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ApiError, type ApiErrorResponseDto, type IssueDetailResponseDto } from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { MarkdownEditor, type MentionOption } from '@/features/collaboration/markdown-editor';
import { MarkdownRenderer } from '@/features/collaboration/markdown-renderer';

import { markdownEditorLabels } from './issue-collaboration-labels';
import type { useIssueInlineMutation } from './issue-mutations';

function descriptionError(
  error: unknown,
  t: ReturnType<typeof useTranslations<'IssueDetail'>>,
): string {
  if (!(error instanceof ApiError)) return t('description.errors.default');
  const body = error.body as ApiErrorResponseDto;
  if (body.fieldErrors.descriptionMarkdown?.length) {
    return t('description.errors.invalid');
  }

  if (body.code === 'MENTION_INVALID') return t('description.errors.mention');
  if (body.code === 'MARKDOWN_INVALID') return t('description.errors.invalid');
  if (body.code.startsWith('FILE_')) return t('description.errors.file');
  return t('description.errors.default');
}

export function IssueDescription({
  issue,
  mentionOptions,
  mutation,
}: {
  issue: IssueDetailResponseDto;
  mentionOptions: MentionOption[];
  mutation: ReturnType<typeof useIssueInlineMutation>;
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const [draft, setDraft] = useState(issue.descriptionMarkdown ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [canSubmit, setCanSubmit] = useState(true);
  const normalizedDraft = draft.trim().length ? draft : null;
  const isDescriptionMutation = mutation.variables?.change.kind === 'description';

  function startEditing() {
    setDraft(issue.descriptionMarkdown ?? '');
    setCanSubmit(true);
    setIsEditing(true);
  }

  function saveDescription() {
    if (!canSubmit || mutation.isPending || normalizedDraft === issue.descriptionMarkdown) {
      return;
    }

    mutation.mutate(
      { change: { kind: 'description', value: normalizedDraft }, issue },
      { onSuccess: () => setIsEditing(false) },
    );
  }

  return (
    <section aria-labelledby="issue-description-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="issue-description-title" className="text-base font-semibold">
          {t('description.title')}
        </h2>
        {!isEditing ? (
          <Button type="button" size="sm" variant="outline" onClick={startEditing}>
            {issue.descriptionMarkdown ? t('description.edit') : t('description.add')}
          </Button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-3 flex flex-col gap-3">
          <MarkdownEditor
            charLimit={100_000}
            disabled={mutation.isPending}
            error={
              isDescriptionMutation && mutation.isError && !mutation.conflict
                ? descriptionError(mutation.error, t)
                : null
            }
            labels={markdownEditorLabels(
              (key) => markdownT(key as never),
              (key) => String(markdownT.raw(key as never)),
            )}
            mentionOptions={mentionOptions}
            status={mutation.isPending && isDescriptionMutation ? t('description.saving') : null}
            value={draft}
            onCanSubmitChange={setCanSubmit}
            onChange={setDraft}
          />
          {mutation.conflict?.attemptedChange.kind === 'description' ? (
            <Alert>
              <AlertTitle>{t('description.conflictTitle')}</AlertTitle>
              <AlertDescription>{t('description.conflictDescription')}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                setDraft(issue.descriptionMarkdown ?? '');
                setIsEditing(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                !canSubmit || mutation.isPending || normalizedDraft === issue.descriptionMarkdown
              }
              onClick={saveDescription}
            >
              {t('description.save')}
            </Button>
          </div>
        </div>
      ) : issue.descriptionMarkdown ? (
        <MarkdownRenderer
          className="mt-3"
          imageUnavailableLabel={markdownT('imageUnavailable')}
          markdown={issue.descriptionMarkdown}
        />
      ) : (
        <p className="text-muted-foreground mt-3 border-y py-4 text-sm">{t('description.empty')}</p>
      )}
    </section>
  );
}
