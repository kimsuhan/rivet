'use client';

import { useQueryClient } from '@tanstack/react-query';
import { BellRing, CircleAlert, Laptop, Send, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  getNotificationsControllerPushSubscriptionsQueryKey,
  type RegisterWebPushSubscriptionDtoBrowser,
  useAuthControllerGetSession,
  useNotificationsControllerDeactivatePushSubscription,
  useNotificationsControllerPushConfig,
  useNotificationsControllerPushSubscriptions,
  useNotificationsControllerRegisterPushSubscription,
  useNotificationsControllerRequestPushTest,
  type WebPushSubscriptionResponseDto,
} from '@rivet/api-client';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

type BrowserPermissionState = 'default' | 'denied' | 'expired' | 'granted' | 'unsupported';

function browserType(): RegisterWebPushSubscriptionDtoBrowser {
  const userAgent = navigator.userAgent;
  if (userAgent.includes('Edg/')) return 'EDGE';
  if (userAgent.includes('Firefox/')) return 'FIREFOX';
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'SAFARI';
  if (userAgent.includes('Chrome/')) return 'CHROME';
  return 'OTHER';
}

function applicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(`${value.replaceAll('-', '+').replaceAll('_', '/')}${padding}`);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes.buffer;
}

function localOptInKey(membershipId: string): string {
  return `rivet.web-push.enabled:${membershipId}`;
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/rivet-push-sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
  void registration.update().catch(() => undefined);
  return registration;
}

export function WebPushSettings({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const t = useTranslations('Notifications.push');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const config = useNotificationsControllerPushConfig({ query: { retry: false } });
  const subscriptions = useNotificationsControllerPushSubscriptions({ query: { retry: false } });
  const registerSubscription = useNotificationsControllerRegisterPushSubscription();
  const deactivateSubscription = useNotificationsControllerDeactivatePushSubscription();
  const requestTest = useNotificationsControllerRequestPushTest();
  const [browserPermission, setBrowserPermission] = useState<BrowserPermissionState>('unsupported');
  const [browserSubscription, setBrowserSubscription] = useState<PushSubscription | null>(null);
  const [localExpired, setLocalExpired] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [endpointRecovered, setEndpointRecovered] = useState(false);
  const [deactivationCandidate, setDeactivationCandidate] =
    useState<WebPushSubscriptionResponseDto | null>(null);
  const [testedSubscriptionId, setTestedSubscriptionId] = useState<string | null>(null);
  const backgroundSyncAttempted = useRef(false);

  const membershipId =
    session.data?.authenticated === true ? (session.data.membership?.id ?? null) : null;
  const currentSubscription = subscriptions.data?.items.find((item) => item.isCurrentSession);
  const currentActive = currentSubscription?.status === 'ACTIVE' ? currentSubscription : undefined;

  const refreshList = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: getNotificationsControllerPushSubscriptionsQueryKey(),
    });
  }, [queryClient]);

  const syncSubscription = useCallback(
    async (subscription: PushSubscription): Promise<void> => {
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.auth || !serialized.keys.p256dh) {
        throw new Error('브라우저 Push 구독에 필요한 키가 없습니다.');
      }

      await registerSubscription.mutateAsync({
        data: {
          browser: browserType(),
          endpoint: serialized.endpoint,
          expirationTime: serialized.expirationTime ?? null,
          keys: { auth: serialized.keys.auth, p256dh: serialized.keys.p256dh },
        },
      });
      await refreshList();
      setBrowserSubscription(subscription);
      setLocalExpired(false);
    },
    [refreshList, registerSubscription],
  );

  useEffect(() => {
    let canceled = false;
    if (
      !('Notification' in window) ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      return () => {
        canceled = true;
      };
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'RIVET_PUSH_SUBSCRIPTION_EXPIRED') {
        setBrowserSubscription(null);
        setLocalExpired(true);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    void Promise.resolve().then(async () => {
      if (canceled) return;
      const permission = Notification.permission;
      setBrowserPermission(permission);
      if (permission !== 'granted') return;

      try {
        const registration = await serviceWorkerRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (canceled) return;
        setBrowserSubscription(subscription);
        if (!subscription && membershipId && localStorage.getItem(localOptInKey(membershipId))) {
          setLocalExpired(true);
        }
      } catch {
        if (!canceled) setLocalExpired(true);
      }
    });

    return () => {
      canceled = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [membershipId]);

  useEffect(() => {
    if (
      backgroundSyncAttempted.current ||
      browserPermission !== 'granted' ||
      !browserSubscription ||
      !membershipId ||
      currentActive ||
      !config.data?.enabled ||
      !localStorage.getItem(localOptInKey(membershipId))
    ) {
      return;
    }

    backgroundSyncAttempted.current = true;
    void syncSubscription(browserSubscription).catch(() => setActionError(true));
  }, [
    browserPermission,
    browserSubscription,
    config.data?.enabled,
    currentActive,
    membershipId,
    syncSubscription,
  ]);

  async function enable(): Promise<void> {
    setActionError(false);
    setEndpointRecovered(false);
    try {
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
        setBrowserPermission(permission);
      }
      if (permission !== 'granted' || !config.data?.publicKey || !membershipId) return;

      backgroundSyncAttempted.current = true;
      const registration = await serviceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        if (currentActive) {
          await deactivateSubscription.mutateAsync({ subscriptionId: currentActive.id });
        }
        subscription = await registration.pushManager.subscribe({
          applicationServerKey: applicationServerKey(config.data.publicKey),
          userVisibleOnly: true,
        });
      }
      try {
        await syncSubscription(subscription);
      } catch (error) {
        const isEndpointConflict =
          error instanceof ApiError &&
          error.status === 409 &&
          typeof error.body === 'object' &&
          error.body !== null &&
          'code' in error.body &&
          error.body.code === 'WEB_PUSH_SUBSCRIPTION_IN_USE';
        if (!isEndpointConflict) throw error;

        await subscription.unsubscribe();
        subscription = await registration.pushManager.subscribe({
          applicationServerKey: applicationServerKey(config.data.publicKey),
          userVisibleOnly: true,
        });
        await syncSubscription(subscription);
        setEndpointRecovered(true);
      }
      localStorage.setItem(localOptInKey(membershipId), 'true');
      setBrowserPermission('granted');
    } catch {
      setActionError(true);
    }
  }

  async function deactivate(item: WebPushSubscriptionResponseDto): Promise<void> {
    setActionError(false);
    try {
      await deactivateSubscription.mutateAsync({ subscriptionId: item.id });
      if (item.isCurrentSession && browserSubscription) {
        await browserSubscription.unsubscribe();
        setBrowserSubscription(null);
      }
      if (item.isCurrentSession && membershipId) {
        localStorage.removeItem(localOptInKey(membershipId));
      }
      setLocalExpired(false);
      await refreshList();
      setDeactivationCandidate(null);
    } catch {
      setActionError(true);
    }
  }

  async function test(item: WebPushSubscriptionResponseDto): Promise<void> {
    setActionError(false);
    setTestedSubscriptionId(null);
    try {
      await requestTest.mutateAsync({ subscriptionId: item.id });
      setTestedSubscriptionId(item.id);
    } catch {
      setActionError(true);
    }
  }

  const state: BrowserPermissionState =
    browserPermission === 'granted' && (localExpired || currentSubscription?.status === 'EXPIRED')
      ? 'expired'
      : browserPermission;
  const busy =
    registerSubscription.isPending || deactivateSubscription.isPending || requestTest.isPending;
  const isReady = config.data?.enabled && state === 'granted' && Boolean(currentActive);
  const showEnableAction =
    config.data?.enabled && state !== 'unsupported' && state !== 'denied' && !isReady;
  const showInboxNotice =
    !config.isPending &&
    !subscriptions.isPending &&
    config.data?.enabled &&
    !isReady &&
    state !== 'unsupported';

  function enableLabel(): string {
    if (state === 'expired') return t('reregister');
    if (browserPermission === 'granted') return t('connect');
    return t('enable');
  }

  return (
    <>
      {showInboxNotice ? (
        <Alert className="mt-4">
          <BellRing aria-hidden="true" />
          <AlertTitle>{t(`stateTitles.${state}`)}</AlertTitle>
          <AlertDescription>{t(`stateHelp.${state}`)}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="sm"
              variant={showEnableAction ? 'outline' : 'ghost'}
              disabled={busy}
              onClick={() => {
                if (showEnableAction) {
                  void enable();
                  return;
                }
                onOpenChange(true);
              }}
            >
              {showEnableAction ? enableLabel() : t('openSettings')}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeactivationCandidate(null);
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent closeLabel={t('close')} className="gap-5 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {config.isPending || subscriptions.isPending ? (
            <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner />
              {t('loading')}
            </div>
          ) : null}

          {!config.isPending && !subscriptions.isPending ? (
            <div className="flex items-start gap-3 border-y py-4">
              <span className="bg-surface-2 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                <BellRing aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {isReady ? t('readyTitle') : t(`stateTitles.${state}`)}
                  </p>
                  <Badge variant={isReady ? 'secondary' : 'outline'}>{t(`states.${state}`)}</Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-sm leading-6">
                  {isReady
                    ? t('readyHelp')
                    : config.data?.enabled
                      ? t(`stateHelp.${state}`)
                      : t('notConfigured')}
                </p>
                {showEnableAction ? (
                  <Button
                    className="mt-3"
                    type="button"
                    disabled={busy}
                    onClick={() => void enable()}
                  >
                    {registerSubscription.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {enableLabel()}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {state === 'denied' || state === 'unsupported' || !config.data?.enabled ? (
            <Alert>
              <CircleAlert aria-hidden="true" />
              <AlertTitle>{t('recoveryTitle')}</AlertTitle>
              <AlertDescription>
                {t(
                  state === 'denied'
                    ? 'deniedRecovery'
                    : state === 'unsupported'
                      ? 'unsupportedRecovery'
                      : 'operatorRecovery',
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {actionError || config.isError || subscriptions.isError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>{t('errorTitle')}</AlertTitle>
              <AlertDescription>{t('errorDescription')}</AlertDescription>
            </Alert>
          ) : null}

          {endpointRecovered && !actionError ? (
            <Alert>
              <BellRing aria-hidden="true" />
              <AlertTitle>{t('endpointRecoveredTitle')}</AlertTitle>
              <AlertDescription>{t('endpointRecoveredDescription')}</AlertDescription>
            </Alert>
          ) : null}

          {deactivationCandidate ? (
            <Alert variant="destructive">
              <Trash2 aria-hidden="true" />
              <AlertTitle>{t('deactivateTitle')}</AlertTitle>
              <AlertDescription>
                {t('deactivateDescription', {
                  browser: t(`browsers.${deactivationCandidate.browser}`),
                })}
              </AlertDescription>
              <div className="col-start-2 mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeactivationCandidate(null)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void deactivate(deactivationCandidate)}
                >
                  {deactivateSubscription.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {t('deactivateConfirm')}
                </Button>
              </div>
            </Alert>
          ) : null}

          {subscriptions.data?.items.length ? (
            <section className="flex flex-col gap-3" aria-labelledby="web-push-browsers-title">
              <div className="flex flex-col gap-0.5">
                <h3 id="web-push-browsers-title" className="text-sm font-medium">
                  {t('browsersTitle', { count: subscriptions.data.items.length })}
                </h3>
                <p className="text-muted-foreground text-xs leading-5">{t('browsersHelp')}</p>
              </div>
              <ul className="divide-y rounded-lg border" aria-label={t('browsersLabel')}>
                {subscriptions.data.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="bg-surface-2 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                        <Laptop aria-hidden="true" className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t(`browsers.${item.browser}`)}</span>
                          {item.isCurrentSession ? (
                            <span className="text-muted-foreground text-xs">{t('current')}</span>
                          ) : null}
                          <Badge variant={item.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                            {t(`serverStates.${item.status}`)}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {item.lastSucceededAt
                            ? t('lastSucceeded', {
                                date: format.dateTime(new Date(item.lastSucceededAt), {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                }),
                              })
                            : item.lastFailedAt
                              ? t('lastFailed', {
                                  date: format.dateTime(new Date(item.lastFailedAt), {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                  }),
                                })
                              : t('notTested')}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
                      <div className="flex gap-2 sm:justify-end">
                        {item.status === 'ACTIVE' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-11 flex-1 sm:h-8 sm:flex-none"
                            disabled={busy}
                            onClick={() => void test(item)}
                          >
                            <Send data-icon="inline-start" />
                            {t('test')}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-11 flex-1 sm:h-8 sm:flex-none"
                          disabled={busy}
                          onClick={() => setDeactivationCandidate(item)}
                        >
                          <Trash2 data-icon="inline-start" />
                          {t('deactivate')}
                        </Button>
                      </div>
                      {testedSubscriptionId === item.id ? (
                        <p role="status" className="text-muted-foreground text-xs">
                          {t('testAccepted')}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
