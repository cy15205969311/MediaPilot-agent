import { useEffect, useMemo, useState } from "react";

import { buildAbsoluteMediaUrl } from "../api";
import { getInitials } from "../utils/format";

type UserAvatarProps = {
  src?: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
  textClassName?: string;
};

export function UserAvatar(props: UserAvatarProps) {
  const {
    src,
    name,
    className = "h-12 w-12",
    fallbackClassName = "bg-red-500",
    textClassName = "text-white",
  } = props;
  const [hasError, setHasError] = useState(false);

  const resolvedSrc = useMemo(() => buildAbsoluteMediaUrl(src), [src]);
  const initials = useMemo(() => getInitials(name).slice(0, 2), [name]);

  useEffect(() => {
    setHasError(false);
  }, [resolvedSrc]);

  return (
    <div
      className={`inline-flex items-center justify-center overflow-hidden rounded-full ${className} ${fallbackClassName} ${textClassName}`}
    >
      {resolvedSrc && !hasError ? (
        <img
          alt={`${name} avatar`}
          className="h-full w-full object-cover"
          onError={() => setHasError(true)}
          src={resolvedSrc}
        />
      ) : (
        <span className="text-sm font-semibold uppercase">{initials.slice(0, 1)}</span>
      )}
    </div>
  );
}
