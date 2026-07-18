'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { useFormatter } from 'next-intl';
import { useState } from 'react';

import {
  type FeedbackControllerListCategory,
  type FeedbackControllerListStatus,
  type FeedbackResponseDto,
  getFeedbackControllerListQueryKey,
  useFeedbackControllerList,
  useFeedbackControllerUpdateStatus,
} from '@rivet/api-client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

export type FeedbackSettingsLabels = {
  allCategories: string;
  allStatuses: string;
  categories: Record<FeedbackControllerListCategory, string>;
  categoryFilter: string;
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  errorDescription: string;
  errorTitle: string;
  loadMore: string;
  loading: string;
  path: string;
  release: string;
  retry: string;
  statusError: string;
  statuses: Record<FeedbackControllerListStatus, string>;
  statusFilter: string;
  submittedAt: string;
  title: string;
};

const categories: FeedbackControllerListCategory[] = ['BUG', 'USABILITY', 'IDEA', 'OTHER'];
const statuses: FeedbackControllerListStatus[] = [
  'RECEIVED',
  'IN_REVIEW',
  'IMPLEMENTED',
  'DEFERRED',
];

export function FeedbackSettingsScreen({ labels }: { labels: FeedbackSettingsLabels }) {
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<FeedbackControllerListCategory | 'ALL'>('ALL');
  const [status, setStatus] = useState<FeedbackControllerListStatus | 'ALL'>('ALL');
  const [cursor, setCursor] = useState<string | undefined>();
  const [items, setItems] = useState<FeedbackResponseDto[]>([]);
  const params = {
    ...(category === 'ALL' ? {} : { category }),
    ...(status === 'ALL' ? {} : { status }),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  };
  const feedback = useFeedbackControllerList(params, {
    query: {
      retry: false,
      select: (data) => ({ ...data, items: cursor ? [...items, ...data.items] : data.items }),
    },
  });
  const updateStatus = useFeedbackControllerUpdateStatus({
    mutation: {
      onError: async () => {
        setCursor(undefined);
        setItems([]);
        await queryClient.invalidateQueries({ queryKey: getFeedbackControllerListQueryKey() });
      },
      onSuccess: async () => {
        setCursor(undefined);
        setItems([]);
        await queryClient.invalidateQueries({ queryKey: getFeedbackControllerListQueryKey() });
      },
    },
  });
  const categoryItems = [
    { label: labels.allCategories, value: 'ALL' },
    ...categories.map((value) => ({ label: labels.categories[value], value })),
  ];
  const statusItems = [
    { label: labels.allStatuses, value: 'ALL' },
    ...statuses.map((value) => ({ label: labels.statuses[value], value })),
  ];

  function changeFilter(setter: (value: never) => void, value: string | null) {
    if (!value) return;
    setCursor(undefined);
    setItems([]);
    setter(value as never);
  }

  const visibleItems = feedback.data?.items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{labels.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{labels.description}</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Select
          items={categoryItems}
          value={category}
          onValueChange={(value) => changeFilter(setCategory as (value: never) => void, value)}
        >
          <SelectTrigger aria-label={labels.categoryFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={statusItems}
          value={status}
          onValueChange={(value) => changeFilter(setStatus as (value: never) => void, value)}
        >
          <SelectTrigger aria-label={labels.statusFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {feedback.isPending ? (
        <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm">
          <Spinner />
          {labels.loading}
        </div>
      ) : null}
      {feedback.isError ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareText />
            </EmptyMedia>
            <EmptyTitle>{labels.errorTitle}</EmptyTitle>
            <EmptyDescription>{labels.errorDescription}</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => feedback.refetch()}>
            {labels.retry}
          </Button>
        </Empty>
      ) : null}
      {!feedback.isPending && !feedback.isError && visibleItems.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareText />
            </EmptyMedia>
            <EmptyTitle>{labels.emptyTitle}</EmptyTitle>
            <EmptyDescription>{labels.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <div className="space-y-3">
        {visibleItems.map((item) => (
          <Card key={item.id} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline">{labels.categories[item.category]}</Badge>
                <span className="text-muted-foreground font-mono text-xs font-normal">
                  {item.id.slice(0, 8)}
                </span>
              </CardTitle>
              <CardDescription>
                {labels.submittedAt}{' '}
                {format.dateTime(new Date(item.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </CardDescription>
              <CardAction>
                <Select
                  items={statuses.map((value) => ({ label: labels.statuses[value], value }))}
                  value={item.status}
                  disabled={updateStatus.isPending}
                  onValueChange={(value) => {
                    if (!value || value === item.status) return;
                    updateStatus.mutate({
                      feedbackId: item.id,
                      data: { status: value, version: item.version },
                    });
                  }}
                >
                  <SelectTrigger aria-label={`${item.id} ${labels.statusFilter}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((value) => (
                      <SelectItem key={value} value={value}>
                        {labels.statuses[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-6 whitespace-pre-wrap">{item.body}</p>
              <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
                <dt>{labels.path}</dt>
                <dd className="font-mono break-all">{item.currentPath}</dd>
                <dt>{labels.release}</dt>
                <dd className="font-mono break-all">{item.releaseId}</dd>
              </dl>
              {updateStatus.isError ? (
                <p role="alert" className="text-destructive text-xs">
                  {labels.statusError}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {feedback.data?.nextCursor ? (
        <Button
          variant="outline"
          onClick={() => {
            setItems(visibleItems);
            setCursor(feedback.data?.nextCursor ?? undefined);
          }}
        >
          {labels.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
