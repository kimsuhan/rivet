const LAST_TEAM_KEY_STORAGE = 'rivet:last-team-key:v1';
const LAST_TEAM_VIEW_STORAGE = 'rivet:last-team-view:v1';
const LAST_TEAM_VIEW_EVENT = 'rivet:last-team-view-change';

export type TeamView = 'board' | 'issues';

export function readLastTeamKey(): string | null {
  try {
    return window.localStorage.getItem(LAST_TEAM_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function rememberTeamKey(teamKey: string): void {
  try {
    window.localStorage.setItem(LAST_TEAM_KEY_STORAGE, teamKey);
  } catch {
    // 브라우저 저장소를 사용할 수 없어도 팀 이동 자체는 계속한다.
  }
}

export function readLastTeamView(): TeamView {
  try {
    return window.localStorage.getItem(LAST_TEAM_VIEW_STORAGE) === 'board' ? 'board' : 'issues';
  } catch {
    return 'issues';
  }
}

export function rememberTeamView(view: TeamView): void {
  try {
    window.localStorage.setItem(LAST_TEAM_VIEW_STORAGE, view);
    window.dispatchEvent(new Event(LAST_TEAM_VIEW_EVENT));
  } catch {
    // 브라우저 저장소를 사용할 수 없어도 팀 이동 자체는 계속한다.
  }
}

export function subscribeLastTeamView(onStoreChange: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key === LAST_TEAM_VIEW_STORAGE) onStoreChange();
  }

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LAST_TEAM_VIEW_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LAST_TEAM_VIEW_EVENT, onStoreChange);
  };
}
