import { Film } from 'lucide-react';
import { useState } from 'react';

interface ResilientPosterProps {
  src: string;
  alt: string;
  className?: string;
}

export function ResilientPoster({ src, alt, className = '' }: ResilientPosterProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#18181F] via-[#101015] to-[#09090B] text-zinc-400 p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Film className="w-8 h-8 mb-2 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-300 line-clamp-2">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      loading="lazy"
    />
  );
}
