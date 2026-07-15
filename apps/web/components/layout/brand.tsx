import Image from 'next/image';

import { cn } from '@/lib/utils';

// assets/brand의 원본을 여백만 잘라 public/brand로 옮긴 사본이다. 비율을 바꾸면 마크가 왜곡된다.
const WORDMARK = { height: 444, width: 1898 };
const SYMBOL = { height: 778, width: 800 };
const BRAND_ASSET_VERSION = '20260715';

export function RivetWordmark({ alt = '', className }: { alt?: string; className?: string }) {
  return (
    <Image
      alt={alt}
      className={cn('h-5 w-auto', className)}
      height={WORDMARK.height}
      priority
      src={`/brand/logo.png?v=${BRAND_ASSET_VERSION}`}
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
      src={`/brand/symbol.png?v=${BRAND_ASSET_VERSION}`}
      width={SYMBOL.width}
    />
  );
}
