'use client';

import { UserRound, UserRoundX } from 'lucide-react';
import { useDeferredValue, useState } from 'react';

import { IssueFilterMenu } from './issue-filter-menu';
import { useIssueMemberPages } from './issue-list-queries';

const UNASSIGNED = '__unassigned__';

export function IssueAssigneeFilter({
  onChange,
  selected,
}: {
  onChange: (selected: { membershipIds: string[]; unassigned: boolean }) => void;
  selected: { membershipIds: string[]; unassigned: boolean };
}) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const members = useIssueMemberPages({
    limit: 100,
    status: 'ACTIVE,INACTIVE',
    ...(deferredSearch ? { query: deferredSearch } : {}),
  });
  const options = [
    {
      icon: UserRoundX,
      id: UNASSIGNED,
      label: '담당자 없음',
    },
    ...(members.data?.pages.flatMap((page) =>
      page.items.map((member) => ({
        icon: UserRound,
        id: member.id,
        label: member.user.displayName,
        ...(member.status === 'INACTIVE' ? { suffix: '비활성' } : {}),
      })),
    ) ?? []),
  ];
  const selectedValues = [...(selected.unassigned ? [UNASSIGNED] : []), ...selected.membershipIds];

  return (
    <IssueFilterMenu
      ariaLabel="담당자 필터"
      busy={members.isPending}
      emptyLabel={members.isError ? '담당자를 불러오지 못했습니다.' : '검색 결과가 없습니다.'}
      hasMore={members.hasNextPage}
      label="담당자"
      loadingMore={members.isFetchingNextPage}
      onChange={(values) =>
        onChange({
          membershipIds: values.filter((value) => value !== UNASSIGNED),
          unassigned: values.includes(UNASSIGNED),
        })
      }
      onLoadMore={() => void members.fetchNextPage()}
      onSearchChange={setSearch}
      options={options}
      search={search}
      selected={selectedValues}
      variant="compact"
    />
  );
}
