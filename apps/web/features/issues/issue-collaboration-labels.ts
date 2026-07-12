import type { MarkdownEditorLabels } from '@/features/collaboration/markdown-editor';
import type { FileUploadQueueLabels } from '@/features/files/file-upload-queue';

type Translate = (key: string) => string;

export function markdownEditorLabels(t: Translate, raw: Translate): MarkdownEditorLabels {
  return {
    bold: t('bold'),
    bulletList: t('bulletList'),
    characterCount: raw('characterCount'),
    edit: t('edit'),
    editorLabel: t('editorLabel'),
    heading: t('heading'),
    image: {
      altLabel: t('image.altLabel'),
      choose: t('image.choose'),
      failed: t('image.failed'),
      gifTooLarge: t('image.gifTooLarge'),
      optimizing: t('image.optimizing'),
      outputTooLarge: t('image.outputTooLarge'),
      remove: t('image.remove'),
      retry: t('image.retry'),
      typeError: t('image.typeError'),
      unavailable: t('image.unavailable'),
      uploading: t('image.uploading'),
    },
    imageUnavailable: t('imageUnavailable'),
    inlineCode: t('inlineCode'),
    italic: t('italic'),
    link: t('link'),
    linkInvalid: t('linkInvalid'),
    linkPrompt: t('linkPrompt'),
    mention: t('mention'),
    mentionDisabled: t('mentionDisabled'),
    mentionPlaceholder: t('mentionPlaceholder'),
    numberedList: t('numberedList'),
    placeholder: t('placeholder'),
    preview: t('preview'),
    quote: t('quote'),
    tooLong: t('tooLong'),
    toolbar: t('toolbar'),
  };
}

export function fileUploadQueueLabels(t: Translate): FileUploadQueueLabels {
  return {
    chooseFiles: t('chooseFiles'),
    emptyFile: t('emptyFile'),
    failed: t('failed'),
    fileLimit: t('fileLimit'),
    optimizing: t('optimizing'),
    remove: t('remove'),
    retry: t('retry'),
    selectedFiles: t('selectedFiles'),
    succeeded: t('succeeded'),
    unknownType: t('unknownType'),
    uploading: t('uploading'),
  };
}
