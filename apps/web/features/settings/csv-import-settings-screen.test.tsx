import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  csvImportControllerInspect,
  csvImportControllerListRuns,
  csvImportControllerMappingOptions,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { CsvImportSettingsScreen } from './csv-import-settings-screen';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  csvImportControllerExecute: vi.fn(),
  csvImportControllerInspect: vi.fn(),
  csvImportControllerListRuns: vi.fn(),
  csvImportControllerMappingOptions: vi.fn(),
  csvImportControllerValidate: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.ComponentProps<'a'>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      <CsvImportSettingsScreen />
    </NextIntlClientProvider>,
  );
}

describe('CsvImportSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csvImportControllerListRuns).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(csvImportControllerInspect).mockResolvedValue({
      columnValues: [],
      columns: ['sourceKey', 'title', 'team', 'status', 'project'],
      errors: [],
      executionId: 'b01c8ea8-31c2-4fc1-827b-099aba0b110e',
      rowCount: 1,
      sourceFingerprint: 'a'.repeat(64),
      unsupportedColumns: [],
    });
    vi.mocked(csvImportControllerMappingOptions).mockResolvedValue({
      labels: [],
      members: [],
      priorities: ['NONE'],
      projects: [],
      states: [],
      targetFingerprint: 'b'.repeat(64),
      teams: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the six-step flow, privacy policy, limits, and unsupported data before upload', () => {
    renderScreen();

    expect(
      screen.getByRole('heading', { level: 1, name: messages.Settings.import.title }),
    ).toBeVisible();
    expect(screen.getByText(messages.Settings.import.file.limits)).toBeVisible();
    expect(screen.getByText(messages.Settings.import.privacy.description)).toBeVisible();
    expect(screen.getByText(messages.Settings.import.unsupported)).toBeVisible();
    expect(screen.getByText(messages.Settings.import.steps.result)).toBeVisible();
  });

  it('uploads a CSV through the generated client and advances to column mapping', async () => {
    const user = userEvent.setup();
    renderScreen();
    const file = new File(
      ['sourceKey,title,team,status,project\nA-1,첫 이슈,웹,할 일,알파\n'],
      'issues.csv',
      { type: 'text/csv' },
    );

    await user.upload(screen.getByLabelText(messages.Settings.import.file.label), file);
    await user.click(screen.getByRole('button', { name: messages.Settings.import.file.inspect }));

    await waitFor(() => expect(csvImportControllerInspect).toHaveBeenCalledTimes(1));
    expect(csvImportControllerInspect).toHaveBeenCalledWith(
      expect.objectContaining({ file, executionId: expect.any(String) }),
    );
    expect(csvImportControllerMappingOptions).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(messages.Settings.import.columns.title)).toBeVisible();
    expect(screen.getByText(messages.Settings.import.columns.fields.sourceKey)).toBeVisible();
  });

  it('reports every unmapped column and keeps named unsupported columns out of field mappings', async () => {
    vi.mocked(csvImportControllerInspect).mockResolvedValue({
      columnValues: [],
      columns: ['sourceKey', 'title', 'team', 'status', 'project', 'reporter', 'comments'],
      errors: [],
      executionId: 'b01c8ea8-31c2-4fc1-827b-099aba0b110e',
      rowCount: 1,
      sourceFingerprint: 'a'.repeat(64),
      unsupportedColumns: ['comments'],
    });
    const user = userEvent.setup();
    renderScreen();
    const file = new File(
      [
        'sourceKey,title,team,status,project,reporter,comments\nA-1,첫 이슈,웹,할 일,알파,Kim,메모\n',
      ],
      'issues.csv',
      { type: 'text/csv' },
    );

    await user.upload(screen.getByLabelText(messages.Settings.import.file.label), file);
    await user.click(screen.getByRole('button', { name: messages.Settings.import.file.inspect }));

    const alert = await screen.findByText(messages.Settings.import.columns.unsupportedTitle);
    expect(alert.closest('[role="alert"]')).toHaveTextContent('reporter, comments');
    expect(screen.queryByRole('option', { name: 'comments' })).not.toBeInTheDocument();
  });
});
