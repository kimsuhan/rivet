'use client';

import {
  Bookmark,
  Check,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import {
  type SavedViewResponseDto,
  useSavedViewsControllerCreate,
  useSavedViewsControllerList,
  useSavedViewsControllerRemove,
  useSavedViewsControllerSetDefault,
  useSavedViewsControllerUpdate,
} from '@rivet/api-client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { normalizeSavedViewConfiguration, savedViewHref } from './saved-view-navigation';

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

function configurationsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const normalizedLeft = normalizeSavedViewConfiguration(left);
  const normalizedRight = normalizeSavedViewConfiguration(right);
  const keys = new Set([...Object.keys(normalizedLeft), ...Object.keys(normalizedRight)]);
  return [...keys].every((key) => normalizedLeft[key] === normalizedRight[key]);
}

export function SavedViewControls({
  activeFilters,
  children,
  configuration,
  defaultConfiguration = {},
  resourceType,
  staleValueMessage,
}: {
  activeFilters?: ReactNode;
  children?: ReactNode;
  configuration: Record<string, string>;
  defaultConfiguration?: Record<string, string>;
  resourceType: 'ISSUES' | 'MY_WORK';
  staleValueMessage?: string;
}) {
  const pathname = usePathname() as '/issues' | '/my-issues';
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
  const [deleteTarget, setDeleteTarget] = useState<SavedViewResponseDto | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appliedViewId = useRef<string | null>(null);
  const initialViewResolved = useRef(false);
  const selectedId = searchParams.get('view');
  const hasExplicitConfiguration = Object.keys(configuration).some((key) => searchParams.has(key));

  const apply = useCallback(
    (view: SavedViewResponseDto) => {
      appliedViewId.current = view.id;
      router.push(savedViewHref(pathname, view), { scroll: false });
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
      initialViewResolved.current = true;
      const selectedView = items.find((view) => view.id === selectedId);
      if (!selectedView) return;
      if (hasExplicitConfiguration) {
        appliedViewId.current = selectedView.id;
        return;
      }
      if (appliedViewId.current !== selectedView.id) apply(selectedView);
      return;
    }
    if (hasExplicitConfiguration) {
      initialViewResolved.current = true;
      return;
    }
    if (initialViewResolved.current) return;

    initialViewResolved.current = true;
    const defaultView = items.find((view) => view.isDefault);
    if (defaultView) apply(defaultView);
  }, [apply, hasExplicitConfiguration, selectedId, views.data]);

  const selected = views.data?.items.find((view) => view.id === selectedId) ?? null;
  const dirty = selected ? !configurationsEqual(configuration, selected.configuration) : false;
  const temporary = !selected && !configurationsEqual(configuration, defaultConfiguration);
  const busy = create.isPending || update.isPending || remove.isPending || setDefault.isPending;
  const resourceLabel = resourceType === 'ISSUES' ? '이슈' : '내 작업';

  function openCreate(): void {
    setError(null);
    setCreateOpen(true);
  }

  return (
    <div className="flex flex-col gap-3 border-b pb-3" aria-label="저장된 보기">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <nav
          aria-label={`${resourceLabel} 보기`}
          className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex"
        >
          <Link
            href={pathname}
            aria-current={!selected && !temporary ? 'page' : undefined}
            className={cn(
              buttonVariants({ size: 'sm', variant: 'ghost' }),
              'text-muted-foreground relative',
              !selected &&
                !temporary &&
                'text-foreground after:bg-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
            )}
          >
            전체
          </Link>
          {temporary ? (
            <span
              aria-current="page"
              className={cn(
                buttonVariants({ size: 'sm', variant: 'ghost' }),
                'text-foreground after:bg-primary relative after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              )}
            >
              임시 보기
              <span className="bg-primary size-1.5 rounded-full" aria-label="저장되지 않은 변경" />
            </span>
          ) : null}
          {(views.data?.items ?? []).map((view) => (
            <Link
              key={view.id}
              href={savedViewHref(pathname, view)}
              aria-current={selected?.id === view.id ? 'page' : undefined}
              className={cn(
                buttonVariants({ size: 'sm', variant: 'ghost' }),
                'text-muted-foreground relative max-w-48',
                selected?.id === view.id &&
                  'text-foreground after:bg-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              )}
            >
              {view.isDefault ? <Star data-icon="inline-start" aria-label="기본 보기" /> : null}
              <span className="truncate">{view.name}</span>
              {selected?.id === view.id && dirty ? (
                <span
                  className="bg-primary size-1.5 rounded-full"
                  aria-label="저장되지 않은 변경"
                />
              ) : null}
            </Link>
          ))}
          <Button className="text-muted-foreground" size="sm" variant="ghost" onClick={openCreate}>
            <Plus data-icon="inline-start" /> 새 보기
          </Button>
        </nav>

        <div className="min-w-0 flex-1 md:hidden">
          <Select
            items={[
              { label: '전체', value: '__all__' },
              ...(temporary ? [{ label: '임시 보기 · 변경됨', value: '__temporary__' }] : []),
              ...(views.data?.items ?? []).map((view) => ({
                label: `${view.isDefault ? '★ ' : ''}${view.name}`,
                value: view.id,
              })),
            ]}
            value={selected?.id ?? (temporary ? '__temporary__' : '__all__')}
            onValueChange={(value) => {
              if (value === '__all__') router.push(pathname, { scroll: false });
              const view = views.data?.items.find((item) => item.id === value);
              if (view) apply(view);
            }}
          >
            <SelectTrigger size="sm" aria-label="현재 보기">
              <Bookmark data-icon="inline-start" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__all__">전체</SelectItem>
                {temporary ? (
                  <SelectItem value="__temporary__">임시 보기 · 변경됨</SelectItem>
                ) : null}
                {(views.data?.items ?? []).map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {view.isDefault ? '★ ' : ''}
                    {view.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            className="md:hidden"
            size="icon-sm"
            variant="ghost"
            onClick={openCreate}
            aria-label="새 보기"
          >
            <Plus />
          </Button>
          {selected ? (
            <Popover open={manageOpen} onOpenChange={setManageOpen}>
              <PopoverTrigger
                type="button"
                aria-label={`${selected.name} 보기 관리`}
                className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })}
              >
                <MoreHorizontal />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 gap-1 p-1">
                <PopoverTitle className="px-2 py-1.5 text-sm">{selected.name}</PopoverTitle>
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setManageOpen(false);
                    setRename(selected.name);
                    setRenameOpen(selected);
                  }}
                >
                  <Pencil data-icon="inline-start" /> 이름 변경
                </Button>
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="ghost"
                  disabled={busy || selected.isDefault}
                  title={selected.isDefault ? '이미 기본 보기입니다' : undefined}
                  onClick={() => {
                    setError(null);
                    setDefault.mutate(
                      { savedViewId: selected.id, data: { version: selected.version } },
                      {
                        onError: (reason) => {
                          setError(errorMessage(reason));
                          refreshViews();
                        },
                        onSuccess: () => {
                          setManageOpen(false);
                          refreshViews();
                        },
                      },
                    );
                  }}
                >
                  {selected.isDefault ? (
                    <Check data-icon="inline-start" />
                  ) : (
                    <Star data-icon="inline-start" />
                  )}
                  {selected.isDefault ? '기본 보기' : '기본 보기로 지정'}
                </Button>
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setManageOpen(false);
                    setDeleteTarget(selected);
                  }}
                >
                  <Trash2 data-icon="inline-start" /> 보기 삭제
                </Button>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
        <div className="flex shrink-0 items-center gap-1">
          {selected && dirty ? (
            <>
              <span className="text-muted-foreground mr-1 hidden text-xs sm:inline">변경됨</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply(selected)}>
                <RotateCcw data-icon="inline-start" /> 초기화
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={openCreate}>
                새 보기로 저장
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  update.mutate(
                    {
                      savedViewId: selected.id,
                      data: { configuration, version: selected.version },
                    },
                    {
                      onError: (reason) => {
                        setError(errorMessage(reason));
                        refreshViews();
                      },
                      onSuccess: (view) => {
                        refreshViews();
                        apply(view);
                      },
                    },
                  );
                }}
              >
                <Save data-icon="inline-start" /> 변경 저장
              </Button>
            </>
          ) : temporary ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={openCreate}>
              <Save data-icon="inline-start" /> 보기 저장
            </Button>
          ) : null}
        </div>
      </div>

      {activeFilters ? (
        <div className="flex flex-wrap items-center gap-1">{activeFilters}</div>
      ) : null}
      {staleValueMessage ? (
        <p className="text-warning w-full text-sm" role="alert">
          {staleValueMessage}
        </p>
      ) : null}
      {selectedId && views.isSuccess && !selected ? (
        <p className="text-warning w-full text-sm" role="alert">
          이 저장된 보기는 삭제되었거나 더 이상 접근할 수 없습니다. 현재 필터를 수정해 새 보기로
          저장할 수 있습니다.
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive w-full text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent closeLabel="새 보기 만들기 닫기">
          <DialogHeader>
            <DialogTitle>새 보기 만들기</DialogTitle>
            <DialogDescription>
              현재 검색, 필터, 정렬과 표시 설정을 나만 볼 수 있는 보기로 저장합니다.
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
              보기 저장
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 보기를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name ?? '선택한 보기'}만 삭제되며 현재 목록과 이슈는 유지됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>취소</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={remove.isPending || !deleteTarget}
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                setError(null);
                remove.mutate(
                  { savedViewId: deleteTarget.id, params: { version: deleteTarget.version } },
                  {
                    onError: (reason) => {
                      setError(errorMessage(reason));
                      setDeleteTarget(null);
                      refreshViews();
                    },
                    onSuccess: () => {
                      const next = new URLSearchParams(searchParams.toString());
                      next.delete('view');
                      router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, {
                        scroll: false,
                      });
                      setDeleteTarget(null);
                      refreshViews();
                    },
                  },
                );
              }}
            >
              보기 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
