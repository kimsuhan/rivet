import { Prisma } from '@rivet/database';

export function teamUniqueConstraintTargets(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const target = error.meta?.target;
  if (typeof target === 'string') return [target];
  return Array.isArray(target)
    ? target.filter((value): value is string => typeof value === 'string')
    : [];
}
