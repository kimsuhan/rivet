import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ImportRunStatus,
  IssuePriority,
  MembershipRole,
  StateCategory,
} from '@rivet/database';

export class CsvImportColumnValuesDto {
  @ApiProperty() column!: string;
  @ApiProperty({ isArray: true, type: String }) values!: string[];
  @ApiProperty({ minimum: 0 }) totalDistinctCount!: number;
  @ApiProperty() truncated!: boolean;
}

export class CsvImportPreviewErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty({ minimum: 1 }) rowNumber!: number;
  @ApiPropertyOptional() field?: string;
  @ApiPropertyOptional() severity?: 'ERROR' | 'WARNING';
}

export class CsvImportInspectionResponseDto {
  @ApiProperty({ format: 'uuid' }) executionId!: string;
  @ApiProperty({ minLength: 64, maxLength: 64 }) sourceFingerprint!: string;
  @ApiProperty({ isArray: true, type: String }) columns!: string[];
  @ApiProperty({ isArray: true, type: CsvImportColumnValuesDto })
  columnValues!: CsvImportColumnValuesDto[];
  @ApiProperty({ isArray: true, type: String }) unsupportedColumns!: string[];
  @ApiProperty({ minimum: 1 }) rowCount!: number;
  @ApiProperty({ isArray: true, type: CsvImportPreviewErrorDto })
  errors!: CsvImportPreviewErrorDto[];
}

export class CsvImportTeamOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class CsvImportStateOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) teamId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: StateCategory }) category!: StateCategory;
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class CsvImportMemberOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: MembershipRole }) role!: MembershipRole;
  @ApiProperty({ format: 'uuid', isArray: true, type: String }) teamIds!: string[];
}

export class CsvImportProjectTeamOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) teamId!: string;
  @ApiProperty() active!: boolean;
}

export class CsvImportProjectOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ isArray: true, type: CsvImportProjectTeamOptionDto })
  projectTeams!: CsvImportProjectTeamOptionDto[];
}

export class CsvImportLabelOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ pattern: '^#[0-9A-F]{6}$' }) color!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class CsvImportMappingOptionsResponseDto {
  @ApiProperty({ minLength: 64, maxLength: 64 }) targetFingerprint!: string;
  @ApiProperty({ isArray: true, type: CsvImportTeamOptionDto }) teams!: CsvImportTeamOptionDto[];
  @ApiProperty({ isArray: true, type: CsvImportStateOptionDto }) states!: CsvImportStateOptionDto[];
  @ApiProperty({ isArray: true, type: CsvImportMemberOptionDto })
  members!: CsvImportMemberOptionDto[];
  @ApiProperty({ isArray: true, type: CsvImportProjectOptionDto })
  projects!: CsvImportProjectOptionDto[];
  @ApiProperty({ isArray: true, type: CsvImportLabelOptionDto }) labels!: CsvImportLabelOptionDto[];
  @ApiProperty({ enum: IssuePriority, isArray: true }) priorities!: IssuePriority[];
}

export class CsvImportValidationSummaryDto {
  @ApiProperty({ minimum: 0 }) projectCreateCount!: number;
  @ApiProperty({ minimum: 0 }) issueCreateCount!: number;
  @ApiProperty({ minimum: 0 }) connectionCreateCount!: number;
  @ApiProperty({ minimum: 0 }) excludedRowCount!: number;
  @ApiProperty({ minimum: 0 }) errorCount!: number;
  @ApiProperty({ minimum: 0 }) warningCount!: number;
}

export class CsvImportValidationResponseDto {
  @ApiProperty({ format: 'uuid' }) executionId!: string;
  @ApiProperty() canExecute!: boolean;
  @ApiProperty({ type: CsvImportValidationSummaryDto }) summary!: CsvImportValidationSummaryDto;
  @ApiProperty({ isArray: true, type: CsvImportPreviewErrorDto })
  errors!: CsvImportPreviewErrorDto[];
  @ApiProperty({ isArray: true, type: CsvImportPreviewErrorDto })
  warnings!: CsvImportPreviewErrorDto[];
  @ApiPropertyOptional({ maxLength: 64, minLength: 64 }) validationSignature?: string;
  @ApiPropertyOptional() duplicateCompletedRun?: boolean;
}

export class CsvImportCreatedResourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
}

export class CsvImportRunResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) executionId!: string;
  @ApiProperty({ enum: ImportRunStatus }) status!: ImportRunStatus;
  @ApiProperty({ minimum: 0 }) inputRowCount!: number;
  @ApiProperty({ minimum: 0 }) projectCreatedCount!: number;
  @ApiProperty({ minimum: 0 }) issueCreatedCount!: number;
  @ApiProperty({ minimum: 0 }) connectionCreatedCount!: number;
  @ApiProperty({ minimum: 0 }) excludedRowCount!: number;
  @ApiProperty({ minimum: 0 }) errorCount!: number;
  @ApiProperty({ nullable: true, type: String }) lastErrorCode!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) completedAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) failedAt!: string | null;
  @ApiProperty({ isArray: true, type: CsvImportPreviewErrorDto })
  errors!: CsvImportPreviewErrorDto[];
  @ApiProperty({ isArray: true, type: CsvImportCreatedResourceDto })
  createdProjects!: CsvImportCreatedResourceDto[];
  @ApiProperty({ isArray: true, type: CsvImportCreatedResourceDto })
  createdIssues!: CsvImportCreatedResourceDto[];
}

export class CsvImportRunListResponseDto {
  @ApiProperty({ isArray: true, type: CsvImportRunResponseDto }) items!: CsvImportRunResponseDto[];
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) nextCursor!: string | null;
}
