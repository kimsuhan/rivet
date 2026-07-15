'use client';

import { Bookmark, Star, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type SavedViewResponseDto,
  useSavedViewsControllerCreate,
  useSavedViewsControllerList,
  useSavedViewsControllerRemove,
  useSavedViewsControllerSetDefault,
  useSavedViewsControllerUpdate,
} from '@rivet/api-client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePathname, useRouter } from '@/i18n/navigation';

const CONFIGURATION_KEYS = [
  'query',
  'projectId',
  'status',
  'stateCategory',
  'sort',
  'sortDirection',
  'density',
];

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '저장된 보기를 변경하지 못했습니다. 현재 목록은 유지됩니다.';
}

export function SavedViewControls({
  configuration,
  resourceType,
  staleValueMessage,
}: {
  configuration: Record<string, string>;
  resourceType: 'ISSUES' | 'MY_WORK';
  staleValueMessage?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const views = useSavedViewsControllerList({ resourceType }, { query: { retry: false } });
  const create = useSavedViewsControllerCreate();
  const update = useSavedViewsControllerUpdate();
  const remove = useSavedViewsControllerRemove();
  const setDefault = useSavedViewsControllerSetDefault();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [renameOpen, setRenameOpen] = useState<SavedViewResponseDto | null>(null);
  const [rename, setRename] = useState('');
  const [error, setError] = useState<string | null>(null);
  const appliedViewId = useRef<string | null>(null);
  const selectedId = searchParams.get('view');
  const hasExplicitConfiguration = CONFIGURATION_KEYS.some((key) => searchParams.has(key));

  const apply = useCallback(
    (view: SavedViewResponseDto) => {
      const next = new URLSearchParams();
      next.set('view', view.id);
      for (const [key, value] of Object.entries(view.configuration)) {
        if (typeof value === 'string' && CONFIGURATION_KEYS.includes(key)) next.set(key, value);
      }
      appliedViewId.current = view.id;
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  function refreshViews(): void {
    void views.refetch();
  }

  useEffect(() => {
    const items = views.data?.items;
    if (!items) return;
    if (selectedId) {
      const selected = items.find((view) => view.id === selectedId);
      if (selected && appliedViewId.current !== selected.id) apply(selected);
      return;
    }
    if (!hasExplicitConfiguration) {
      const defaultView = items.find((view) => view.isDefault);
      if (defaultView && appliedViewId.current !== defaultView.id) apply(defaultView);
    }
  }, [apply, hasExplicitConfiguration, selectedId, views.data]);

  const selected = views.data?.items.find((view) => view.id === selectedId) ?? null;
  const busy = create.isPending || update.isPending || remove.isPending || setDefault.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="저장된 보기">
      <Select
        items={[
          { label: '저장된 보기', value: '' },
          ...(views.data?.items ?? []).map((view) => ({
            label: `${view.isDefault ? '★ ' : ''}${view.name}`,
            value: view.id,
          })),
        ]}
        value={selectedId ?? ''}
        onValueChange={(value) => {
          const view = views.data?.items.find((item) => item.id === value);
          if (view) apply(view);
        }}
      >
        <SelectTrigger size="sm" aria-label="저장된 보기 열기">
          <Bookmark className="size-4" aria-hidden="true" />
          <SelectValue placeholder="저장된 보기" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="">저장된 보기</SelectItem>
            {(views.data?.items ?? []).map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.isDefault ? '★ ' : ''}
                {view.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
        현재 보기 저장
      </Button>
      {selected ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRename(selected.name);
              setRenameOpen(selected);
            }}
          >
            이름 변경
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || selected.isDefault}
            onClick={() => {
              setError(null);
              setDefault.mutate(
                { savedViewId: selected.id, data: { version: selected.version } },
                {
                  onError: (reason) => {
                    setError(errorMessage(reason));
                    refreshViews();
                  },
                  onSuccess: refreshViews,
                },
              );
            }}
          >
            <Star className="size-4" aria-hidden="true" /> 기본 보기
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              remove.mutate(
                { savedViewId: selected.id, params: { version: selected.version } },
                {
                  onError: (reason) => {
                    setError(errorMessage(reason));
                    refreshViews();
                  },
                  onSuccess: () => {
                    const next = new URLSearchParams(searchParams.toString());
                    next.delete('view');
                    router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, {
                      scroll: false,
                    });
                    refreshViews();
                  },
                },
              );
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" /> 삭제
          </Button>
        </>
      ) : null}
      {staleValueMessage ? (
        <p className="w-full text-sm text-amber-700" role="alert">
          {staleValueMessage}
        </p>
      ) : null}
      {selectedId && views.isSuccess && !selected ? (
        <p className="w-full text-sm text-amber-700" role="alert">
          이 저장된 보기는 삭제되었거나 더 이상 접근할 수 없습니다. 현재 필터를 수정해 새 보기로 저장할 수 있습니다.
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive w-full text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent closeLabel="저장된 보기 만들기 닫기">
          <DialogHeader>
            <DialogTitle>현재 보기 저장</DialogTitle>
            <DialogDescription>
              검색, 필터, 정렬과 표시 옵션을 나만 볼 수 있는 보기로 저장합니다.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="저장된 보기 이름"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              취소
            </Button>
            <Button
              disabled={busy || !name.trim()}
              onClick={() => {
                setError(null);
                create.mutate(
                  { data: { configuration, name, resourceType } },
                  {
                    onError: (reason) => {
                      setError(errorMessage(reason));
                      refreshViews();
                    },
                    onSuccess: (view) => {
                      setCreateOpen(false);
                      setName('');
                      refreshViews();
                      apply(view);
                    },
                  },
                );
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen !== null} onOpenChange={(open) => !open && setRenameOpen(null)}>
        <DialogContent closeLabel="저장된 보기 이름 변경 닫기">
          <DialogHeader>
            <DialogTitle>저장된 보기 이름 변경</DialogTitle>
            <DialogDescription>
              이름 충돌 또는 동시 변경이 있으면 기존 보기는 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="새 저장된 보기 이름"
            value={rename}
            onChange={(event) => setRename(event.target.value)}
            maxLength={100}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(null)}>
              취소
            </Button>
            <Button
              disabled={busy || !rename.trim() || !renameOpen}
              onClick={() => {
                if (!renameOpen) return;
                setError(null);
                update.mutate(
                  {
                    savedViewId: renameOpen.id,
                    data: { name: rename, version: renameOpen.version },
                  },
                  {
                    onError: (reason) => {
                      setError(errorMessage(reason));
                      refreshViews();
                    },
                    onSuccess: () => {
                      setRenameOpen(null);
                      refreshViews();
                    },
                  },
                );
              }}
            >
              변경
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
