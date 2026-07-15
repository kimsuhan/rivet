import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { optimizeWorkspaceImage } from '@/features/files/image-optimizer';

import { MarkdownEditor, type MarkdownEditorLabels } from './markdown-editor';

vi.mock('@/features/files/image-optimizer', () => ({
  ImageOptimizationError: class ImageOptimizationError extends Error {},
  optimizeWorkspaceImage: vi.fn(async (file: File) => file),
}));

const labels: MarkdownEditorLabels = {
  bold: '굵게',
  bulletList: '글머리 목록',
  characterCount: '{current}/{max}자',
  edit: '편집',
  editorLabel: '본문 편집기',
  heading: '제목',
  image: {
    altLabel: '대체 텍스트',
    choose: '이미지 추가',
    failed: '업로드 실패',
    gifTooLarge: 'GIF 제한',
    optimizing: '최적화 중',
    outputTooLarge: '최적화 실패',
    remove: '이미지 제거',
    retry: '다시 시도',
    typeError: '이미지 형식 오류',
    unavailable: '이미지 없음',
    uploading: '업로드 중',
  },
  imageUnavailable: '이미지 없음',
  inlineCode: '인라인 코드',
  italic: '기울임',
  link: '링크',
  linkInvalid: '링크 오류',
  linkPrompt: '링크 입력',
  mention: '멘션',
  mentionDisabled: '멘션 사용 불가',
  mentionPlaceholder: '멤버 멘션',
  numberedList: '번호 목록',
  placeholder: '본문 입력',
  preview: '미리보기',
  quote: '인용',
  toolbar: '서식 도구',
  tooLong: '글자 수 초과',
};

function Harness({
  children,
}: {
  children: (value: string, onChange: (value: string) => void) => ReactNode;
}) {
  const [value, setValue] = useState('');
  return (
    <>
      {children(value, setValue)}
      <output data-testid="markdown-value">{value}</output>
    </>
  );
}

describe('MarkdownEditor image lifecycle', () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    const BrowserUrl = URL;
    class MockUrl extends BrowserUrl {
      static override createObjectURL = vi.fn(() => 'blob:preview');
      static override revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', MockUrl);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('label 객체가 바뀌어도 진행 중 preview를 정리하지 않고 성공 뒤 canSubmit을 복구한다', async () => {
    let finishUpload: ((value: ReturnType<typeof uploaded>) => void) | undefined;
    const sendFile = vi.fn(
      async () =>
        await new Promise<ReturnType<typeof uploaded>>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const onCanSubmitChange = vi.fn();
    const browser = userEvent.setup();
    const view = render(
      <Harness>
        {(value, onChange) => (
          <MarkdownEditor
            charLimit={50_000}
            labels={{ ...labels, image: { ...labels.image } }}
            value={value}
            onChange={onChange}
            onCanSubmitChange={onCanSubmitChange}
            sendFile={sendFile}
          />
        )}
      </Harness>,
    );

    const file = new File(['image'], 'screen.png', { type: 'image/png' });
    await browser.upload(screen.getByLabelText(labels.image.choose), file);
    await waitFor(() => expect(sendFile).toHaveBeenCalled());
    expect(onCanSubmitChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText(labels.image.altLabel)).toBeDisabled();

    view.rerender(
      <Harness>
        {(value, onChange) => (
          <MarkdownEditor
            charLimit={50_000}
            labels={{ ...labels, image: { ...labels.image } }}
            value={value}
            onChange={onChange}
            onCanSubmitChange={onCanSubmitChange}
            sendFile={sendFile}
          />
        )}
      </Harness>,
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => finishUpload?.(uploaded(file)));
    await waitFor(() => {
      expect(screen.getByTestId('markdown-value')).toHaveTextContent(
        '![screen.png](/files/4bfe36e1-2a0f-463c-874b-909b25d0cd8a)',
      );
      expect(onCanSubmitChange).toHaveBeenLastCalledWith(true);
      expect(screen.getByLabelText(labels.image.altLabel)).toBeEnabled();
    });
    expect(optimizeWorkspaceImage).toHaveBeenCalledWith(file);
  });

  it('성공한 새 이미지를 편집기에서 제거해도 undo 가능한 파일을 즉시 DELETE하지 않는다', async () => {
    const removeFile = vi.fn(async () => undefined);
    const browser = userEvent.setup();

    render(
      <Harness>
        {(value, onChange) => (
          <MarkdownEditor
            charLimit={50_000}
            labels={labels}
            value={value}
            onChange={onChange}
            removeFile={removeFile}
            sendFile={async (file) => uploaded(file)}
          />
        )}
      </Harness>,
    );

    await browser.upload(
      screen.getByLabelText(labels.image.choose),
      new File(['image'], 'screen.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(screen.getByTestId('markdown-value')).toHaveTextContent('/files/'));
    await browser.click(screen.getByRole('button', { name: 'screen.png 이미지 제거' }));

    await waitFor(() => expect(screen.getByTestId('markdown-value')).toBeEmptyDOMElement());
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('mentionsEnabled가 꺼진 작업 전달에서는 멘션 선택기를 숨기고 직렬화 참조를 저장 불가로 알린다', async () => {
    const onCanSubmitChange = vi.fn();
    const membershipId = '4bfe36e1-2a0f-463c-874b-909b25d0cd8a';

    render(
      <MarkdownEditor
        charLimit={50_000}
        labels={labels}
        value={`@[김리벳](rivet-member:${membershipId})`}
        onChange={() => undefined}
        onCanSubmitChange={onCanSubmitChange}
        mentionsEnabled={false}
        mentionOptions={[{ displayName: '김리벳', membershipId }]}
      />,
    );

    expect(screen.queryByRole('combobox', { name: labels.mention })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(labels.mentionDisabled);
    await waitFor(() => expect(onCanSubmitChange).toHaveBeenLastCalledWith(false));
  });
});

describe('MarkdownEditor density and character count', () => {
  afterEach(() => cleanup());

  it('빈 편집기의 본문 높이는 120~160px 범위(min-h-36)를 사용한다', () => {
    render(
      <Harness>
        {(value, onChange) => (
          <MarkdownEditor charLimit={100} labels={labels} onChange={onChange} value={value} />
        )}
      </Harness>,
    );

    expect(screen.getByRole('textbox', { name: labels.editorLabel })).toHaveClass('min-h-36');
  });

  it('제한에 가까워지면 글자 수 표시를 강조하고 초과하면 오류 색으로 바꾼다', () => {
    const { rerender } = render(
      <Harness>
        {(value, onChange) => (
          <MarkdownEditor charLimit={10} labels={labels} onChange={onChange} value={value} />
        )}
      </Harness>,
    );
    expect(screen.getByText('0/10자')).not.toHaveClass('text-warning');
    expect(screen.getByText('0/10자')).not.toHaveClass('text-destructive');

    rerender(
      <Harness>
        {() => (
          <MarkdownEditor
            charLimit={10}
            labels={labels}
            onChange={() => undefined}
            value="123456789"
          />
        )}
      </Harness>,
    );
    expect(screen.getByText('9/10자')).toHaveClass('text-warning');

    rerender(
      <Harness>
        {() => (
          <MarkdownEditor
            charLimit={10}
            labels={labels}
            onChange={() => undefined}
            value="12345678901"
          />
        )}
      </Harness>,
    );
    expect(screen.getByText('11/10자')).toHaveClass('text-destructive');
  });
});

function uploaded(file: File) {
  return {
    createdAt: new Date(0).toISOString(),
    detectedMimeType: file.type,
    id: '4bfe36e1-2a0f-463c-874b-909b25d0cd8a',
    inlineDisplayable: true,
    linked: false,
    originalName: file.name,
    scope: 'WORKSPACE' as const,
    sizeBytes: file.size,
  };
}
