import Image from 'next/image';

import { cn } from '@/lib/utils';

// assets/brand의 원본을 여백만 잘라 public/brand로 옮긴 사본이다. 비율을 바꾸면 마크가 왜곡된다.
const WORDMARK = { height: 323, width: 1315 };
const SYMBOL = { height: 428, width: 525 };

export function RivetWordmark({ alt = '', className }: { alt?: string; className?: string }) {
  return (
    <Image
      alt={alt}
      className={cn('h-5 w-auto', className)}
      height={WORDMARK.height}
      priority
      src="/brand/logo.png"
      width={WORDMARK.width}
    />
  );
}

export function RivetSymbol({ alt = '', className }: { alt?: string; className?: string }) {
  return (
    <Image
      alt={alt}
      className={cn('h-6 w-auto', className)}
      height={SYMBOL.height}
      priority
      src="/brand/symbol.png"
      width={SYMBOL.width}
    />
  );
}
