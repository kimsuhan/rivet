'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleAlert, Play, Save, UserRound } from 'lucide-react';
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
import { Spinner } from '@/components/ui/spinner';
import {
  HandoffEditor,
  IssueDescriptionEditor,
  WorkNoteEditor,
} from '@/features/collaboration/markdown-editor';
import { MarkdownRenderer } from '@/features/collaboration/markdown-renderer';
import { Link, usePathname, useRouter } from '@/i18n/navigation';

import { IssueAttachments } from './issue-attachments';
import {
  CompactAssigneeTrigger,
  IssueStatusDisplay,
  PriorityDisplay,
  StatusTrigger,
  TeamWorkStatusDisplay,
} from './issue-attribute-presentation';
import { markdownEditorLabels } from './issue-collaboration-labels';
import {
  FOLLOW_UP_HANDOFF_TEMPLATE,
  HANDOFF_TEMPLATE,
  handoffBodyError,
} from './issue-handoff-validation';
import { IssueTimeline } from './issue-timeline';
import { issueWorkHref, matchesRequestedTeamWork } from './issue-work-routing';

const ROLE_LABELS = {
  BACKEND: '백엔드',
  WEB_FRONTEND: '웹 프론트',
  APP_FRONTEND: '앱 프론트',
} as const;
type ProjectRole = 'BACKEND' | 'WEB_FRONTEND' | 'APP_FRONTEND';

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
  highlightedHandoffId,
  issue,
  work,
}: {
  highlightedHandoffId: string | null;
  issue: IssueDetailResponseDto;
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
  const [completionStateId, setCompletionStateId] = useState<string | null>(null);
  const [handoffBody, setHandoffBody] = useState('');
  const [destinationRoles, setDestinationRoles] = useState<Array<'APP_FRONTEND' | 'WEB_FRONTEND'>>(
    [],
  );
  const [handoffGuideOpen, setHandoffGuideOpen] = useState(false);
  const [followUpBody, setFollowUpBody] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpGuideOpen, setFollowUpGuideOpen] = useState(false);
  const [followUpSuccess, setFollowUpSuccess] = useState(false);
  const [savedFollowUpSequence, setSavedFollowUpSequence] = useState<number | null>(null);
  const project = useProjectsControllerGet(issue.project.id, { query: { retry: false } });

  const frontRoles = (project.data?.roleTeams ?? []).flatMap(({ role }) =>
    role === 'WEB_FRONTEND' || role === 'APP_FRONTEND' ? [role] : [],
  );
  const requiresHandoff =
    work.projectRole === 'BACKEND' &&
    frontRoles.length > 0 &&
    !issue.handoffFlows.some(
      (handoff) => handoff.kind === 'INITIAL' && handoff.sourceTeamWork.id === work.id,
    );
  const handoffBodyInvalid = handoffBodyError(handoffBody) === 'content';

  function saveState(stateId: string) {
    const state = states.data?.items.find((item) => item.id === stateId);
    if (!state) return;
    if (state.category === 'COMPLETED' && requiresHandoff) {
      setCompletionStateId(state.id);
      setDestinationRoles(frontRoles);
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
      <header className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <h2 id="selected-work-title" className="text-lg font-semibold">
          {ROLE_LABELS[work.projectRole]} · {work.team.name}
        </h2>
      </header>
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <CircleAlert />
          <AlertTitle>변경을 저장하지 못했습니다</AlertTitle>
          <AlertDescription>{mutationErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <dt className="text-muted-foreground">상태</dt>
          <dd>
            <StatusTrigger
              identifier={work.identifier}
              value={work.workflowState.id}
              states={states.data?.items ?? []}
              busy={stateMutation.isPending}
              disabled={
                stateMutation.isPending ||
                states.isPending ||
                (work.projectRole === 'BACKEND' &&
                  !hasInitialHandoff &&
                  (project.isPending || project.isError))
              }
              onValueChange={saveState}
            />
          </dd>
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3">
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
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">작업 준비</dt>
          <dd>{work.readinessStatus === 'API_HANDOFF_PENDING' ? 'API 전달 대기' : '작업 가능'}</dd>
        </div>
      </dl>
      <section className="mt-5 border-t pt-4" aria-labelledby="work-note-title">
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
      {completionStateId ? (
        <section className="mt-5 border-t pt-4">
          <h3 className="font-medium">프론트에 전달하고 완료</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            변경 내용을 적고 전달할 프론트 역할을 선택해 주세요. 기존에 작성한 전달은 수정되지
            않습니다.
          </p>
          <div className="border-border bg-muted/40 mt-3 rounded-lg border px-3 py-2.5 text-sm">
            <p className="text-muted-foreground text-xs font-medium">전달 관계</p>
            <p className="mt-1 font-medium">
              {work.identifier} · {ROLE_LABELS[work.projectRole]} →{' '}
              {destinationRoles.length > 0
                ? destinationRoles.map((role) => ROLE_LABELS[role]).join(', ')
                : '전달할 프론트 역할을 선택해 주세요'}
            </p>
          </div>
          <fieldset className="mt-3 space-y-2">
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
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 grid gap-2">
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
          <details
            className="mt-3"
            open={handoffGuideOpen}
            onToggle={(event) => setHandoffGuideOpen(event.currentTarget.open)}
          >
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
          <Alert className="mt-3">
            <AlertTitle>알림 대상</AlertTitle>
            <AlertDescription>
              선택한 프론트 작업의 담당자와 구독자에게 알립니다. 새 미할당 작업은 대상 팀의 활성
              멤버에게 알립니다.
            </AlertDescription>
          </Alert>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setHandoffBody('');
                setDestinationRoles([]);
                setHandoffGuideOpen(false);
                setCompletionStateId(null);
              }}
            >
              취소
            </Button>
            <Button
              disabled={
                stateMutation.isPending || destinationRoles.length === 0 || handoffBodyInvalid
              }
              onClick={() => {
                const state = states.data?.items.find((item) => item.id === completionStateId);
                if (state)
                  stateMutation.mutate(
                    {
                      handoff: { bodyMarkdown: handoffBody, destinationRoles },
                      workflowState: state,
                    },
                    {
                      onSuccess: () => {
                        setHandoffBody('');
                        setDestinationRoles([]);
                        setHandoffGuideOpen(false);
                        setCompletionStateId(null);
                      },
                    },
                  );
              }}
            >
              전달하고 완료
            </Button>
          </div>
        </section>
      ) : null}
      <section className="mt-6 border-t pt-4" aria-labelledby="handoff-context-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="handoff-context-title" className="text-sm font-semibold">
            {work.projectRole === 'BACKEND' ? '보낸 전달' : '받은 전달'}
          </h3>
          <Link
            className="text-primary text-sm underline underline-offset-4"
            href={`/issues/${encodeURIComponent(issue.identifier)}?tab=handoffs&work=${encodeURIComponent(work.identifier)}${highlightedHandoffId ? `&handoff=${encodeURIComponent(highlightedHandoffId)}` : ''}`}
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
    </section>
  );
}

function LatestHandoff({
  handoff,
  initiallyExpanded,
}: {
  handoff: IssueDetailResponseDto['handoffFlows'][number];
  initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <li id={`handoff-${handoff.id}`} className="border-primary/50 border-l-2 pl-4 text-sm">
      <p className="font-medium">
        {handoff.kind === 'INITIAL' ? '최초 전달' : '추가 전달'} #{handoff.sequenceNumber}
      </p>
      <Button
        className="mt-1"
        size="sm"
        variant="ghost"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? '내용 접기' : '내용 펼치기'}
      </Button>
      {expanded ? (
        <>
          <MarkdownRenderer
            className="mt-2"
            imageUnavailableLabel="이미지를 표시할 수 없습니다"
            markdown={handoff.bodyMarkdown}
          />
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() =>
              document
                .getElementById('comments')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            댓글로 질문
          </Button>
        </>
      ) : null}
    </li>
  );
}

function HandoffHistoryItem({
  handoff,
  initiallyExpanded,
  pathname,
  searchParams,
}: {
  handoff: IssueDetailResponseDto['handoffFlows'][number];
  initiallyExpanded: boolean;
  pathname: string;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <li id={`handoff-${handoff.id}`} className="border-primary/40 border-l-2 pl-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <strong>
            {handoff.kind === 'INITIAL' ? '최초 전달' : '추가 전달'} #{handoff.sequenceNumber}
          </strong>
          <p className="text-muted-foreground mt-1">
            {handoff.sourceTeamWork.identifier} →{' '}
            {handoff.targets.map((target) => target.teamWork.identifier).join(', ')}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((current) => !current)}>
          {expanded ? '내용 접기' : '내용 펼치기'}
        </Button>
      </div>
      {expanded ? (
        <>
          <MarkdownRenderer
            className="mt-3"
            imageUnavailableLabel="이미지를 표시할 수 없습니다"
            markdown={handoff.bodyMarkdown}
          />
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = new URLSearchParams(searchParams.toString());
              next.set('tab', 'work');
              router.replace(`${pathname}?${next.toString()}#comments`, { scroll: false });
            }}
          >
            댓글로 질문
          </Button>
        </>
      ) : null}
    </li>
  );
}

export function IssueDetailScreen({ issueRef }: { issueRef: string }) {
  const markdown = useTranslations('Markdown');
  const editorLabels = markdownEditorLabels(
    (key) => markdown(key as never),
    (key) => String(markdown.raw(key as never)),
  );
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedWork = searchParams.get('work');
  const requestedHandoff = searchParams.get('handoff');
  const tab =
    searchParams.get('tab') === 'handoffs'
      ? 'handoffs'
      : searchParams.get('tab') === 'activity'
        ? 'activity'
        : 'work';
  const issueQuery = useIssuesControllerGet(issueRef, { query: { retry: false } });
  const legacyWork = useTeamWorksControllerGet(requestedWork ?? issueRef, {
    query: { enabled: Boolean(requestedWork) || issueQuery.isError, retry: false },
  });
  const issue = issueQuery.data;
  const selectedWork =
    issue?.teamWorks.find((work) => matchesRequestedTeamWork(work.identifier, requestedWork)) ??
    issue?.teamWorks[0];
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
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<{
    issueId: string;
    value: string;
  } | null>(null);
  const issueMutationError = start.error ?? updateIssue.error;

  useEffect(() => {
    if (!issueQuery.isError || !legacyWork.data) return;
    router.replace(
      `${issueWorkHref(legacyWork.data.issue.identifier, legacyWork.data.identifier)}${window.location.hash}`,
      { scroll: false },
    );
  }, [issueQuery.isError, legacyWork.data, router]);
  useEffect(() => {
    if (!issue || requestedWork || !selectedWork) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', 'work');
    next.set('work', selectedWork.identifier);
    router.replace(`${pathname}?${next.toString()}${window.location.hash}`, { scroll: false });
  }, [issue, pathname, requestedWork, router, searchParams, selectedWork]);
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

  if (issueQuery.isPending || (issueQuery.isError && legacyWork.isPending))
    return <ContentLoading label="통합 상세를 불러오는 중입니다" />;
  if (!issue && issueQuery.isError && legacyWork.isError)
    return (
      <ContentError
        title="이슈를 찾을 수 없습니다"
        description="주소를 확인하거나 목록으로 돌아가 주세요."
        retryLabel="다시 시도"
        onRetry={() => {
          void issueQuery.refetch();
          void legacyWork.refetch();
        }}
      />
    );
  if (!issue) return <ContentLoading label="정본 주소로 이동 중입니다" />;

  const currentIssue = issue;
  const description =
    descriptionDraft?.issueId === currentIssue.id
      ? descriptionDraft.value
      : (currentIssue.descriptionMarkdown ?? '');
  const availableRoles = (project.data?.roleTeams ?? [])
    .map(({ role }) => role)
    .filter((role) => !currentIssue.teamWorks.some((work) => work.projectRole === role));
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
      if (first)
        router.push(issueWorkHref(currentIssue.identifier, first.identifier), { scroll: false });
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
    <article className="mx-auto max-w-7xl space-y-6">
      <header className="space-y-4">
        <Link
          href="/issues"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          이슈 목록
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-muted-foreground font-mono text-sm">{issue.identifier}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {issue.title}
            </h1>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>{issue.project.name}</span>
              <PriorityDisplay priority={issue.priority} />
              <span className="tabular-nums">
                {issue.progress.percentage}% ({issue.progress.completed}/{issue.progress.total})
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IssueStatusDisplay status={issue.status} />
            {issue.status === 'REVIEW' ? (
              <Button size="sm" onClick={() => void statusAction('COMPLETE')}>
                <Check className="size-4" />
                이슈 완료
              </Button>
            ) : null}
            {issue.status === 'PAUSED' ? (
              <Button size="sm" variant="outline" onClick={() => void statusAction('RESUME')}>
                재개
              </Button>
            ) : issue.status === 'DONE' || issue.status === 'CANCELED' ? (
              <Button size="sm" variant="outline" onClick={() => void statusAction('REOPEN')}>
                다시 열기
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void statusAction('PAUSE')}>
                일시 중지
              </Button>
            )}
          </div>
        </div>
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
              <select
                aria-label="팀 작업 전환"
                className="bg-background h-10 w-full rounded-md border px-3 text-sm lg:hidden"
                value={selectedWork?.identifier ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams.toString());
                  next.set('tab', 'work');
                  next.set('work', event.target.value);
                  router.push(`${pathname}?${next.toString()}`, { scroll: false });
                }}
              >
                {issue.teamWorks.map((work) => (
                  <option key={work.id} value={work.identifier}>
                    {work.identifier} · {ROLE_LABELS[work.projectRole]} · {work.team.name}
                  </option>
                ))}
              </select>
              <nav className="hidden space-y-1 lg:block" aria-label="팀 작업 선택">
                {issue.teamWorks.map((work) => {
                  const active = work.id === selectedWork?.id;
                  const next = new URLSearchParams(searchParams.toString());
                  next.set('tab', 'work');
                  next.set('work', work.identifier);
                  return (
                    <Link
                      key={work.id}
                      href={`${pathname}?${next.toString()}`}
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
            <div className="bg-surface-2 rounded-lg border p-3">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Play className="size-4" />팀 작업 시작
              </h3>
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
            </div>
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
                  key={selectedWork.id}
                  highlightedHandoffId={requestedHandoff}
                  issue={issue}
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
              <section
                className="bg-surface-1 rounded-xl border p-4 sm:p-5"
                aria-labelledby="issue-content-title"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 id="issue-content-title" className="text-lg font-semibold">
                    이슈 설명
                  </h2>
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
                  <div className="prose prose-sm mt-4 max-w-none">
                    <MarkdownRenderer
                      imageUnavailableLabel="이미지를 표시할 수 없습니다"
                      markdown={issue.descriptionMarkdown}
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground mt-4 text-sm">등록된 설명이 없습니다.</p>
                )}
                <IssueAttachments issue={issue} />
                <div id="comments">
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
              </section>
            </>
          ) : null}
        </main>
      </div>
    </article>
  );
}
