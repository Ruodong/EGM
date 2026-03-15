'use client';

import { Select } from 'antd';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  'data-testid'?: string;
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'All',
  size,
  ...props
}: MultiSelectProps) {
  return (
    <div data-testid={props['data-testid']}>
      <Select
        mode="multiple"
        size={size}
        value={selected}
        onChange={onChange}
        placeholder={placeholder}
        allowClear
        maxTagCount="responsive"
        style={{ minWidth: 140 }}
        options={options}
      />
    </div>
  );
}
