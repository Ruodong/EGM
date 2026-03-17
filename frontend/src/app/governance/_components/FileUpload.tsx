'use client';

import { useRef } from 'react';
import { useLocale } from '@/lib/locale-context';

interface FileUploadProps {
  files: File[];
  onChange: (files: File[]) => void;
}

export function FileUpload({ files, onChange }: FileUploadProps) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      onChange([...files, ...newFiles]);
    }
    // Reset input so the same file can be selected again
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <label className="block text-sm font-medium mb-1">{t('fileUpload.attachments')}</label>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-sm rounded-lg border border-border-light bg-white hover:bg-gray-50 transition-colors"
          data-testid="btn-add-attachment"
        >
          {t('fileUpload.addFiles')}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          data-testid="input-file-upload"
        />
        {files.length > 0 && (
          <ul className="space-y-1" data-testid="attachment-list">
            {files.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center gap-2 text-sm p-2 bg-gray-50 rounded">
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-text-secondary text-xs">{formatSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="text-red-500 hover:text-red-700 text-xs"
                  data-testid={`btn-remove-attachment-${i}`}
                >
                  {t('common.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
