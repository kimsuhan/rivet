import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListViewConfigurationControls } from './list-view-configuration-controls';

const fieldOptions = [
  { label: '생성일', value: 'createdAt' },
  { label: '최근 수정일', value: 'updatedAt' },
];
const groupOptions = [
  { label: '프로젝트', value: 'projectId' },
  { label: '상태', value: 'status' },
];

describe('ListViewConfigurationControls', () => {
  afterEach(cleanup);

  it('표시 필드를 각각 켜고 끈다', async () => {
    const user = userEvent.setup();
    const onVisibleFieldsChange = vi.fn();
    render(
      <ListViewConfigurationControls
        density="comfortable"
        fieldOptions={fieldOptions}
        groupBy=""
        groupOptions={groupOptions}
        onDensityChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onSubGroupByChange={vi.fn()}
        onVisibleFieldsChange={onVisibleFieldsChange}
        subGroupBy=""
        visibleFields={['updatedAt']}
      />,
    );

    const trigger = screen.getByRole('button', { name: '보기 설정: 여유 보기' });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));
    await user.click(screen.getByRole('checkbox', { name: '생성일' }));
    await user.click(screen.getByRole('checkbox', { name: '최근 수정일' }));

    expect(onVisibleFieldsChange).toHaveBeenNthCalledWith(1, ['updatedAt', 'createdAt']);
    expect(onVisibleFieldsChange).toHaveBeenNthCalledWith(2, []);
  });

  it('메인 그룹을 해제하면 서브 그룹도 함께 해제한다', async () => {
    const user = userEvent.setup();
    const onGroupByChange = vi.fn();
    const onSubGroupByChange = vi.fn();
    render(
      <ListViewConfigurationControls
        density="comfortable"
        fieldOptions={fieldOptions}
        groupBy="projectId"
        groupOptions={groupOptions}
        onDensityChange={vi.fn()}
        onGroupByChange={onGroupByChange}
        onSubGroupByChange={onSubGroupByChange}
        onVisibleFieldsChange={vi.fn()}
        subGroupBy="status"
        visibleFields={['createdAt']}
      />,
    );

    await user.click(screen.getByRole('button', { name: '보기 설정: 여유 보기, 그룹화됨' }));
    const groupTrigger = screen.getByRole('combobox', { name: '메인 그룹' });
    await user.click(groupTrigger);
    await waitFor(() => expect(groupTrigger).toHaveAttribute('data-popup-open'));
    await user.click(screen.getByRole('option', { name: '그룹 없음' }));

    expect(onGroupByChange).toHaveBeenCalledWith('');
    expect(onSubGroupByChange).toHaveBeenCalledWith('');
  });
});
