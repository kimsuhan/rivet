const COLLAPSED_SECTIONS_STORAGE = 'rivet:sidebar-collapsed-sections:v1';
const COLLAPSED_SECTIONS_EVENT = 'rivet:sidebar-collapsed-sections-change';

const EMPTY_SECTIONS: Record<string, boolean> = {};

// useSyncExternalStore는 같은 값이면 같은 참조를 돌려받아야 해서 마지막 결과를 기억한다.
let cachedRaw: string | null = null;
let cachedSections: Record<string, boolean> = EMPTY_SECTIONS;

function parseCollapsedSections(raw: string | null): Record<string, boolean> {
  if (!raw) return EMPTY_SECTIONS;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_SECTIONS;

    return Object.fromEntries(
      parsed.filter((key): key is string => typeof key === 'string').map((key) => [key, true]),
    );
  } catch {
    return EMPTY_SECTIONS;
  }
}

export function readCollapsedSections(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedSections = parseCollapsedSections(raw);
    }
  } catch {
    // 브라우저 저장소를 사용할 수 없으면 메모리에 남은 마지막 상태를 쓴다.
  }

  return cachedSections;
}

export function readServerCollapsedSections(): Record<string, boolean> {
  return EMPTY_SECTIONS;
}

export function rememberCollapsedSections(sections: Record<string, boolean>): void {
  const collapsed = Object.entries(sections)
    .filter(([, isCollapsed]) => isCollapsed)
    .map(([key]) => key);

  cachedRaw = JSON.stringify(collapsed);
  cachedSections = Object.fromEntries(collapsed.map((key) => [key, true]));

  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_STORAGE, cachedRaw);
  } catch {
    // 저장하지 못해도 이번 세션의 접기 상태는 유지한다.
  }

  window.dispatchEvent(new Event(COLLAPSED_SECTIONS_EVENT));
}

export function subscribeCollapsedSections(onStoreChange: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key === COLLAPSED_SECTIONS_STORAGE) onStoreChange();
  }

  window.addEventListener('storage', handleStorage);
  window.addEventListener(COLLAPSED_SECTIONS_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(COLLAPSED_SECTIONS_EVENT, onStoreChange);
  };
}
