import { normalizeIssueSorts, serializeIssueSorts } from './issue-multi-sort';

const SAVED_VIEW_CONFIGURATION_KEYS = [
  'query',
  'projectId',
  'status',
  'stateCategory',
  'sort',
  'sortDirection',
  'sorts',
  'density',
] as const;

const SAVED_VIEW_QUERY_KEYS = ['view', ...SAVED_VIEW_CONFIGURATION_KEYS] as const;

function storageKey(membershipId: string, pathname: '/issues' | '/my-issues'): string {
  return `rivet:saved-view-navigation:v1:${membershipId}:${pathname}`;
}

function normalizeSavedViewSearch(search: string): string | null {
  const current = new URLSearchParams(search);
  if (!current.get('view')) return null;

  const next = new URLSearchParams();
  for (const key of SAVED_VIEW_QUERY_KEYS) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
}

export function normalizeSavedViewConfiguration(
  configuration: Record<string, unknown>,
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const key of SAVED_VIEW_CONFIGURATION_KEYS) {
    const value = configuration[key];
    if (key === 'sorts') {
      const sorts = normalizeIssueSorts(value);
      if (sorts) normalized.sorts = serializeIssueSorts(sorts);
      continue;
    }
    if (typeof value === 'string' && value) normalized[key] = value;
  }

  return normalized;
}

export function savedViewHref(
  pathname: '/issues' | '/my-issues',
  view: { configuration: Record<string, unknown>; id: string },
): string {
  const search = new URLSearchParams({ view: view.id });
  for (const [key, value] of Object.entries(normalizeSavedViewConfiguration(view.configuration))) {
    search.set(key, value);
  }
  return `${pathname}?${search.toString()}`;
}

export function rememberSavedViewNavigation(
  membershipId: string | undefined,
  pathname: string,
  search: string,
): void {
  if (!membershipId || (pathname !== '/issues' && pathname !== '/my-issues')) return;

  try {
    const key = storageKey(membershipId, pathname);
    const normalizedSearch = normalizeSavedViewSearch(search);
    if (normalizedSearch) window.sessionStorage.setItem(key, normalizedSearch);
    else window.sessionStorage.removeItem(key);
  } catch {
    // 브라우저 저장소를 사용할 수 없어도 목록 이동은 기본 주소로 계속한다.
  }
}

export function savedViewNavigationHref(
  membershipId: string | undefined,
  href: '/issues' | '/my-issues',
  pathname: string,
  search: string,
): string {
  const currentSearch = pathname === href ? normalizeSavedViewSearch(search) : null;
  if (currentSearch) return `${href}?${currentSearch}`;
  if (!membershipId) return href;

  try {
    const storedSearch = normalizeSavedViewSearch(
      window.sessionStorage.getItem(storageKey(membershipId, href)) ?? '',
    );
    return storedSearch ? `${href}?${storedSearch}` : href;
  } catch {
    return href;
  }
}
