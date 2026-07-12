import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type OnboardingFrameLabels = {
  completedStepStatus: string;
  currentStepStatus: string;
  inviteStep: string;
  productName: string;
  stepsLabel: string;
  teamStep: string;
  workspaceStep: string;
};

export function OnboardingFrame({
  children,
  currentStep,
  labels,
}: {
  children: ReactNode;
  currentStep: 1 | 2 | 3;
  labels: OnboardingFrameLabels;
}) {
  const steps = [labels.workspaceStep, labels.teamStep, labels.inviteStep];

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-md flex-col gap-5">
        <p className="text-foreground text-center text-sm font-medium">{labels.productName}</p>
        <nav aria-label={labels.stepsLabel}>
          <ol className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {steps.map((step, index) => {
              const stepNumber = index + 1;
              const isCurrent = stepNumber === currentStep;
              const isCompleted = stepNumber < currentStep;

              return (
                <li
                  key={step}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2',
                    isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  <span className="flex items-baseline gap-1">
                    <span>{step}</span>
                    {isCurrent ? (
                      <span className="text-xs">({labels.currentStepStatus})</span>
                    ) : null}
                    {isCompleted ? (
                      <span className="text-xs">({labels.completedStepStatus})</span>
                    ) : null}
                  </span>
                  {index < steps.length - 1 ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
        {children}
      </div>
    </main>
  );
}
