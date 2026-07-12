import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateWorkflowStateDto {
  @ApiProperty({ example: '검토 중', maxLength: 100, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '상태 이름이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '상태 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '상태 이름은 100자 이하여야 합니다.' })
  name!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '상태 버전이 올바르지 않습니다.' })
  @Min(1, { message: '상태 버전이 올바르지 않습니다.' })
  version!: number;
}

export class WorkflowStateOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: '상태 식별자가 올바르지 않습니다.' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '상태 버전이 올바르지 않습니다.' })
  @Min(1, { message: '상태 버전이 올바르지 않습니다.' })
  version!: number;
}

export class ReorderWorkflowStatesDto {
  @ApiProperty({ isArray: true, type: WorkflowStateOrderItemDto })
  @IsArray({ message: '상태 순서를 입력해 주세요.' })
  @ArrayMinSize(1, { message: '상태 순서를 한 건 이상 입력해 주세요.' })
  @ArrayUnique((state: WorkflowStateOrderItemDto) => state.id, {
    message: '같은 상태를 중복 입력할 수 없습니다.',
  })
  @ValidateNested({ each: true })
  @Type(() => WorkflowStateOrderItemDto)
  states!: WorkflowStateOrderItemDto[];
}

export class DeleteWorkflowStateQueryDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: '상태 버전이 올바르지 않습니다.' })
  @Min(1, { message: '상태 버전이 올바르지 않습니다.' })
  version!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsOptional()
  @IsUUID('all', { message: '대체 상태 식별자가 올바르지 않습니다.' })
  replacementStateId?: string;
}
