import { z } from 'zod';

const result = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    API_INTERNAL_ORIGIN: z.url(),
    RELEASE_ID: z.string().trim().min(1),
  })
  .safeParse({
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    API_INTERNAL_ORIGIN: process.env.API_INTERNAL_ORIGIN ?? 'http://127.0.0.1:4000',
    RELEASE_ID:
      process.env.RELEASE_ID ?? (process.env.NODE_ENV === 'production' ? undefined : 'local'),
  });

if (!result.success) {
  throw new Error('웹 환경 변수 구성이 올바르지 않습니다.');
}

export const webEnvironment = result.data;
