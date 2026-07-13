import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CirclePause,
  CircleX,
  type LucideIcon,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from 'lucide-react';

import type { WorkflowStateResponseDto } from '@rivet/api-client';

import type { FeatureIssuePriority, FeatureIssueStatus } from './feature-issue-list-state';

type IssueAttributePresentation = {
  icon: LucideIcon;
  iconClassName: string;
};

export const FEATURE_STATUS_PRESENTATION: Record<FeatureIssueStatus, IssueAttributePresentation> = {
  UNSORTED: { icon: CircleDashed, iconClassName: 'text-muted-foreground' },
  TODO: { icon: Circle, iconClassName: 'text-foreground' },
  IN_PROGRESS: { icon: CircleDotDashed, iconClassName: 'text-info' },
  REVIEW: { icon: CircleDot, iconClassName: 'text-info' },
  DONE: { icon: CircleCheck, iconClassName: 'text-success' },
  PAUSED: { icon: CirclePause, iconClassName: 'text-warning' },
  CANCELED: { icon: CircleX, iconClassName: 'text-muted-foreground' },
};

export const ISSUE_PRIORITY_PRESENTATION: Record<FeatureIssuePriority, IssueAttributePresentation> =
  {
    NONE: { icon: Minus, iconClassName: 'text-muted-foreground' },
    LOW: { icon: SignalLow, iconClassName: 'text-muted-foreground' },
    MEDIUM: { icon: SignalMedium, iconClassName: 'text-muted-foreground' },
    HIGH: { icon: SignalHigh, iconClassName: 'text-warning' },
    URGENT: { icon: CircleAlert, iconClassName: 'text-destructive' },
  };

export const WORKFLOW_STATE_PRESENTATION: Record<
  WorkflowStateResponseDto['category'],
  IssueAttributePresentation
> = {
  BACKLOG: { icon: CircleDashed, iconClassName: 'text-muted-foreground' },
  UNSTARTED: { icon: Circle, iconClassName: 'text-foreground' },
  STARTED: { icon: CircleDotDashed, iconClassName: 'text-info' },
  COMPLETED: { icon: CircleCheck, iconClassName: 'text-success' },
  CANCELED: { icon: CircleX, iconClassName: 'text-muted-foreground' },
};
