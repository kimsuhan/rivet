import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OnboardingFrame } from './onboarding-frame';

const labels = {
  completedStepStatus: '완료',
  currentStepStatus: '현재 단계',
  inviteStep: '동료 초대',
  productName: 'Rivet',
  stepsLabel: '초기 설정 단계',
  teamStep: '기본 팀',
  workspaceStep: '워크스페이스',
};

describe('OnboardingFrame', () => {
  it('현재 단계와 완료 단계를 텍스트와 접근성 상태로 함께 표시한다', () => {
    render(
      <OnboardingFrame currentStep={2} labels={labels}>
        <div>팀 설정</div>
      </OnboardingFrame>,
    );

    const workspaceStep = screen.getByText(labels.workspaceStep).closest('li');
    const teamStep = screen.getByText(labels.teamStep).closest('li');

    expect(screen.getByRole('navigation', { name: labels.stepsLabel })).toBeVisible();
    expect(workspaceStep).toHaveTextContent(labels.completedStepStatus);
    expect(workspaceStep).not.toHaveAttribute('aria-current');
    expect(teamStep).toHaveTextContent(labels.currentStepStatus);
    expect(teamStep).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(labels.inviteStep).closest('li')).not.toHaveAttribute('aria-current');
  });
});
