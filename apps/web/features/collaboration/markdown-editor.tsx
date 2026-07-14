'use client';

import { CodeNode } from '@lexical/code';
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  LINK,
  type TextMatchTransformer,
  type Transformer,
  TRANSFORMERS,
} from '@lexical/markdown';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type NodeKey,
  PASTE_COMMAND,
} from 'lexical';
import {
  BoldIcon,
  BracesIcon,
  Heading2Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MessageSquareQuoteIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  type DeleteUploadedFile,
  deleteUploadedFile,
  type UploadFile,
  uploadFile,
} from '@/features/files/file-api';
import { ImageOptimizationError, optimizeWorkspaceImage } from '@/features/files/image-optimizer';
import { cn } from '@/lib/utils';

import {
  $createMarkdownImageNode,
  $createMentionNode,
  $isMarkdownImageNode,
  $isMentionNode,
  type MarkdownImageLabels,
  MarkdownImageLabelsContext,
  MarkdownImageNode,
  MentionNode,
  REMOVE_MARKDOWN_IMAGE_COMMAND,
  RETRY_MARKDOWN_IMAGE_COMMAND,
} from './markdown-editor-nodes';
import { MarkdownRenderer } from './markdown-renderer';

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const DISABLED_MENTION = new RegExp(`@\\[((?:\\\\.|[^\\]])+)\\]\\(rivet-member:${UUID_V4}\\)`, 'i');

export type MentionOption = {
  displayName: string;
  membershipId: string;
};

export type MarkdownEditorLabels = {
  bold: string;
  bulletList: string;
  characterCount: string;
  edit: string;
  editorLabel: string;
  heading: string;
  image: MarkdownImageLabels & {
    choose: string;
    gifTooLarge: string;
    outputTooLarge: string;
    typeError: string;
  };
  imageUnavailable: string;
  inlineCode: string;
  italic: string;
  link: string;
  linkInvalid: string;
  linkPrompt: string;
  mention: string;
  mentionDisabled: string;
  mentionPlaceholder: string;
  numberedList: string;
  placeholder: string;
  preview: string;
  quote: string;
  tooLong: string;
  toolbar: string;
};

export function serializeMention(displayName: string, membershipId: string): string {
  const escapedName = displayName.replace(/([\\\]])/g, '\\$1');
  return `@[${escapedName}](rivet-member:${membershipId})`;
}

export function markdownCharacterCount(markdown: string): number {
  return Array.from(markdown).length;
}

export function hasSerializedMention(markdown: string): boolean {
  return DISABLED_MENTION.test(markdown);
}

export function normalizeSafeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const MENTION_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MentionNode],
  export: (node) =>
    $isMentionNode(node) ? serializeMention(node.getDisplayName(), node.getMembershipId()) : null,
  importRegExp: new RegExp(`@\\[((?:\\\\.|[^\\]])+)\\]\\(rivet-member:(${UUID_V4})\\)`, 'i'),
  regExp: new RegExp(`@\\[((?:\\\\.|[^\\]])+)\\]\\(rivet-member:(${UUID_V4})\\)$`, 'i'),
  replace: (textNode, match) => {
    const displayName = match[1]?.replace(/\\([\\\]])/g, '$1');
    const membershipId = match[2];
    if (!displayName || !membershipId) return;
    const mention = $createMentionNode(displayName, membershipId);
    textNode.replace(mention);
    return mention;
  },
  trigger: ')',
  type: 'text-match',
};

const IMAGE_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MarkdownImageNode],
  export: (node) => {
    if (!$isMarkdownImageNode(node)) return null;
    const snapshot = node.getSnapshot();
    if (snapshot.status !== 'ready' || !snapshot.fileId) return '';
    const escapedAlt = snapshot.alt.replace(/([\\\]])/g, '\\$1');
    return `![${escapedAlt}](/files/${snapshot.fileId})`;
  },
  importRegExp: new RegExp(`!\\[((?:\\\\.|[^\\]])*)\\]\\(/files/(${UUID_V4})\\)`, 'i'),
  regExp: new RegExp(`!\\[((?:\\\\.|[^\\]])*)\\]\\(/files/(${UUID_V4})\\)$`, 'i'),
  replace: (textNode, match) => {
    const fileId = match[2];
    if (!fileId) return;
    const alt = (match[1] ?? '').replace(/\\([\\\]])/g, '$1');
    textNode.replace(
      $createMarkdownImageNode({
        alt,
        fileId,
        fileName: alt || fileId,
        status: 'ready',
      }),
    );
  },
  trigger: ')',
  type: 'text-match',
};

const SAFE_LINK_TRANSFORMER: TextMatchTransformer = {
  ...LINK,
  export: (node, exportChildren, exportFormat) => {
    if ($isLinkNode(node) && !normalizeSafeHttpUrl(node.getURL())) return exportChildren(node);
    return LINK.export?.(node, exportChildren, exportFormat) ?? null;
  },
  replace: (textNode, match) => {
    const safeUrl = match[2] ? normalizeSafeHttpUrl(match[2]) : null;
    if (!safeUrl || !LINK.replace) return;
    const safeMatch = match.slice() as unknown as RegExpMatchArray;
    safeMatch[2] = safeUrl;
    return LINK.replace(textNode, safeMatch);
  },
};

const SAFE_TRANSFORMERS = TRANSFORMERS.map((transformer) =>
  transformer === LINK ? SAFE_LINK_TRANSFORMER : transformer,
);

function markdownTransformers(mentionsEnabled: boolean): Transformer[] {
  return mentionsEnabled ? MARKDOWN_TRANSFORMERS : MARKDOWN_TRANSFORMERS_WITHOUT_MENTIONS;
}

const MARKDOWN_TRANSFORMERS: Transformer[] = [
  IMAGE_TRANSFORMER,
  MENTION_TRANSFORMER,
  ...SAFE_TRANSFORMERS,
];
const MARKDOWN_TRANSFORMERS_WITHOUT_MENTIONS: Transformer[] = [
  IMAGE_TRANSFORMER,
  ...SAFE_TRANSFORMERS,
];

function EditorStatePlugin({
  mentionsEnabled,
  onChange,
  value,
}: {
  mentionsEnabled: boolean;
  onChange: (markdown: string) => void;
  value: string;
}) {
  const [editor] = useLexicalComposerContext();
  const lastValue = useRef(value);
  const transformers = markdownTransformers(mentionsEnabled);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    editor.update(() => $convertFromMarkdownString(value, transformers, undefined, true));
  }, [editor, transformers, value]);

  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        editorState.read(() => {
          const markdown = $convertToMarkdownString(transformers, undefined, true);
          if (markdown === lastValue.current) return;
          lastValue.current = markdown;
          onChange(markdown);
        });
      }}
    />
  );
}

function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.setEditable(editable), [editable, editor]);
  return null;
}

function updateImageNode(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  state: Parameters<MarkdownImageNode['setUploadState']>[0],
) {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if ($isMarkdownImageNode(node)) node.setUploadState(state);
  });
}

function ImageUploadPlugin({
  labels,
  onPendingChange,
  onUploadError,
  removeFile,
  sendFile,
}: {
  labels: MarkdownEditorLabels['image'];
  onPendingChange: (count: number) => void;
  onUploadError: (error: string | null) => void;
  removeFile: DeleteUploadedFile;
  sendFile: UploadFile;
}) {
  const [editor] = useLexicalComposerContext();
  const tasks = useRef(
    new Map<NodeKey, { file: File; fileId: string | null; previewUrl: string | null }>(),
  );
  const labelsRef = useRef(labels);
  const onPendingChangeRef = useRef(onPendingChange);
  const onUploadErrorRef = useRef(onUploadError);
  const removeFileRef = useRef(removeFile);
  const sendFileRef = useRef(sendFile);

  useEffect(() => {
    labelsRef.current = labels;
    onPendingChangeRef.current = onPendingChange;
    onUploadErrorRef.current = onUploadError;
    removeFileRef.current = removeFile;
    sendFileRef.current = sendFile;
  }, [labels, onPendingChange, onUploadError, removeFile, sendFile]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        onPendingChangeRef.current(
          $nodesOfType(MarkdownImageNode).filter((node) => node.getSnapshot().status !== 'ready')
            .length,
        );
      });
    });
  }, [editor]);

  useEffect(() => {
    const taskMap = tasks.current;

    async function processImage(nodeKey: NodeKey) {
      const task = taskMap.get(nodeKey);
      if (!task) return;

      updateImageNode(editor, nodeKey, {
        error: null,
        fileId: null,
        previewUrl: task.previewUrl,
        status: 'optimizing',
      });

      try {
        const optimized = await optimizeWorkspaceImage(task.file);
        updateImageNode(editor, nodeKey, {
          error: null,
          fileId: null,
          previewUrl: task.previewUrl,
          status: 'uploading',
        });
        const uploaded = await sendFileRef.current(optimized, 'WORKSPACE');
        const currentNode = editor.getEditorState().read(() => $getNodeByKey(nodeKey));
        if (!$isMarkdownImageNode(currentNode)) {
          void removeFileRef.current(uploaded.id).catch(() => undefined);
          return;
        }

        task.fileId = uploaded.id;
        if (task.previewUrl) URL.revokeObjectURL(task.previewUrl);
        task.previewUrl = null;
        updateImageNode(editor, nodeKey, {
          error: null,
          fileId: uploaded.id,
          previewUrl: null,
          status: 'ready',
        });
      } catch (error) {
        const message =
          error instanceof ImageOptimizationError && error.code === 'GIF_TOO_LARGE'
            ? labelsRef.current.gifTooLarge
            : error instanceof ImageOptimizationError && error.code === 'OUTPUT_TOO_LARGE'
              ? labelsRef.current.outputTooLarge
              : error instanceof ImageOptimizationError && error.code === 'INVALID_IMAGE'
                ? labelsRef.current.typeError
                : labelsRef.current.failed;
        updateImageNode(editor, nodeKey, {
          error: message,
          fileId: null,
          previewUrl: task.previewUrl,
          status: 'failed',
        });
      }
    }

    function insertImage(file: File): boolean {
      if (!['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        onUploadErrorRef.current(labelsRef.current.typeError);
        return false;
      }

      onUploadErrorRef.current(null);
      const previewUrl = URL.createObjectURL(file);
      const node = $createMarkdownImageNode({
        alt: file.name,
        fileName: file.name,
        previewUrl,
        status: 'optimizing',
      });
      $insertNodes([node]);
      taskMap.set(node.getKey(), { file, fileId: null, previewUrl });
      queueMicrotask(() => void processImage(node.getKey()));
      return true;
    }

    const unregisterInsert = editor.registerCommand(
      INSERT_MARKDOWN_IMAGE_COMMAND,
      insertImage,
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (!files.length) return false;
        event.preventDefault();
        for (const file of files) insertImage(file);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterRetry = editor.registerCommand(
      RETRY_MARKDOWN_IMAGE_COMMAND,
      (nodeKey) => {
        if (!taskMap.has(nodeKey)) return false;
        void processImage(nodeKey);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterRemove = editor.registerCommand(
      REMOVE_MARKDOWN_IMAGE_COMMAND,
      (nodeKey) => {
        const task = taskMap.get(nodeKey);
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isMarkdownImageNode(node)) node.remove();
        });
        if (task?.previewUrl) URL.revokeObjectURL(task.previewUrl);
        // Undo가 노드를 복원할 수 있으므로 업로드 바이너리는 즉시 지우지 않고 24시간 정리에 맡긴다.
        taskMap.delete(nodeKey);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterInsert();
      unregisterPaste();
      unregisterRetry();
      unregisterRemove();
      for (const task of taskMap.values()) {
        if (task.previewUrl) URL.revokeObjectURL(task.previewUrl);
      }
    };
  }, [editor]);

  return null;
}

const INSERT_MARKDOWN_IMAGE_COMMAND = createCommand<File>('INSERT_MARKDOWN_IMAGE');

function Toolbar({
  disabled,
  imagesEnabled,
  labels,
  mentionOptions,
  mentionsEnabled,
}: {
  disabled: boolean;
  imagesEnabled: boolean;
  labels: MarkdownEditorLabels;
  mentionOptions: MentionOption[];
  mentionsEnabled: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const [formats, setFormats] = useState({ bold: false, code: false, italic: false });
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          setFormats({
            bold: selection.hasFormat('bold'),
            code: selection.hasFormat('code'),
            italic: selection.hasFormat('italic'),
          });
        });
      }),
    [editor],
  );

  function setBlock(kind: 'heading' | 'quote') {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () =>
        kind === 'heading' ? $createHeadingNode('h2') : $createQuoteNode(),
      );
    });
  }

  function addLink() {
    const candidate = window.prompt(labels.linkPrompt);
    if (candidate === null) return;
    const url = normalizeSafeHttpUrl(candidate);
    if (!url) {
      setLinkError(labels.linkInvalid);
      return;
    }
    setLinkError(null);
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label={labels.toolbar}
        className="bg-surface-1 flex flex-wrap items-center gap-1 border-b p-2"
      >
        {[
          { format: 'bold' as const, icon: BoldIcon, label: labels.bold },
          { format: 'italic' as const, icon: ItalicIcon, label: labels.italic },
          { format: 'code' as const, icon: BracesIcon, label: labels.inlineCode },
        ].map(({ format, icon: Icon, label }) => (
          <Button
            key={format}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={formats[format]}
            title={label}
            disabled={disabled}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
          >
            <Icon data-icon="inline-start" />
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.heading}
          title={labels.heading}
          disabled={disabled}
          onClick={() => setBlock('heading')}
        >
          <Heading2Icon data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.bulletList}
          title={labels.bulletList}
          disabled={disabled}
          onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
        >
          <ListIcon data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.numberedList}
          title={labels.numberedList}
          disabled={disabled}
          onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
        >
          <ListOrderedIcon data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.quote}
          title={labels.quote}
          disabled={disabled}
          onClick={() => setBlock('quote')}
        >
          <MessageSquareQuoteIcon data-icon="inline-start" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.link}
          title={labels.link}
          disabled={disabled}
          onClick={addLink}
        >
          <LinkIcon data-icon="inline-start" />
        </Button>

        {mentionsEnabled && mentionOptions.length ? (
          <Select
            items={mentionOptions.map((option) => ({
              label: option.displayName,
              value: option.membershipId,
            }))}
            value=""
            disabled={disabled}
            onValueChange={(membershipId) => {
              const option = mentionOptions.find((item) => item.membershipId === membershipId);
              if (!option) return;
              editor.update(() => {
                const selection = $getSelection();
                if (!$isRangeSelection(selection)) return;
                selection.insertNodes([
                  $createMentionNode(option.displayName, option.membershipId),
                  $createTextNode(' '),
                ]);
              });
            }}
          >
            <SelectTrigger aria-label={labels.mention} size="sm" className="max-w-44">
              <SelectValue placeholder={labels.mentionPlaceholder} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {mentionOptions.map((option) => (
                  <SelectItem key={option.membershipId} value={option.membershipId}>
                    {option.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}

        {imagesEnabled ? (
          <label className="ml-auto">
            <input
              type="file"
              accept="image/gif,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) editor.dispatchCommand(INSERT_MARKDOWN_IMAGE_COMMAND, file);
                event.currentTarget.value = '';
              }}
            />
            <span className="hover:bg-muted focus-within:ring-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md focus-within:ring-2">
              <ImageIcon aria-hidden="true" className="size-4" />
              <span className="sr-only">{labels.image.choose}</span>
            </span>
          </label>
        ) : null}
      </div>
      {linkError ? (
        <p className="text-destructive border-b px-3 py-2 text-xs" role="alert">
          {linkError}
        </p>
      ) : null}
    </>
  );
}

export type MarkdownEditorProps = {
  charLimit: number;
  className?: string;
  disabled?: boolean;
  error?: string | null;
  imagesEnabled?: boolean;
  labels: MarkdownEditorLabels;
  mentionOptions?: MentionOption[];
  mentionsEnabled?: boolean;
  onCanSubmitChange?: (canSubmit: boolean) => void;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  removeFile?: DeleteUploadedFile;
  sendFile?: UploadFile;
  status?: string | null;
  value: string;
};

export function MarkdownEditor({
  charLimit,
  className,
  disabled = false,
  error = null,
  imagesEnabled = true,
  labels,
  mentionOptions = [],
  mentionsEnabled = true,
  onCanSubmitChange,
  onChange,
  readOnly = false,
  removeFile = deleteUploadedFile,
  sendFile = uploadFile,
  status = null,
  value,
}: MarkdownEditorProps) {
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [pendingImages, setPendingImages] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const characterCount = markdownCharacterCount(value);
  const mentionsInvalid = !mentionsEnabled && hasSerializedMention(value);
  const tooLong = characterCount > charLimit;
  const canSubmit = !disabled && !pendingImages && !tooLong && !mentionsInvalid;
  const transformers = markdownTransformers(mentionsEnabled);

  useEffect(() => onCanSubmitChange?.(canSubmit), [canSubmit, onCanSubmitChange]);

  if (readOnly) {
    return (
      <MarkdownRenderer
        {...(className ? { className } : {})}
        imageUnavailableLabel={labels.imageUnavailable}
        markdown={value}
      />
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <Tabs
        value={activeTab}
        onValueChange={(nextTab) => setActiveTab(nextTab === 'preview' ? 'preview' : 'edit')}
      >
        <TabsList variant="line" aria-label={labels.editorLabel}>
          <TabsTrigger value="edit">{labels.edit}</TabsTrigger>
          <TabsTrigger value="preview">{labels.preview}</TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <MarkdownImageLabelsContext.Provider value={labels.image}>
            <LexicalComposer
              initialConfig={{
                editable: !disabled,
                editorState: () => $convertFromMarkdownString(value, transformers, undefined, true),
                namespace: 'RivetMarkdownEditor',
                nodes: [
                  CodeNode,
                  HeadingNode,
                  LinkNode,
                  ListItemNode,
                  ListNode,
                  MarkdownImageNode,
                  MentionNode,
                  QuoteNode,
                ],
                onError: (lexicalError) => {
                  throw lexicalError;
                },
                theme: {
                  code: 'bg-surface-1 my-3 block overflow-x-auto rounded-lg border p-3 font-mono text-xs',
                  heading: {
                    h2: 'mt-5 mb-2 text-lg font-semibold',
                  },
                  link: 'text-primary underline underline-offset-4',
                  list: {
                    listitem: 'my-1',
                    nested: { listitem: 'ml-5' },
                    ol: 'my-3 list-decimal pl-5',
                    ul: 'my-3 list-disc pl-5',
                  },
                  paragraph: 'my-2',
                  quote: 'border-primary/40 text-muted-foreground my-3 border-l-2 pl-4',
                  text: {
                    bold: 'font-semibold',
                    code: 'bg-surface-2 rounded px-1 py-0.5 font-mono text-xs',
                    italic: 'italic',
                    strikethrough: 'line-through',
                  },
                },
              }}
            >
              <div className="bg-background overflow-hidden rounded-lg border">
                <Toolbar
                  disabled={disabled}
                  imagesEnabled={imagesEnabled}
                  labels={labels}
                  mentionOptions={mentionOptions}
                  mentionsEnabled={mentionsEnabled}
                />
                <div className="relative">
                  <RichTextPlugin
                    contentEditable={
                      <ContentEditable
                        aria-label={labels.editorLabel}
                        className="focus-visible:ring-ring min-h-44 resize-y overflow-auto px-3 py-3 text-[15px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      />
                    }
                    placeholder={
                      <p className="text-muted-foreground pointer-events-none absolute top-3 left-3 text-[15px]">
                        {labels.placeholder}
                      </p>
                    }
                    ErrorBoundary={LexicalErrorBoundary}
                  />
                </div>
              </div>
              <HistoryPlugin />
              <LinkPlugin validateUrl={(url) => normalizeSafeHttpUrl(url) !== null} />
              <ListPlugin />
              <MarkdownShortcutPlugin transformers={transformers} />
              <EditablePlugin editable={!disabled} />
              <EditorStatePlugin
                mentionsEnabled={mentionsEnabled}
                value={value}
                onChange={onChange}
              />
              {imagesEnabled ? (
                <ImageUploadPlugin
                  labels={labels.image}
                  onPendingChange={setPendingImages}
                  onUploadError={setUploadError}
                  removeFile={removeFile}
                  sendFile={sendFile}
                />
              ) : null}
            </LexicalComposer>
          </MarkdownImageLabelsContext.Provider>
        </TabsContent>
        <TabsContent value="preview">
          <div className="bg-background min-h-44 rounded-lg border p-3">
            <MarkdownRenderer imageUnavailableLabel={labels.imageUnavailable} markdown={value} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <span aria-live="polite">{status}</span>
        <span className={tooLong ? 'text-destructive' : undefined}>
          {labels.characterCount
            .replace('{current}', String(characterCount))
            .replace('{max}', String(charLimit))}
        </span>
      </div>
      {tooLong ? (
        <p className="text-destructive text-sm" role="alert">
          {labels.tooLong}
        </p>
      ) : null}
      {mentionsInvalid ? (
        <p className="text-destructive text-sm" role="alert">
          {labels.mentionDisabled}
        </p>
      ) : null}
      {uploadError ? (
        <p className="text-destructive text-sm" role="alert">
          {uploadError}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function IssueDescriptionEditor(props: MarkdownEditorProps) {
  return <MarkdownEditor {...props} imagesEnabled mentionsEnabled />;
}

export function WorkNoteEditor(props: Omit<MarkdownEditorProps, 'imagesEnabled' | 'mentionsEnabled'>) {
  return <MarkdownEditor {...props} imagesEnabled={false} mentionsEnabled={false} />;
}

export function HandoffEditor(props: Omit<MarkdownEditorProps, 'mentionsEnabled'>) {
  return <MarkdownEditor {...props} mentionsEnabled={false} />;
}

export function CommentEditor(props: MarkdownEditorProps) {
  return <MarkdownEditor {...props} />;
}
