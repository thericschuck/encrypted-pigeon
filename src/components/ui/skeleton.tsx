interface SkeletonProps {
  className?: string;
}

/** Shimmering placeholder block; shape/size comes entirely from className. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden="true" className={`skeleton rounded-md ${className}`} />;
}
