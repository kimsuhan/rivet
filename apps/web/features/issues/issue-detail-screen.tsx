'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleAlert, FileText, Play, Save, UserRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  getIssuesControllerGetQueryKey,
  getTeamWorksControllerGetQueryKey,
  type IssueDetailResponseDto,
  type IssueMemberSummaryResponseDto,
  type TeamWorkDetailResponseDto,
  teamWorksControllerUpdate,
  type TeamWorkSummaryResponseDto,
  useAuthControllerGetSession,
  useIssueCollaborationControllerCreateHandoff,
  useIssuesControllerGet,
  useIssuesControllerStart,
  useIssuesControllerUpdate,
  useMembersControllerList,
  useProjectsControllerGet,
  useTeamsControllerListWorkflowStates,
  useTeamWorksControllerGet,
} from '@rivet/api-client';

import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  HandoffEditor,
  IssueDescriptionEditor,
  type MentionOption,
  WorkNoteEditor,
} from '@/features/collaboration/markdown-editor';
import { MarkdownRenderer } from '@/features/collaboration/markdown-renderer';
import { Link, usePathname, useRouter } from '@/i18n/navigation';

import { IssueAttachments } from './issue-attachments';
import {
  CompactAssigneeTrigger,
  IssueStatusDisplay,
  PriorityDisplay,
  PROJECT_ROLE_LABELS as ROLE_LABELS,
  StatusTrigger,
  TeamWorkStatusDisplay,
} from './issue-attribute-presentation';
import { markdownEditorLabels } from './issue-collaboration-labels';
import {
  FOLLOW_UP_HANDOFF_TEMPLATE,
  handoffBodyError,
  stripEmptyHandoffSections,
} from './issue-handoff-validation';
import { IssueLabelChips } from './issue-label-chips';
import { IssueTimeline } from './issue-timeline';
import {
  isExcludedFromMyWork,
  issueWorkHref,
  matchesRequestedTeamWork,
  myWorkHref,
} from './issue-work-routing';
import { TeamWorkCompletionModal } from './team-work-completion-modal';
import { TeamWorkPrimaryAction } from './team-work-primary-action';

type ProjectRole = 'BACKEND' | 'WEB_FRONTEND' | 'APP_FRONTEND';

function formatHandoffDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function askAboutHandoffInComments(issueId: string, label: string) {
  window.sessionStorage.setItem('rivet.comment.quote-context', JSON.stringify({ issueId, label }));
  document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && typeof error.body === 'object' && error.body !== null) {
    const message = (error.body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '요청을 저장하지 못했습니다. 최신 값을 확인하고 다시 시도해 주세요.';
}

function useTeamWorkCellMutation(
  issue: IssueDetailResponseDto,
  work: TeamWorkSummaryResponseDto,
  field: 'assignee' | 'workNoteMarkdown' | 'workflowState',
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: {
      assignee?: IssueMemberSummaryResponseDto | null;
      assigneeMembershipId?: string | null;
      completionMode?: 'COMPLETE_ONLY' | 'HANDOFF_AND_COMPLETE';
      handoff?: { bodyMarkdown: string; destinationRoles?: Array<'APP_FRONTEND' | 'WEB_FRONTEND'> };
      workNoteMarkdown?: string | null;
      workflowState?: {
        id: string;
        name: string;
        category: TeamWorkSummaryResponseDto['stateCategory'];
        position: number;
        isDefault: boolean;
        version: number;
      };
    }) =>
      teamWorksControllerUpdate(work.id, {
        version: work.version,
        ...(change.assigneeMembershipId !== undefined
          ? { assigneeMembershipId: change.assigneeMembershipId }
          : {}),
        ...(change.completionMode ? { completionMode: change.completionMode } : {}),
        ...(change.workNoteMarkdown !== undefined
          ? { workNoteMarkdown: change.workNoteMarkdown }
          : {}),
        ...(change.workflowState ? { workflowStateId: change.workflowState.id } : {}),
        ...(change.handoff ? { handoff: change.handoff } : {}),
      }),
    onMutate: async (change) => {
      const issueKeys = [
        getIssuesControllerGetQueryKey(issue.id),
        getIssuesControllerGetQueryKey(issue.identifier),
      ];
      const detailKeys = [
        getTeamWorksControllerGetQueryKey(work.id),
        getTeamWorksControllerGetQueryKey(work.identifier),
      ];
      await Promise.all(
        [...issueKeys, ...detailKeys].map((queryKey) => queryClient.cancelQueries({ queryKey })),
      );
      const previousIssues = issueKeys.map((queryKey) =>
        queryClient.getQueryData<IssueDetailResponseDto>(queryKey),
      );
      const previousDetails = detailKeys.map((queryKey) =>
        queryClient.getQueryData<TeamWorkDetailResponseDto>(queryKey),
      );
      const patch = {
        ...(change.assignee !== undefined ? { assignee: change.assignee } : {}),
        ...(change.workNoteMarkdown !== undefined
          ? { workNoteMarkdown: change.workNoteMarkdown }
          : {}),
        ...(change.workflowState
          ? { stateCategory: change.workflowState.category, workflowState: change.workflowState }
          : {}),
      };
      issueKeys.forEach((queryKey) =>
        queryClient.setQueryData<IssueDetailResponseDto>(queryKey, (current) =>
          current
            ? {
                ...current,
                teamWorks: current.teamWorks.map((item) =>
                  item.id === work.id ? { ...item, ...patch } : item,
                ),
              }
            : current,
        ),
      );
      detailKeys.forEach((queryKey) =>
        queryClient.setQueryData<TeamWorkDetailResponseDto>(queryKey, (current) =>
          current ? { ...current, ...patch } : current,
        ),
      );
      return { detailKeys, issueKeys, previousDetails, previousIssues };
    },
    onError: (_error, _change, context) => {
      context?.issueKeys.forEach((queryKey, index) =>
        queryClient.setQueryData(queryKey, context.previousIssues[index]),
      );
      context?.detailKeys.forEach((queryKey, index) =>
        queryClient.setQueryData(queryKey, context.previousDetails[index]),
      );
    },
    onSuccess: (result) => {
      for (const queryKey of [
        getIssuesControllerGetQueryKey(issue.id),
        getIssuesControllerGetQueryKey(issue.identifier),
      ]) {
        queryClient.setQueryData<IssueDetailResponseDto>(queryKey, (current) =>
          current
            ? {
                ...current,
                ...result.issue,
                teamWorks: current.teamWorks.map((item) =>
                  item.id === work.id ? { ...item, ...result.teamWork } : item,
                ),
              }
            : current,
        );
      }
      queryClient.setQueryData(getTeamWorksControllerGetQueryKey(work.id), result.teamWork);
      queryClient.setQueryData(getTeamWorksControllerGetQueryKey(work.identifier), result.teamWork);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) });
      void queryClient.invalidateQueries({
        queryKey: getIssuesControllerGetQueryKey(issue.identifier),
      });
      void queryClient.invalidateQueries({ queryKey: getTeamWorksControllerGetQueryKey(work.id) });
      void queryClient.invalidateQueries({
        queryKey: getTeamWorksControllerGetQueryKey(work.identifier),
      });
    },
    mutationKey: ['team-work-cell', work.id, field],
  });
}

function TeamWorkPanel({
  handoffHref,
  highlightedHandoffId,
  issue,
  mentionOptions,
  work,
}: {
  handoffHref: string;
  highlightedHandoffId: string | null;
  issue: IssueDetailResponseDto;
  mentionOptions: MentionOption[];
  work: TeamWorkSummaryResponseDto;
}) {
  const queryClient = useQueryClient();
  const markdown = useTranslations('Markdown');
  const editorLabels = markdownEditorLabels(
    (key) => markdown(key as never),
    (key) => String(markdown.raw(key as never)),
  );
  const states = useTeamsControllerListWorkflowStates(work.team.id, { query: { retry: false } });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: work.team.id },
    { query: { retry: false } },
  );
  const stateMutation = useTeamWorkCellMutation(issue, work, 'workflowState');
  const assigneeMutation = useTeamWorkCellMutation(issue, work, 'assignee');
  const noteMutation = useTeamWorkCellMutation(issue, work, 'workNoteMarkdown');
  const followUpMutation = useIssueCollaborationControllerCreateHandoff();
  const [workNoteMarkdown, setWorkNoteMarkdown] = useState(work.workNoteMarkdown ?? '');
  const [editingWorkNote, setEditingWorkNote] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [followUpBody, setFollowUpBody] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpGuideOpen, setFollowUpGuideOpen] = useState(false);
  const [followUpSuccess, setFollowUpSuccess] = useState(false);
  const [savedFollowUpSequence, setSavedFollowUpSequence] = useState<number | null>(null);

  function saveState(stateId: string) {
    const state = states.data?.items.find((item) => item.id === stateId);
    if (!state) return;
    if (state.category === 'COMPLETED') {
      setCompletionModalOpen(true);
      return;
    }
    stateMutation.mutate({ workflowState: state });
  }

  function createFollowUp() {
    const sequenceNumber = nextFollowUpSequence;
    followUpMutation.mutate(
      {
        teamWorkId: work.id,
        data: { bodyMarkdown: followUpBody, kind: 'FOLLOW_UP' },
      },
      {
        onSuccess: () => {
          setFollowUpBody('');
          setFollowUpGuideOpen(false);
          setFollowUpOpen(false);
          setSavedFollowUpSequence(sequenceNumber);
          setFollowUpSuccess(true);
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
            queryClient.invalidateQueries({
              queryKey: getIssuesControllerGetQueryKey(issue.identifier),
            }),
          ]);
        },
      },
    );
  }

  const relatedHandoffs = issue.handoffFlows.filter(
    (handoff) =>
      handoff.sourceTeamWork.id === work.id ||
      handoff.targets.some((target) => target.teamWork.id === work.id),
  );
  const latestRelatedHandoff =
    relatedHandoffs.find((handoff) => handoff.id === highlightedHandoffId) ?? relatedHandoffs[0];
  const hasInitialHandoff = issue.handoffFlows.some(
    (handoff) =>
      handoff.kind === 'INITIAL' &&
      (work.projectRole === 'BACKEND'
        ? handoff.sourceTeamWork.id === work.id
        : handoff.targets.some((target) => target.teamWork.id === work.id)),
  );
  const initialHandoff = issue.handoffFlows.find(
    (handoff) => handoff.kind === 'INITIAL' && handoff.sourceTeamWork.id === work.id,
  );
  const followUpRecipientWorks = initialHandoff?.targets.map((target) => target.teamWork) ?? [];
  const nextFollowUpSequence =
    Math.max(
      0,
      ...issue.handoffFlows
        .filter((handoff) => handoff.sourceTeamWork.id === work.id)
        .map((handoff) => handoff.sequenceNumber),
    ) + 1;
  const followUpBodyInvalid = handoffBodyError(followUpBody) === 'content';
  const error =
    stateMutation.error ?? assigneeMutation.error ?? noteMutation.error ?? followUpMutation.error;

  return (
    <section className="border-b pb-6" aria-labelledby="selected-work-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 sm:justify-between">
        <h2 id="selected-work-title" className="order-1 text-lg font-semibold">
          {ROLE_LABELS[work.projectRole]} · {work.team.name}
        </h2>
        <TeamWorkPrimaryAction
          className="order-3 sm:order-2"
          busy={stateMutation.isPending}
          disabled={states.isPending}
          onOpenCompletion={() => setCompletionModalOpen(true)}
          onStart={(stateId) => {
            const state = states.data?.items.find((item) => item.id === stateId);
            if (state) stateMutation.mutate({ workflowState: state });
          }}
          states={states.data?.items ?? []}
          work={work}
        />
        <dl className="order-2 flex w-full flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:order-3">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">상태</dt>
            <dd>
              <StatusTrigger
                className="w-32"
                identifier={work.identifier}
                value={work.workflowState.id}
                states={states.data?.items ?? []}
                busy={stateMutation.isPending}
                disabled={stateMutation.isPending || states.isPending}
                onValueChange={saveState}
              />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">담당자</dt>
            <dd className="flex items-center gap-2">
              <CompactAssigneeTrigger
                identifier={work.identifier}
                assignee={work.assignee}
                members={(members.data?.items ?? []) as IssueMemberSummaryResponseDto[]}
                busy={assigneeMutation.isPending}
                disabled={assigneeMutation.isPending || members.isPending}
                onValueChange={(id) => {
                  const member = members.data?.items.find((item) => item.id === id);
                  assigneeMutation.mutate({
                    assignee: member ? (member as IssueMemberSummaryResponseDto) : null,
                    assigneeMembershipId: id || null,
                  });
                }}
              />
              {assigneeMutation.isPending ? (
                <span className="text-muted-foreground text-xs">담당자 저장 중…</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>
      {error ? (
        <Alert variant="destructive" className="mt-2">
          <CircleAlert />
          <AlertTitle>변경을 저장하지 못했습니다</AlertTitle>
          <AlertDescription>{mutationErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}
      <TeamWorkCompletionModal
        error={stateMutation.error}
        onOpenChange={setCompletionModalOpen}
        onSubmit={(payload) => {
          const state = states.data?.items.find((item) => item.id === payload.workflowStateId);
          if (!state) return;
          stateMutation.mutate(
            {
              ...(payload.handoff ? { handoff: payload.handoff } : {}),
              completionMode: payload.completionMode,
              workflowState: state,
            },
            { onSuccess: () => setCompletionModalOpen(false) },
          );
        }}
        open={completionModalOpen}
        submitting={stateMutation.isPending}
        work={work}
      />
      <section className="mt-5 border-t pt-4" aria-labelledby="handoff-context-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="handoff-context-title" className="text-sm font-semibold">
            {work.projectRole === 'BACKEND' ? '보낸 전달' : '받은 전달'}
          </h3>
          <Link
            className="text-primary text-sm underline underline-offset-4"
            href={handoffHref}
            scroll={false}
          >
            전체 전달 보기
          </Link>
        </div>
        {relatedHandoffs.length ? (
          <ul className="mt-3 space-y-4">
            {latestRelatedHandoff ? (
              <LatestHandoff
                key={`${latestRelatedHandoff.id}-${highlightedHandoffId ?? ''}`}
                handoff={latestRelatedHandoff}
                issueId={issue.id}
                initiallyExpanded={Boolean(highlightedHandoffId)}
              />
            ) : null}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">아직 전달된 내용이 없습니다.</p>
        )}
        {work.projectRole === 'BACKEND' && hasInitialHandoff ? (
          <>
            {followUpSuccess ? (
              <Alert className="mt-4">
                <Check />
                <AlertTitle>
                  추가 전달 #{savedFollowUpSequence ?? nextFollowUpSequence}이 이력에 저장되었습니다
                </AlertTitle>
                <AlertDescription>
                  {followUpRecipientWorks.length > 0
                    ? `${followUpRecipientWorks.map((target) => target.identifier).join(', ')} 작업의 담당자와 구독자에게 알림이 생성됩니다.`
                    : '최초 전달 대상 작업의 담당자와 구독자에게 알림이 생성됩니다.'}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() => {
                setFollowUpSuccess(false);
                setFollowUpOpen(true);
              }}
            >
              추가 전달 작성
            </Button>
            <Dialog
              open={followUpOpen}
              onOpenChange={(open) => {
                if (!open && !followUpMutation.isPending) {
                  setFollowUpGuideOpen(false);
                }
                setFollowUpOpen(open);
              }}
            >
              <DialogContent closeLabel="추가 전달 작성 닫기" className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>추가 전달 작성</DialogTitle>
                  <DialogDescription>
                    최초 전달 이후의 변경만 새 이력으로 남깁니다. 기존 전달과 프론트 작업은 바뀌지
                    않습니다.
                  </DialogDescription>
                </DialogHeader>
                <div className="border-border bg-muted/40 rounded-lg border px-3 py-2.5 text-sm">
                  <p className="text-muted-foreground text-xs font-medium">전달 관계</p>
                  <p className="mt-1 font-medium">
                    {work.identifier} · {ROLE_LABELS[work.projectRole]} →{' '}
                    {followUpRecipientWorks.length > 0
                      ? followUpRecipientWorks
                          .map(
                            (target) => `${target.identifier} · ${ROLE_LABELS[target.projectRole]}`,
                          )
                          .join(', ')
                      : '최초 전달 대상 작업'}
                  </p>
                </div>
                <div className="grid gap-2">
                  <HandoffEditor
                    charLimit={50_000}
                    labels={editorLabels}
                    mentionOptions={mentionOptions}
                    onChange={setFollowUpBody}
                    status={followUpMutation.isPending ? '저장 중…' : null}
                    value={followUpBody}
                  />
                  {followUpBodyInvalid ? (
                    <p className="text-destructive text-sm" role="alert">
                      전달할 변경 내용을 입력해 주세요.
                    </p>
                  ) : null}
                </div>
                <details
                  open={followUpGuideOpen}
                  onToggle={(event) => setFollowUpGuideOpen(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer text-sm font-medium">작성 가이드 보기</summary>
                  <div className="text-muted-foreground mt-2 space-y-2 text-sm">
                    <p>
                      변경 요약, 변경된 API 또는 요청·응답, 프론트에서 필요한 조치를 필요한 만큼만
                      적어 주세요.
                    </p>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setFollowUpBody(FOLLOW_UP_HANDOFF_TEMPLATE)}
                    >
                      가이드 삽입
                    </Button>
                  </div>
                </details>
                <Alert>
                  <AlertTitle>알림 대상</AlertTitle>
                  <AlertDescription>
                    {followUpRecipientWorks.length > 0
                      ? `${followUpRecipientWorks.map((target) => target.identifier).join(', ')} 작업의 담당자와 구독자에게만 알립니다.`
                      : '최초 전달 대상 작업의 담당자와 구독자에게만 알립니다.'}
                  </AlertDescription>
                </Alert>
                <DialogFooter>
                  <Button
                    disabled={followUpMutation.isPending}
                    type="button"
                    variant="outline"
                    onClick={() => setFollowUpOpen(false)}
                  >
                    취소
                  </Button>
                  <Button
                    disabled={followUpMutation.isPending || followUpBodyInvalid}
                    type="button"
                    onClick={createFollowUp}
                  >
                    {followUpMutation.isPending ? <Spinner /> : null}추가 전달 저장
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </section>
      <section className="mt-6 border-t pt-4" aria-labelledby="work-note-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="work-note-title" className="text-sm font-medium">
            작업 노트
          </h3>
          {!editingWorkNote ? (
            <Button
              aria-label="작업 노트 편집"
              size="sm"
              variant="ghost"
              onClick={() => setEditingWorkNote(true)}
            >
              {work.workNoteMarkdown ? '편집' : '작업 노트 추가'}
            </Button>
          ) : null}
        </div>
        {editingWorkNote ? (
          <>
            <div className="mt-3">
              <WorkNoteEditor
                charLimit={10_000}
                labels={editorLabels}
                mentionOptions={mentionOptions}
                onChange={setWorkNoteMarkdown}
                status={noteMutation.isPending ? '저장 중…' : null}
                value={workNoteMarkdown}
              />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setWorkNoteMarkdown(work.workNoteMarkdown ?? '');
                  setEditingWorkNote(false);
                }}
              >
                취소
              </Button>
              <Button
                size="sm"
                disabled={
                  noteMutation.isPending || workNoteMarkdown === (work.workNoteMarkdown ?? '')
                }
                onClick={() =>
                  noteMutation.mutate(
                    { workNoteMarkdown: workNoteMarkdown.trim() || null },
                    { onSuccess: () => setEditingWorkNote(false) },
                  )
                }
              >
                {noteMutation.isPending ? <Spinner /> : <Save className="size-3.5" />}노트 저장
              </Button>
            </div>
          </>
        ) : work.workNoteMarkdown ? (
          <MarkdownRenderer
            className="mt-3"
            imageUnavailableLabel="이미지를 표시할 수 없습니다"
            markdown={work.workNoteMarkdown}
          />
        ) : null}
      </section>
    </section>
  );
}

function LatestHandoff({
  handoff,
  initiallyExpanded,
  issueId,
}: {
  handoff: IssueDetailResponseDto['handoffFlows'][number];
  initiallyExpanded: boolean;
  issueId: string;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const contentId = `handoff-content-${handoff.id}`;
  const label = `${handoff.kind === 'INITIAL' ? '최초 전달' : '추가 전달'} #${handoff.sequenceNumber}`;
  const bodyMarkdown = stripEmptyHandoffSections(handoff.bodyMarkdown);

  return (
    <li id={`handoff-${handoff.id}`} className="border-primary/50 border-l-2 pl-4 text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {handoff.author.user.displayName} · {formatHandoffDateTime(handoff.createdAt)}
      </p>
      <Button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="mt-1"
        size="sm"
        variant="ghost"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? '내용 접기' : '내용 펼치기'}
      </Button>
      {expanded ? (
        <div id={contentId}>
          {bodyMarkdown ? (
            <MarkdownRenderer
              className="mt-2"
              imageUnavailableLabel="이미지를 표시할 수 없습니다"
              markdown={bodyMarkdown}
            />
          ) : (
            <p className="text-muted-foreground mt-2">입력된 변경사항이 없습니다.</p>
          )}
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() => askAboutHandoffInComments(issueId, label)}
          >
            댓글로 질문
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function HandoffHistoryItem({
  handoff,
  initiallyExpanded,
  issueId,
  pathname,
  searchParams,
}: {
  handoff: IssueDetailResponseDto['handoffFlows'][number];
  initiallyExpanded: boolean;
  issueId: string;
  pathname: string;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const contentId = `handoff-history-content-${handoff.id}`;
  const label = `${handoff.kind === 'INITIAL' ? '최초 전달' : '추가 전달'} #${handoff.sequenceNumber}`;
  const bodyMarkdown = stripEmptyHandoffSections(handoff.bodyMarkdown);

  return (
    <li id={`handoff-${handoff.id}`} className="border-primary/40 border-l-2 pl-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong>{label}</strong>
          <p className="text-muted-foreground mt-1">
            {handoff.sourceTeamWork.identifier} →{' '}
            {handoff.targets.map((target) => target.teamWork.identifier).join(', ')}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {handoff.author.user.displayName} · {formatHandoffDateTime(handoff.createdAt)}
          </p>
        </div>
        <Button
          aria-controls={contentId}
          aria-expanded={expanded}
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '내용 접기' : '내용 펼치기'}
        </Button>
      </div>
      {expanded ? (
        <div id={contentId}>
          {bodyMarkdown ? (
            <MarkdownRenderer
              className="mt-3"
              imageUnavailableLabel="이미지를 표시할 수 없습니다"
              markdown={bodyMarkdown}
            />
          ) : (
            <p className="text-muted-foreground mt-3">입력된 변경사항이 없습니다.</p>
          )}
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = new URLSearchParams(searchParams.toString());
              next.set('tab', 'work');
              router.replace(`${pathname}?${next.toString()}#comments`, { scroll: false });
              askAboutHandoffInComments(issueId, label);
            }}
          >
            댓글로 질문
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function IssueDetailScreen({
  entry = 'issue',
  issueRef,
}: {
  entry?: 'issue' | 'my-work';
  issueRef: string;
}) {
  const markdown = useTranslations('Markdown');
  const editorLabels = markdownEditorLabels(
    (key) => markdown(key as never),
    (key) => String(markdown.raw(key as never)),
  );
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isMyWorkEntry = entry === 'my-work';
  const requestedWork = isMyWorkEntry ? issueRef : searchParams.get('work');
  const requestedHandoff = searchParams.get('handoff');
  const tab =
    searchParams.get('tab') === 'handoffs'
      ? 'handoffs'
      : searchParams.get('tab') === 'activity'
        ? 'activity'
        : 'work';
  const selectedWorkQuery = useTeamWorksControllerGet(requestedWork ?? issueRef, {
    query: { enabled: isMyWorkEntry || Boolean(requestedWork), retry: false },
  });
  const issueQuery = useIssuesControllerGet(
    isMyWorkEntry ? (selectedWorkQuery.data?.issue.identifier ?? '') : issueRef,
    { query: { enabled: !isMyWorkEntry || Boolean(selectedWorkQuery.data), retry: false } },
  );
  const legacyWork = useTeamWorksControllerGet(issueRef, {
    query: {
      enabled: !isMyWorkEntry && !requestedWork && issueQuery.isError,
      retry: false,
    },
  });
  const issue = issueQuery.data;
  const selectedWork =
    issue?.teamWorks.find((work) => matchesRequestedTeamWork(work.identifier, requestedWork)) ??
    issue?.teamWorks[0];
  const selectedWorkId = selectedWork?.id ?? null;
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { retry: false } },
  );
  const start = useIssuesControllerStart();
  const updateIssue = useIssuesControllerUpdate();
  const project = useProjectsControllerGet(issue?.project.id ?? '', {
    query: { enabled: Boolean(issue), retry: false },
  });
  const [startRoles, setStartRoles] = useState<ProjectRole[]>([]);
  const [addTeamWorkDisclosure, setAddTeamWorkDisclosure] = useState(() => ({
    open: selectedWork?.stateCategory !== 'STARTED',
    workId: selectedWorkId,
  }));
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<{
    issueId: string;
    value: string;
  } | null>(null);
  const issueMutationError = start.error ?? updateIssue.error;

  if (addTeamWorkDisclosure.workId !== selectedWorkId) {
    setAddTeamWorkDisclosure({
      open: selectedWork?.stateCategory !== 'STARTED',
      workId: selectedWorkId,
    });
  }

  useEffect(() => {
    if (isMyWorkEntry || !issueQuery.isError || !legacyWork.data) return;
    router.replace(
      `${issueWorkHref(legacyWork.data.issue.identifier, legacyWork.data.identifier)}${window.location.hash}`,
      { scroll: false },
    );
  }, [isMyWorkEntry, issueQuery.isError, legacyWork.data, router]);
  useEffect(() => {
    if (isMyWorkEntry || !issue || requestedWork || !selectedWork) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', 'work');
    next.set('work', selectedWork.identifier);
    router.replace(`${pathname}?${next.toString()}${window.location.hash}`, { scroll: false });
  }, [isMyWorkEntry, issue, pathname, requestedWork, router, searchParams, selectedWork]);
  useEffect(() => {
    if (!issue) return;
    const anchor = requestedHandoff ? `handoff-${requestedHandoff}` : window.location.hash.slice(1);
    if (!anchor) return;
    requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ block: 'center' }),
    );
  }, [issue, requestedHandoff, selectedWork?.id]);

  const mentionOptions = useMemo(
    () =>
      (members.data?.items ?? []).map((member) => ({
        displayName: member.user.displayName,
        membershipId: member.id,
      })),
    [members.data?.items],
  );

  if (
    (isMyWorkEntry && selectedWorkQuery.isPending) ||
    issueQuery.isPending ||
    (issueQuery.isError && legacyWork.isPending)
  )
    return <ContentLoading label="통합 상세를 불러오는 중입니다" />;
  if (
    !issue &&
    (isMyWorkEntry ? selectedWorkQuery.isError : issueQuery.isError && legacyWork.isError)
  )
    return (
      <ContentError
        title={isMyWorkEntry ? '내 작업을 찾을 수 없습니다' : '이슈를 찾을 수 없습니다'}
        description="주소를 확인하거나 목록으로 돌아가 주세요."
        retryLabel="다시 시도"
        onRetry={() => {
          void issueQuery.refetch();
          void selectedWorkQuery.refetch();
          void legacyWork.refetch();
        }}
      />
    );
  if (!issue) return <ContentLoading label="정본 주소로 이동 중입니다" />;

  const currentIssue = issue;
  const detailHref = (teamWorkIdentifier: string, nextTab = 'work') =>
    isMyWorkEntry
      ? myWorkHref(teamWorkIdentifier, nextTab)
      : issueWorkHref(currentIssue.identifier, teamWorkIdentifier).replace(
          'tab=work',
          `tab=${nextTab}`,
        );
  const myWorkIsExcluded =
    isMyWorkEntry && selectedWork
      ? isExcludedFromMyWork(
          selectedWork.stateCategory,
          selectedWork.assignee?.id ?? null,
          session.data?.authenticated ? (session.data.membership?.id ?? null) : null,
        )
      : false;
  const description =
    descriptionDraft?.issueId === currentIssue.id
      ? descriptionDraft.value
      : (currentIssue.descriptionMarkdown ?? '');
  const availableRoles = (project.data?.roleTeams ?? [])
    .map(({ role }) => role)
    .filter((role) => !currentIssue.teamWorks.some((work) => work.projectRole === role));
  const addTeamWorkOpen = addTeamWorkDisclosure.open;
  async function startWorks() {
    if (!startRoles.length) return;
    try {
      const result = await start.mutateAsync({
        issueId: currentIssue.id,
        data: { roleAssignments: startRoles.map((projectRole) => ({ projectRole })) },
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getIssuesControllerGetQueryKey(currentIssue.id),
        }),
        queryClient.invalidateQueries({
          queryKey: getIssuesControllerGetQueryKey(currentIssue.identifier),
        }),
      ]);
      const first = result.teamWorks[0];
      if (first) router.push(detailHref(first.identifier), { scroll: false });
      setStartRoles([]);
    } catch {
      // React Query mutation 상태가 인라인 오류를 표시한다.
    }
  }
  async function saveDescription() {
    try {
      const updated = await updateIssue.mutateAsync({
        issueId: currentIssue.id,
        data: { descriptionMarkdown: description.trim() || null, version: currentIssue.version },
      });
      queryClient.setQueryData(getIssuesControllerGetQueryKey(currentIssue.id), updated);
      queryClient.setQueryData(getIssuesControllerGetQueryKey(currentIssue.identifier), updated);
      setDescriptionDraft(null);
      setEditingDescription(false);
    } catch {
      // React Query mutation 상태가 인라인 오류를 표시한다.
    }
  }
  async function statusAction(action: 'COMPLETE' | 'PAUSE' | 'RESUME' | 'REOPEN') {
    try {
      const updated = await updateIssue.mutateAsync({
        issueId: currentIssue.id,
        data: { statusAction: action, version: currentIssue.version },
      });
      queryClient.setQueryData(getIssuesControllerGetQueryKey(currentIssue.id), updated);
      queryClient.setQueryData(getIssuesControllerGetQueryKey(currentIssue.identifier), updated);
    } catch {
      // React Query mutation 상태가 인라인 오류를 표시한다.
    }
  }

  return (
    <article className="mx-auto max-w-[1440px] space-y-6">
      <header className="space-y-4">
        <Link
          href={isMyWorkEntry ? '/my-issues' : '/issues'}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          onClick={(event) => {
            if (!isMyWorkEntry) return;
            const stored = window.sessionStorage.getItem('rivet.my-work.return');
            if (!stored) return;
            try {
              const value = JSON.parse(stored) as { teamWorkIdentifier?: unknown };
              if (value.teamWorkIdentifier !== issueRef) return;
              event.preventDefault();
              router.back();
            } catch {
              window.sessionStorage.removeItem('rivet.my-work.return');
            }
          }}
        >
          <ArrowLeft className="size-4" />
          {isMyWorkEntry ? '내 작업' : '이슈 목록'}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-muted-foreground font-mono text-sm">
              {isMyWorkEntry && selectedWork ? selectedWork.identifier : issue.identifier}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {issue.title}
            </h1>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {isMyWorkEntry ? (
                <>
                  <span className="font-mono">{issue.identifier}</span>
                  <span>{issue.project.name}</span>
                  {selectedWork ? <span>{ROLE_LABELS[selectedWork.projectRole]}</span> : null}
                  <IssueLabelChips emptyLabel="" labels={issue.labels} />
                </>
              ) : (
                <>
                  <span>{issue.project.name}</span>
                  {issue.priority === 'NONE' ? (
                    <span>우선순위 없음</span>
                  ) : (
                    <PriorityDisplay priority={issue.priority} />
                  )}
                  {issue.progress.total === 0 ? (
                    <span>아직 시작된 팀 작업이 없습니다</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">
                        작업 {issue.progress.completed}/{issue.progress.total} 완료 ·{' '}
                        {issue.progress.percentage}%
                      </span>
                      <Progress
                        aria-label={`작업 진행률 ${issue.progress.percentage}%`}
                        className="w-20 shrink-0 sm:w-24"
                        value={issue.progress.percentage}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMyWorkEntry && selectedWork ? (
              <TeamWorkStatusDisplay category={selectedWork.stateCategory} />
            ) : (
              <IssueStatusDisplay status={issue.status} />
            )}
            {!isMyWorkEntry && issue.status === 'REVIEW' ? (
              <Button size="sm" onClick={() => void statusAction('COMPLETE')}>
                <Check className="size-4" />
                이슈 완료
              </Button>
            ) : null}
            {!isMyWorkEntry && issue.status === 'PAUSED' ? (
              <Button size="sm" variant="outline" onClick={() => void statusAction('RESUME')}>
                재개
              </Button>
            ) : !isMyWorkEntry && (issue.status === 'DONE' || issue.status === 'CANCELED') ? (
              <Button size="sm" variant="outline" onClick={() => void statusAction('REOPEN')}>
                다시 열기
              </Button>
            ) : !isMyWorkEntry && issue.status === 'IN_PROGRESS' ? (
              <Button size="sm" variant="outline" onClick={() => void statusAction('PAUSE')}>
                일시 중지
              </Button>
            ) : null}
          </div>
        </div>
        {myWorkIsExcluded ? (
          <Alert>
            <CircleAlert />
            <AlertTitle>내 작업에서 제외된 작업입니다</AlertTitle>
            <AlertDescription>
              현재 상태는 계속 확인할 수 있습니다.{' '}
              <Link className="underline underline-offset-4" href="/my-issues">
                내 작업으로 돌아가기
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
        <nav className="flex gap-4 border-b text-sm" aria-label="이슈 상세 탭">
          {(
            [
              { key: 'work', label: '업무' },
              { key: 'handoffs', label: '전달' },
              { key: 'activity', label: '활동' },
            ] as const
          ).map((item) => {
            const next = new URLSearchParams(searchParams.toString());
            next.set('tab', item.key);
            if (isMyWorkEntry) next.delete('work');
            return (
              <Link
                key={item.key}
                href={`${pathname}?${next.toString()}`}
                scroll={false}
                aria-current={tab === item.key ? 'page' : undefined}
                className={`border-b-2 px-1 py-2 ${tab === item.key ? 'border-primary text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {issueMutationError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>이슈 변경을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{mutationErrorMessage(issueMutationError)}</AlertDescription>
          </Alert>
        ) : null}
      </header>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">팀 작업</h2>
            <Badge variant="secondary">{issue.teamWorks.length}</Badge>
          </div>
          {issue.teamWorks.length ? (
            <>
              <Select
                items={issue.teamWorks.map((work) => ({
                  label: `${work.identifier} · ${ROLE_LABELS[work.projectRole]} · ${work.team.name}`,
                  value: work.identifier,
                }))}
                value={selectedWork?.identifier ?? ''}
                onValueChange={(value) => {
                  if (!value) return;
                  const next = new URLSearchParams(searchParams.toString());
                  next.set('tab', 'work');
                  if (isMyWorkEntry) {
                    router.push(detailHref(value), { scroll: false });
                    return;
                  }
                  next.set('work', value);
                  router.push(`${pathname}?${next.toString()}`, { scroll: false });
                }}
              >
                <SelectTrigger aria-label="팀 작업 전환" className="w-full lg:hidden">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {issue.teamWorks.map((work) => (
                      <SelectItem key={work.id} value={work.identifier}>
                        {work.identifier} · {ROLE_LABELS[work.projectRole]} · {work.team.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <nav className="hidden space-y-1 lg:block" aria-label="팀 작업 선택">
                {issue.teamWorks.map((work) => {
                  const active = work.id === selectedWork?.id;
                  const next = new URLSearchParams(searchParams.toString());
                  next.set('tab', 'work');
                  if (!isMyWorkEntry) next.set('work', work.identifier);
                  return (
                    <Link
                      key={work.id}
                      href={
                        isMyWorkEntry
                          ? detailHref(work.identifier)
                          : `${pathname}?${next.toString()}`
                      }
                      scroll={false}
                      aria-current={active ? 'page' : undefined}
                      className={`block border-l-2 px-2 py-2 ${active ? 'border-primary bg-muted/40' : 'hover:bg-muted/40 border-transparent'}`}
                    >
                      <span className="font-mono text-xs">{work.identifier}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                        <TeamWorkStatusDisplay category={work.stateCategory} />
                        {ROLE_LABELS[work.projectRole]}
                      </span>
                      <span className="text-muted-foreground mt-1 block truncate text-xs">
                        {work.assignee?.user.displayName ?? '담당자 없음'}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">아직 시작한 팀 작업이 없습니다.</p>
          )}
          {availableRoles.length ? (
            <details
              className={
                selectedWork?.stateCategory === 'STARTED'
                  ? 'rounded-lg border border-dashed p-3'
                  : 'bg-surface-2 rounded-lg border p-3'
              }
              open={addTeamWorkOpen}
              onToggle={(event) =>
                setAddTeamWorkDisclosure({
                  open: event.currentTarget.open,
                  workId: selectedWorkId,
                })
              }
            >
              <summary
                className={
                  selectedWork?.stateCategory === 'STARTED'
                    ? 'text-muted-foreground flex cursor-pointer items-center gap-2 text-sm font-medium'
                    : 'flex cursor-pointer items-center gap-2 text-sm font-medium'
                }
              >
                <Play className="size-4" />팀 작업 추가
              </summary>
              <div className="mt-3 space-y-2">
                {availableRoles.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={startRoles.includes(role)}
                      onCheckedChange={(checked) =>
                        setStartRoles((current) =>
                          checked ? [...current, role] : current.filter((item) => item !== role),
                        )
                      }
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
              <Button
                className="mt-3 w-full"
                size="sm"
                disabled={!startRoles.length || start.isPending}
                onClick={() => void startWorks()}
              >
                {start.isPending ? <Spinner /> : <Play className="size-3.5" />}선택한 작업 시작
              </Button>
            </details>
          ) : null}
        </aside>
        <main className="min-w-0 space-y-6">
          {tab === 'handoffs' ? (
            <section id="handoffs" aria-labelledby="handoffs-title">
              <h2 id="handoffs-title" className="text-lg font-semibold">
                작업 전달
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                최초 전달과 이후 API 변경을 원문 그대로 확인합니다.
              </p>
              <ol className="mt-5 space-y-6">
                {issue.handoffFlows.map((handoff, index) => (
                  <HandoffHistoryItem
                    key={handoff.id}
                    handoff={handoff}
                    initiallyExpanded={handoff.id === requestedHandoff || index === 0}
                    issueId={issue.id}
                    pathname={pathname}
                    searchParams={searchParams}
                  />
                ))}
              </ol>
              {!issue.handoffFlows.length ? (
                <p className="text-muted-foreground mt-4 text-sm">아직 전달 이력이 없습니다.</p>
              ) : null}
            </section>
          ) : null}
          {tab === 'activity' ? (
            <IssueTimeline
              currentMembershipId={
                session.data?.authenticated ? (session.data.membership?.id ?? null) : null
              }
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              mentionOptions={mentionOptions}
              mode="activity"
            />
          ) : null}
          {tab === 'work' ? (
            <>
              {selectedWork ? (
                <TeamWorkPanel
                  handoffHref={`${detailHref(selectedWork.identifier, 'handoffs')}${requestedHandoff ? `&handoff=${encodeURIComponent(requestedHandoff)}` : ''}`}
                  key={selectedWork.id}
                  highlightedHandoffId={requestedHandoff}
                  issue={issue}
                  mentionOptions={mentionOptions}
                  work={selectedWork}
                />
              ) : (
                <section className="bg-surface-1 rounded-xl border p-6 text-center">
                  <UserRound className="text-muted-foreground mx-auto size-8" />
                  <h2 className="mt-3 font-semibold">이슈에서 팀 작업을 시작하세요</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    본문과 댓글은 이미 사용할 수 있으며 실행 역할은 나중에 추가할 수 있습니다.
                  </p>
                </section>
              )}
              <section className="border-t pt-5" aria-labelledby="issue-content-title">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText aria-hidden="true" className="text-muted-foreground size-4" />
                    <h2 id="issue-content-title" className="text-lg font-semibold">
                      이슈 설명
                    </h2>
                  </div>
                  {!editingDescription ? (
                    <Button size="sm" variant="outline" onClick={() => setEditingDescription(true)}>
                      편집
                    </Button>
                  ) : null}
                </div>
                {editingDescription ? (
                  <div className="mt-3">
                    <IssueDescriptionEditor
                      charLimit={100_000}
                      labels={editorLabels}
                      mentionOptions={mentionOptions}
                      onChange={(value) => setDescriptionDraft({ issueId: currentIssue.id, value })}
                      status={updateIssue.isPending ? '저장 중…' : null}
                      value={description}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setDescriptionDraft(null);
                          setEditingDescription(false);
                        }}
                      >
                        취소
                      </Button>
                      <Button
                        disabled={updateIssue.isPending}
                        onClick={() => void saveDescription()}
                      >
                        {updateIssue.isPending ? <Spinner /> : <Save className="size-4" />}설명 저장
                      </Button>
                    </div>
                  </div>
                ) : issue.descriptionMarkdown ? (
                  <div className="prose prose-sm mt-4 max-w-[76ch] border-l pl-4">
                    <MarkdownRenderer
                      imageUnavailableLabel="이미지를 표시할 수 없습니다"
                      markdown={issue.descriptionMarkdown}
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground mt-4 border-y py-4 text-sm">
                    등록된 설명이 없습니다.
                  </p>
                )}
              </section>
              <IssueAttachments issue={issue} />
              <div id="comments" className="border-t pt-5">
                <IssueTimeline
                  currentMembershipId={
                    session.data?.authenticated ? (session.data.membership?.id ?? null) : null
                  }
                  issueId={issue.id}
                  issueIdentifier={issue.identifier}
                  mentionOptions={mentionOptions}
                  mode="comments"
                />
              </div>
            </>
          ) : null}
        </main>
      </div>
    </article>
  );
}
