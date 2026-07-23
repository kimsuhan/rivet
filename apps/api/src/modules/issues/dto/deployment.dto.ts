import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { DeploymentStatus } from '@rivet/database';

import { TeamWorkSummaryResponseDto } from './issue-response.dto';

const DEPLOYMENT_ACTIONS = ['REQUIRE', 'SKIP', 'MARK_DEPLOYED', 'MARK_REDEPLOY_REQUIRED'] as const;
const DEPLOYMENT_LIST_SCOPES = ['ALL', 'MY_TEAMS'] as const;

export class DeploymentListQueryDto {
  @ApiPropertyOptional({ enum: DeploymentStatus, isArray: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((item) => item.trim()) : value,
  )
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(Object.values(DeploymentStatus), { each: true })
  status?: DeploymentStatus[];

  @ApiPropertyOptional({ default: 100, maximum: 200, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ default: 'ALL', enum: DEPLOYMENT_LIST_SCOPES })
  @IsOptional()
  @IsIn(DEPLOYMENT_LIST_SCOPES)
  scope?: (typeof DEPLOYMENT_LIST_SCOPES)[number];

  @ApiPropertyOptional({ default: false, type: Boolean })
  @Transform(({ value }) => {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  readyOnly = false;
}

export class DeploymentListResponseDto {
  @ApiProperty({ isArray: true, type: TeamWorkSummaryResponseDto })
  items!: TeamWorkSummaryResponseDto[];

  @ApiProperty({ minimum: 0 })
  totalCount!: number;
}

export class UpdateTeamWorkDeploymentDto {
  @ApiProperty({ enum: DEPLOYMENT_ACTIONS })
  @IsIn(DEPLOYMENT_ACTIONS)
  action!: (typeof DEPLOYMENT_ACTIONS)[number];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ProjectDeploymentTeamWorkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CompleteProjectDeploymentsDto {
  @ApiProperty({ isArray: true, maxItems: 200, minItems: 1, type: ProjectDeploymentTeamWorkDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((item: ProjectDeploymentTeamWorkDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => ProjectDeploymentTeamWorkDto)
  teamWorks!: ProjectDeploymentTeamWorkDto[];
}

export class DeploymentDependencyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  dependentTeamWorkId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  predecessorTeamWorkId!: string;
}

export class DeploymentTogetherGroupDto {
  @ApiProperty({ format: 'uuid', isArray: true, minItems: 2, type: String })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  teamWorkIds!: string[];
}

export class UpdateIssueDeploymentPlanDto {
  @ApiProperty({ isArray: true, type: DeploymentDependencyDto })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DeploymentDependencyDto)
  dependencies!: DeploymentDependencyDto[];

  @ApiProperty({ isArray: true, type: DeploymentTogetherGroupDto })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DeploymentTogetherGroupDto)
  togetherGroups!: DeploymentTogetherGroupDto[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
