'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  type ApiError,
  type TeamWorkSummaryResponseDto,
  type UpdateTeamWorkDtoCompletionMode,
  useProjectsControllerGet,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { HandoffEditor } from '@/features/collaboration/markdown-editor';

import { PROJECT_ROLE_LABELS } from './issue-attribute-presentation';
import { markdownEditorLabels } from './issue-collaboration-labels';
import { HANDOFF_TEMPLATE, handoffBodyError } from './issue-handoff-validation';

type FrontendRole = 'APP_FRONTEND' | 'WEB_FRONTEND';

function errorMessage(error: unknown): string {
  const apiError = error as ApiError | undefined;
  if (apiError && typeof apiError.body === 'object' && apiError.body !== null) {
    const message = (apiError.body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '완료를 저장하지 못했습니다. 최신 값을 확인하고 다시 시도해 주세요.';
}

export function TeamWorkCompletionModal({
  error,
  onOpenChange,
  onSubmit,
  open,
  submitting = false,
  work,
}: {
  error?: unknown;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    completionMode: UpdateTeamWorkDtoCompletionMode;
    handoff?: { bodyMarkdown: string; destinationRoles: FrontendRole[] };
    workflowStateId: string;
  }) => void;
  open: boolean;
  submitting?: boolean;
  work: TeamWorkSummaryResponseDto;
}) {
  const markdown = useTranslations('Markdown');
  const editorLabels = markdownEditorLabels(
    (key) => markdown(key as never),
    (key) => String(markdown.raw(key as never)),
  );
  const states = useTeamsControllerListWorkflowStates(work.team.id, {
    query: { enabled: open, retry: false },
  });
  const project = useProjectsControllerGet(work.issue.project.id, {
    query: { enabled: open && work.projectRole === 'BACKEND', retry: false },
  });
  const [completionMode, setCompletionMode] =
    useState<UpdateTeamWorkDtoCompletionMode>('COMPLETE_ONLY');
  const [handoffBody, setHandoffBody] = useState('');
  const [destinationRoles, setDestinationRoles] = useState<FrontendRole[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);

  const isBackend = work.projectRole === 'BACKEND';
  const frontRoles = (project.data?.roleTeams ?? []).flatMap(({ role }) =>
    role === 'WEB_FRONTEND' || role === 'APP_FRONTEND' ? [role] : [],
  );
  const completedState = [...(states.data?.items ?? [])]
    .filter((state) => state.category === 'COMPLETED')
    .sort((a, b) => a.position - b.position)[0];
  const handoffBodyInvalid = handoffBodyError(handoffBody) === 'content';
  const requiresHandoffFields = isBackend && completionMode === 'HANDOFF_AND_COMPLETE';
  const canSubmit =
    Boolean(completedState) &&
    !submitting &&
    (!requiresHandoffFields || (destinationRoles.length > 0 && !handoffBodyInvalid));

  function handleSubmit() {
    if (!completedState || !canSubmit) return;
    if (requiresHandoffFields) {
      onSubmit({
        completionMode: 'HANDOFF_AND_COMPLETE',
        handoff: { bodyMarkdown: handoffBody, destinationRoles },
        workflowStateId: completedState.id,
      });
      return;
    }
    onSubmit({ completionMode: 'COMPLETE_ONLY', workflowStateId: completedState.id });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent
        aria-busy={submitting}
        className="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{work.identifier} 완료</DialogTitle>
          <DialogDescription>
            {isBackend
              ? '완료 방식을 선택해 주세요. 프론트에 전달할 때만 대상 역할과 전달 내용을 입력합니다.'
              : '이 작업을 완료합니다. 작업 전달은 필요하지 않습니다.'}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>완료를 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
        {isBackend ? (
          <FieldSet>
            <FieldLegend variant="label">완료 방식</FieldLegend>
            <div data-slot="radio-group" className="grid gap-2">
              <label className="border-border bg-background hover:bg-muted focus-within:border-ring focus-within:ring-ring/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm outline-none focus-within:ring-2">
                <input
                  checked={completionMode === 'COMPLETE_ONLY'}
                  className="sr-only"
                  name="completionMode"
                  onChange={() => setCompletionMode('COMPLETE_ONLY')}
                  type="radio"
                  value="COMPLETE_ONLY"
                />
                이 작업만 완료
              </label>
              <label className="border-border bg-background hover:bg-muted focus-within:border-ring focus-within:ring-ring/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm outline-none focus-within:ring-2">
                <input
                  checked={completionMode === 'HANDOFF_AND_COMPLETE'}
                  className="sr-only"
                  name="completionMode"
                  onChange={() => {
                    setCompletionMode('HANDOFF_AND_COMPLETE');
                    setDestinationRoles((current) => (current.length > 0 ? current : frontRoles));
                  }}
                  type="radio"
                  value="HANDOFF_AND_COMPLETE"
                />
                프론트에 전달 후 완료
              </label>
            </div>
          </FieldSet>
        ) : null}
        {requiresHandoffFields ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">전달 대상</legend>
              <div className="flex flex-wrap gap-3">
                {frontRoles.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={destinationRoles.includes(role)}
                      onCheckedChange={(checked) =>
                        setDestinationRoles((current) =>
                          checked ? [...current, role] : current.filter((item) => item !== role),
                        )
                      }
                    />
                    {PROJECT_ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-2">
              <HandoffEditor
                charLimit={50_000}
                labels={editorLabels}
                onChange={setHandoffBody}
                value={handoffBody}
              />
              {handoffBodyInvalid ? (
                <p className="text-destructive text-sm" role="alert">
                  전달할 변경 내용을 입력해 주세요.
                </p>
              ) : null}
            </div>
            <details open={guideOpen} onToggle={(event) => setGuideOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer text-sm font-medium">작성 가이드 보기</summary>
              <div className="text-muted-foreground mt-2 space-y-2 text-sm">
                <p>
                  변경 요약, API 명세 링크, 사용 가능 환경, 요청·응답 변경, 프론트 주의사항을 필요한
                  만큼만 적어 주세요.
                </p>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => setHandoffBody(HANDOFF_TEMPLATE)}
                >
                  가이드 삽입
                </Button>
              </div>
            </details>
          </>
        ) : null}
        <DialogFooter>
          <Button
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            취소
          </Button>
          <Button aria-busy={submitting} disabled={!canSubmit} onClick={handleSubmit} type="button">
            {submitting ? <Spinner /> : null}
            {requiresHandoffFields ? '전달하고 완료' : '완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
