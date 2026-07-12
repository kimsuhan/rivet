import {
  type FileResourceResponseDto,
  filesControllerDelete,
  filesControllerUpload,
  getFilesControllerContentUrl,
} from '@rivet/api-client';

export type FileScope = 'USER_PROFILE' | 'WORKSPACE';

export type UploadFile = (file: File, scope: FileScope) => Promise<FileResourceResponseDto>;
export type DeleteUploadedFile = (fileId: string) => Promise<void>;

export const uploadFile: UploadFile = (file, scope) =>
  filesControllerUpload({
    file,
    scope,
  });

export const deleteUploadedFile: DeleteUploadedFile = (fileId) => filesControllerDelete(fileId);

export function fileContentUrl(fileId: string): string {
  return getFilesControllerContentUrl(fileId);
}
