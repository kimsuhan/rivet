'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $applyNodeReplacement,
  $getNodeByKey,
  createCommand,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from 'lexical';
import { ImageOffIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import Image from 'next/image';
import { createContext, type JSX, useContext, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { fileContentUrl } from '@/features/files/file-api';

export type MarkdownImageLabels = {
  altLabel: string;
  failed: string;
  optimizing: string;
  remove: string;
  retry: string;
  unavailable: string;
  uploading: string;
};

export const MarkdownImageLabelsContext = createContext<MarkdownImageLabels | null>(null);

export const RETRY_MARKDOWN_IMAGE_COMMAND = createCommand<NodeKey>('RETRY_MARKDOWN_IMAGE');
export const REMOVE_MARKDOWN_IMAGE_COMMAND = createCommand<NodeKey>('REMOVE_MARKDOWN_IMAGE');

type SerializedMentionNode = Spread<
  {
    displayName: string;
    membershipId: string;
  },
  SerializedTextNode
>;

export class MentionNode extends TextNode {
  __displayName: string;
  __membershipId: string;

  static override getType(): string {
    return 'mention';
  }

  static override clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__displayName, node.__membershipId, node.__key);
  }

  static override importJSON(serializedNode: SerializedMentionNode): MentionNode {
    const node = $createMentionNode(serializedNode.displayName, serializedNode.membershipId);
    return node.updateFromJSON(serializedNode);
  }

  constructor(displayName: string, membershipId: string, key?: NodeKey) {
    super(`@${displayName}`, key);
    this.__displayName = displayName;
    this.__membershipId = membershipId;
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.dataset.mentionMembershipId = this.__membershipId;
    element.className = 'bg-primary/10 text-primary rounded px-1 py-0.5 font-medium';
    return element;
  }

  override updateDOM(previousNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const didUpdate = super.updateDOM(previousNode, dom, config);
    if (previousNode.__membershipId !== this.__membershipId) {
      dom.dataset.mentionMembershipId = this.__membershipId;
    }
    return didUpdate;
  }

  override exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      displayName: this.__displayName,
      membershipId: this.__membershipId,
      type: 'mention',
      version: 1,
    };
  }

  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  getDisplayName(): string {
    return this.getLatest().__displayName;
  }

  getMembershipId(): string {
    return this.getLatest().__membershipId;
  }
}

export function $createMentionNode(displayName: string, membershipId: string): MentionNode {
  return $applyNodeReplacement(new MentionNode(displayName, membershipId)).setMode('token');
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}

export type MarkdownImageStatus = 'failed' | 'optimizing' | 'ready' | 'uploading';

type SerializedMarkdownImageNode = Spread<
  {
    alt: string;
    error: string | null;
    fileId: string | null;
    fileName: string;
    previewUrl: string | null;
    status: MarkdownImageStatus;
  },
  SerializedLexicalNode
>;

function MarkdownEditorImage({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const labels = useContext(MarkdownImageLabelsContext);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{
    height: number;
    source: string;
    width: number;
  } | null>(null);
  const snapshot = editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    return $isMarkdownImageNode(node) ? node.getSnapshot() : null;
  });

  if (!labels || !snapshot) return null;

  const imageSource =
    snapshot.status === 'ready' && snapshot.fileId
      ? fileContentUrl(snapshot.fileId)
      : snapshot.previewUrl;
  const statusLabel =
    snapshot.status === 'optimizing'
      ? labels.optimizing
      : snapshot.status === 'uploading'
        ? labels.uploading
        : snapshot.status === 'failed'
          ? snapshot.error || labels.failed
          : null;

  return (
    <figure className="bg-surface-1 my-3 flex max-w-[760px] flex-col gap-3 rounded-lg border p-3">
      {imageSource && failedSource !== imageSource ? (
        <Image
          src={imageSource}
          alt={snapshot.alt}
          width={naturalSize?.source === imageSource ? naturalSize.width : 760}
          height={naturalSize?.source === imageSource ? naturalSize.height : 240}
          unoptimized
          className="h-auto max-h-60 w-auto max-w-full self-center rounded-md object-contain"
          referrerPolicy="no-referrer"
          onLoad={(event) =>
            setNaturalSize({
              height: event.currentTarget.naturalHeight || 1,
              source: imageSource,
              width: event.currentTarget.naturalWidth || 1,
            })
          }
          onError={() => setFailedSource(imageSource)}
        />
      ) : (
        <div className="text-muted-foreground flex min-h-24 items-center justify-center gap-2 text-sm">
          <ImageOffIcon aria-hidden="true" className="size-4" />
          {labels.unavailable}
        </div>
      )}

      {statusLabel ? (
        <Progress
          value={snapshot.status === 'failed' ? 0 : null}
          className="gap-1.5"
          aria-label={statusLabel}
        >
          <ProgressLabel
            className={
              snapshot.status === 'failed'
                ? 'text-destructive text-xs font-normal'
                : 'text-muted-foreground text-xs font-normal'
            }
          >
            {statusLabel}
          </ProgressLabel>
        </Progress>
      ) : null}

      <div className="flex min-w-0 items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium">
          <span className="mb-1 block">{labels.altLabel}</span>
          <Input
            value={snapshot.alt}
            disabled={snapshot.status !== 'ready'}
            onChange={(event) => {
              const alt = event.currentTarget.value;
              editor.update(() => {
                const node = $getNodeByKey(nodeKey);
                if ($isMarkdownImageNode(node)) node.setAlt(alt);
              });
            }}
          />
        </label>
        {snapshot.status === 'failed' ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`${snapshot.fileName} ${labels.retry}`}
            title={labels.retry}
            onClick={() => editor.dispatchCommand(RETRY_MARKDOWN_IMAGE_COMMAND, nodeKey)}
          >
            <RotateCwIcon data-icon="inline-start" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${snapshot.fileName} ${labels.remove}`}
          title={labels.remove}
          onClick={() => editor.dispatchCommand(REMOVE_MARKDOWN_IMAGE_COMMAND, nodeKey)}
        >
          <Trash2Icon data-icon="inline-start" />
        </Button>
      </div>
    </figure>
  );
}

export class MarkdownImageNode extends DecoratorNode<JSX.Element> {
  __alt: string;
  __error: string | null;
  __fileId: string | null;
  __fileName: string;
  __previewUrl: string | null;
  __status: MarkdownImageStatus;

  static override getType(): string {
    return 'markdown-image';
  }

  static override clone(node: MarkdownImageNode): MarkdownImageNode {
    return new MarkdownImageNode(
      node.__alt,
      node.__fileName,
      node.__status,
      node.__fileId,
      node.__previewUrl,
      node.__error,
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedMarkdownImageNode): MarkdownImageNode {
    return $createMarkdownImageNode({
      alt: serializedNode.alt,
      error: serializedNode.error,
      fileId: serializedNode.fileId,
      fileName: serializedNode.fileName,
      previewUrl: serializedNode.previewUrl,
      status: serializedNode.status,
    });
  }

  constructor(
    alt: string,
    fileName: string,
    status: MarkdownImageStatus,
    fileId: string | null,
    previewUrl: string | null,
    error: string | null,
    key?: NodeKey,
  ) {
    super(key);
    this.__alt = alt;
    this.__error = error;
    this.__fileId = fileId;
    this.__fileName = fileName;
    this.__previewUrl = previewUrl;
    this.__status = status;
  }

  override createDOM(): HTMLElement {
    return document.createElement('div');
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): JSX.Element {
    return <MarkdownEditorImage nodeKey={this.getKey()} />;
  }

  override exportJSON(): SerializedMarkdownImageNode {
    const snapshot = this.getSnapshot();
    return {
      ...super.exportJSON(),
      ...snapshot,
      type: 'markdown-image',
      version: 1,
    };
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  getSnapshot(): Omit<SerializedMarkdownImageNode, 'type' | 'version'> {
    const node = this.getLatest();
    return {
      alt: node.__alt,
      error: node.__error,
      fileId: node.__fileId,
      fileName: node.__fileName,
      previewUrl: node.__previewUrl,
      status: node.__status,
    };
  }

  setAlt(alt: string): void {
    this.getWritable().__alt = alt;
  }

  setUploadState({
    error,
    fileId,
    previewUrl,
    status,
  }: {
    error: string | null;
    fileId: string | null;
    previewUrl: string | null;
    status: MarkdownImageStatus;
  }): void {
    const node = this.getWritable();
    node.__error = error;
    node.__fileId = fileId;
    node.__previewUrl = previewUrl;
    node.__status = status;
  }
}

export function $createMarkdownImageNode({
  alt,
  error = null,
  fileId = null,
  fileName,
  previewUrl = null,
  status,
}: {
  alt: string;
  error?: string | null;
  fileId?: string | null;
  fileName: string;
  previewUrl?: string | null;
  status: MarkdownImageStatus;
}): MarkdownImageNode {
  return $applyNodeReplacement(
    new MarkdownImageNode(alt, fileName, status, fileId, previewUrl, error),
  );
}

export function $isMarkdownImageNode(
  node: LexicalNode | null | undefined,
): node is MarkdownImageNode {
  return node instanceof MarkdownImageNode;
}
