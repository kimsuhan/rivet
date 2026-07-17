import { Injectable } from '@nestjs/common';

import type {
  FileResourceResponseDto,
  IssueAttachmentListResponseDto,
} from './dto/file-response.dto';
import { fileResourceNotFound } from './file.errors';
import { FileRepository } from './file.repository';
import { canAccessFile } from './file-access.policy';
import { isInlineDisplayable } from './file-content.policy';
import { toFileResource, toIssueAttachment } from './file-response.mapper';
import { FileStorageService } from './file-storage.service';

@Injectable()
export class FileQueryService {
  constructor(
    private readonly files: FileRepository,
    private readonly storage: FileStorageService,
  ) {}

  async get(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ): Promise<FileResourceResponseDto> {
    const file = await this.findAccessibleFile(context, fileId);
    await this.storage.assertAvailable(file.storageKey);
    return toFileResource(file, file.avatarUser !== null || file.issueAttachments.length > 0);
  }

  async getBinary(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ): Promise<{
    detectedMimeType: string;
    inlineDisplayable: boolean;
    originalName: string;
    path: string;
    sizeBytes: number;
  }> {
    const file = await this.findAccessibleFile(context, fileId);
    const path = await this.storage.assertAvailable(file.storageKey);
    return {
      detectedMimeType: file.detectedMimeType,
      inlineDisplayable: isInlineDisplayable(file.detectedMimeType),
      originalName: file.originalName,
      path,
      sizeBytes: Number(file.sizeBytes),
    };
  }

  async listIssueAttachments(
    workspaceId: string,
    issueId: string,
  ): Promise<IssueAttachmentListResponseDto> {
    const attachments = await this.files.findIssueAttachments(workspaceId, issueId);
    return { items: attachments.map(toIssueAttachment), nextCursor: null };
  }

  private async findAccessibleFile(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ) {
    const file = await this.files.findAccessRow(fileId);
    return canAccessFile(file, context) ? file : fileResourceNotFound();
  }
}
