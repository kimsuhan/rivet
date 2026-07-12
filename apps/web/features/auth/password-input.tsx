'use client';

import { Eye, EyeOff } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useState } from 'react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';

export function PasswordInput({
  labels,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & {
  labels: { show: string; hide: string };
}) {
  const [isVisible, setIsVisible] = useState(false);
  const actionLabel = isVisible ? labels.hide : labels.show;

  return (
    <InputGroup>
      <InputGroupInput type={isVisible ? 'text' : 'password'} {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-xs"
          aria-label={actionLabel}
          title={actionLabel}
          onClick={() => setIsVisible((current) => !current)}
        >
          {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
