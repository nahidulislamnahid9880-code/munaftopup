import React, {useRef, useState} from 'react';
import {Loader2, Trash2, Upload} from 'lucide-react';
import {auth} from '../lib/firebase';
import {useAuth} from '../contexts/AuthContext';
import {ImageWithFallback} from './ImageWithFallback';

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
  endpoint?: '/api/admin/upload' | '/api/upload';
  compact?: boolean;
}

export function ImageUploadField({
  label,
  value,
  onChange,
  endpoint = '/api/admin/upload',
  compact = false,
}: Props) {
  const {adminFetch} = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      let res: Response;
      if (endpoint === '/api/admin/upload') {
        res = await adminFetch(endpoint, {method: 'POST', body: formData});
      } else {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
        res = await fetch(endpoint, {
          method: 'POST',
          headers: token ? {Authorization: `Bearer ${token}`} : undefined,
          body: formData,
        });
      }

      const data = (await res.json()) as {url?: string; error?: string};
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Image upload failed');
      }
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="flex items-start gap-3">
        {!compact && (
          <div className="w-20 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800">
            <ImageWithFallback
              src={value}
              alt={label}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="/uploads/... or image URL"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/x-icon"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition-colors">
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {uploading ? 'Uploading' : 'Upload'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                title="Clear image"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
