import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/messages/ko.json';

import { FeedbackDialog } from './feedback-dialog';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), reset: vi.fn() }));

vi.mock('@rivet/api-client', () => ({
  useFeedbackControllerSubmit: () => ({
    isError: false,
    isPending: false,
    mutateAsync: mocks.mutateAsync,
    reset: mocks.reset,
  }),
}));

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ Feedback: messages.Feedback }}>
      <FeedbackDialog open onOpenChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe('FeedbackDialog', () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.reset.mockReset();
    window.history.replaceState(
      {},
      '',
      '/ko/issues?query=user%40example.com&token=secret&fileName=private.csv',
    );
  });

  afterEach(cleanup);

  it('keeps body and the same submission ID when a submission fails', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('provider unavailable'));
    const user = userEvent.setup();
    renderDialog();
    const body = '검색 화면에서 원하는 작업을 찾기 어려웠습니다.';

    await user.type(screen.getByLabelText('내용'), body);
    await user.click(screen.getByRole('button', { name: '피드백 보내기' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    const firstSubmissionId = mocks.mutateAsync.mock.calls[0]?.[0].data.submissionId;
    expect(screen.getByLabelText('내용')).toHaveValue(body);

    await user.click(screen.getByRole('button', { name: '피드백 보내기' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.mutateAsync.mock.calls[1]?.[0].data.submissionId).toBe(firstSubmissionId);
  });

  it('shows a receipt confirmation after a successful submission', async () => {
    mocks.mutateAsync.mockResolvedValue({ status: 'RECEIVED' });
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('내용'), 'CSV 가져오기 결과가 이해하기 어려웠습니다.');
    await user.click(screen.getByRole('button', { name: '피드백 보내기' }));

    expect(await screen.findByText('피드백을 접수했습니다')).toBeInTheDocument();
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({ currentPath: '/ko/issues' }),
    });
  });
});
