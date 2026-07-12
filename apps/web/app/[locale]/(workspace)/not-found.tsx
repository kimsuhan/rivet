import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { ContentEmpty } from '@/components/states/content-empty';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('States');

  return (
    <div className="flex min-h-[60vh] items-center">
      <ContentEmpty
        icon={FileQuestion}
        title={t('notFoundTitle')}
        description={t('notFoundDescription')}
        headingLevel={1}
      >
        <Link href="/my-issues" className={buttonVariants()}>
          {t('backToMyIssues')}
        </Link>
      </ContentEmpty>
    </div>
  );
}
