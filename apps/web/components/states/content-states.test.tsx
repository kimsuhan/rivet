import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { ContentEmpty } from './content-empty';
import { ContentError } from './content-error';
import { ContentLoading } from './content-loading';

describe('공통 콘텐츠 상태', () => {
  it('빈 상태의 이유를 제목과 설명으로 전달한다', () => {
    render(
      <ContentEmpty
        icon={Inbox}
        title="새 알림이 없습니다"
        description="확인할 변경이 생기면 이곳에 표시됩니다."
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '새 알림이 없습니다' })).toBeVisible();
    expect(screen.getByText('확인할 변경이 생기면 이곳에 표시됩니다.')).toBeVisible();
  });

  it('전체 화면 빈 상태의 제목 수준을 지정한다', () => {
    render(
      <ContentEmpty
        icon={Inbox}
        title="페이지를 찾을 수 없습니다"
        description="주소를 다시 확인해 주세요."
        headingLevel={1}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '페이지를 찾을 수 없습니다' }),
    ).toBeVisible();
  });

  it('빈 상태 내용을 기본으로 가운데 정렬한다', () => {
    const { container } = render(
      <ContentEmpty
        icon={Inbox}
        title="읽지 않은 알림이 없습니다"
        description="확인한 알림은 모든 알림 탭에서 다시 볼 수 있습니다."
      />,
    );

    expect(container.querySelector('[data-slot="empty"]')).toHaveClass(
      'items-center',
      'text-center',
    );
  });

  it('조밀한 인라인 문맥에서는 시작선 정렬을 명시할 수 있다', () => {
    const { container } = render(
      <ContentEmpty
        align="start"
        icon={Inbox}
        title="표시할 항목이 없습니다"
        description="상위 화면에서 항목을 추가해 주세요."
      />,
    );

    expect(container.querySelector('[data-slot="empty"]')).toHaveClass('items-start', 'text-left');
  });

  it('로딩 상태를 보조 기술에 한 번만 알린다', () => {
    render(<ContentLoading label="내용을 불러오는 중입니다." />);

    expect(screen.getByRole('status')).toHaveTextContent('내용을 불러오는 중입니다.');
    expect(screen.getByLabelText('내용을 불러오는 중입니다.')).toHaveAttribute('aria-busy', 'true');
  });

  it('오류 상태에서 재시도 동작을 실행한다', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <ContentError
        title="화면을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        retryLabel="다시 시도"
        onRetry={onRetry}
        headingLevel={1}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '화면을 불러오지 못했습니다' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
