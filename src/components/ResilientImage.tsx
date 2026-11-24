import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ResilientImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  grayscale?: boolean;
}

export function ResilientImage({
  src,
  alt,
  className = '',
  fallbackLabel,
  grayscale = false,
}: ResilientImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#EFECE6] border border-[#E4E2DD] text-[#57534E] p-6 text-center ${className}`}
      >
        <ImageOff className="w-6 h-6 mb-2 opacity-60" strokeWidth={1.5} />
        <p className="text-xs font-medium">{fallbackLabel || alt || 'Archival photograph'}</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} ${grayscale ? 'grayscale contrast-110' : ''} transition-all duration-200`}
    />
  );
}
