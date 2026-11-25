import React, {useEffect, useState} from 'react';
import {Gem} from 'lucide-react';

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackLabel?: string;
}

export function ImageWithFallback({
  src,
  alt,
  className = '',
  fallbackLabel,
  ...rest
}: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-300 select-none ${className}`}
        role="img"
        aria-label={alt || fallbackLabel || 'Product visual'}>
        <Gem className="w-8 h-8 text-cyan-400/80 mb-2" />
        {fallbackLabel && (
          <span className="text-xs font-medium text-slate-300 px-3 text-center truncate max-w-full">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      {...rest}
    />
  );
}
