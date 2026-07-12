import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportsControllerIssues, exportsControllerProjects } from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { ExportSettingsScreen } from './export-settings-screen';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  exportsControllerIssues: vi.fn(),
  exportsControllerProjects: vi.fn(),
}));

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      <ExportSettingsScreen />
    </NextIntlClientProvider>,
  );
}

describe('ExportSettingsScreen', () => {
  let downloadedFilename = '';

  beforeEach(() => {
    vi.clearAllMocks();
    downloadedFilename = '';
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:rivet-export'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
    });
    vi.mocked(exportsControllerIssues).mockResolvedValue(new Blob(['issues']));
    vi.mocked(exportsControllerProjects).mockResolvedValue(new Blob(['projects']));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('이슈·프로젝트 포함 필드와 민감 업무 내용 경고를 실행 전에 표시한다', () => {
    renderScreen();

    expect(
      screen.getByRole('heading', { level: 1, name: messages.Settings.export.title }),
    ).toBeVisible();
    expect(screen.getByText(messages.Settings.export.warningDescription)).toBeVisible();
    expect(screen.getByText(messages.Settings.export.issues.fields)).toBeVisible();
    expect(screen.getByText(messages.Settings.export.projects.fields)).toBeVisible();
    expect(screen.getByText(messages.Settings.export.noImport)).toBeVisible();
  });

  it('생성된 Blob을 계약 파일명으로 받고 현재 화면에 완료 시각을 남긴다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const issueCard = screen
      .getByText(messages.Settings.export.issues.title)
      .closest('[data-slot=card]');
    expect(issueCard).not.toBeNull();
    const issueExport = screen.getAllByRole('link', { name: messages.Settings.export.export })[0]!;
    expect(issueExport).toHaveAttribute('href', '/api/v1/exports/issues.csv');
    expect(issueExport).toHaveAttribute('download');
    await user.click(issueExport);

    await waitFor(() => expect(exportsControllerIssues).toHaveBeenCalledTimes(1));
    expect(exportsControllerIssues).toHaveBeenCalledWith({ headers: { Accept: 'text/csv' } });
    expect(downloadedFilename).toMatch(/^rivet-issues-\d{8}\.csv$/);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rivet-export'));
    expect(
      screen.getByRole('link', { name: messages.Settings.export.exportAgain }),
    ).not.toHaveAttribute('aria-disabled');
    expect(issueCard).toHaveTextContent(/다운로드를 시작했습니다/);
  });

  it('프로젝트 내보내기 링크를 누르면 프로젝트 CSV 분기를 실행한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const projectExport = screen.getAllByRole('link', {
      name: messages.Settings.export.export,
    })[1]!;
    expect(projectExport).toHaveAttribute('href', '/api/v1/exports/projects.csv');
    expect(projectExport).toHaveAttribute('download');
    await user.click(projectExport);

    await waitFor(() => expect(exportsControllerProjects).toHaveBeenCalledTimes(1));
    expect(exportsControllerProjects).toHaveBeenCalledWith({ headers: { Accept: 'text/csv' } });
    expect(exportsControllerIssues).not.toHaveBeenCalled();
    expect(downloadedFilename).toMatch(/^rivet-projects-\d{8}\.csv$/);
  });

  it('서버와 같은 UTC 날짜로 파일명을 만든다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T23:30:00.000Z'));
    renderScreen();

    fireEvent.click(screen.getAllByRole('link', { name: messages.Settings.export.export })[0]!);
    await vi.runAllTimersAsync();

    expect(downloadedFilename).toBe('rivet-issues-20260710.csv');
  });

  it('생성 중에는 두 내보내기를 막고 실패한 카드에서 다시 시도한다', async () => {
    const user = userEvent.setup();
    let rejectExport: ((reason: Error) => void) | undefined;
    vi.mocked(exportsControllerIssues).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectExport = reject;
        }),
    );
    renderScreen();

    const links = screen.getAllByRole('link', { name: messages.Settings.export.export });
    await user.click(links[0]!);
    expect(links[0]).toHaveAttribute('aria-disabled', 'true');
    expect(links[1]).toHaveAttribute('aria-disabled', 'true');
    expect(exportsControllerIssues).toHaveBeenCalledTimes(1);

    rejectExport?.(new Error('network failed'));
    expect(await screen.findByText(messages.Settings.export.failureTitle)).toBeVisible();
    await user.click(screen.getByRole('link', { name: messages.Settings.export.retry }));

    await waitFor(() => expect(exportsControllerIssues).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole('link', { name: messages.Settings.export.exportAgain }),
    ).not.toHaveAttribute('aria-disabled');
  });
});
