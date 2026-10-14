"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * One request per contact per page load, at most two in flight: a list of
 * a hundred expired photos must not fire a hundred requests at once.
 */
const inflight = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let running = 0;
const MAX_CONCURRENT = 2;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

/** Ask the server for a current full-size photo (see /api/contacts/[id]/avatar). */
export function requestAvatarRefresh(contactId: string): Promise<string | null> {
  let pending = inflight.get(contactId);
  if (!pending) {
    pending = schedule(() =>
      fetch(`/api/contacts/${contactId}/avatar`, { method: "POST" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (data?.avatar_url as string | null) ?? null)
        .catch(() => null)
    );
    inflight.set(contactId, pending);
  }
  return pending;
}

/** Our own stored copy, as opposed to an expiring WhatsApp link. */
export function isStoredAvatar(url: string | null | undefined): boolean {
  return !!url && url.includes("/inbound-media/avatars/");
}

interface ContactAvatarProps {
  contactId?: string;
  url?: string | null;
  name: string;
  className?: string;
  /** Upgrade an old WhatsApp thumbnail to the full-size copy right away,
   *  not only when it fails to load (used where the photo can be enlarged). */
  upgrade?: boolean;
  onResolved?: (url: string) => void;
}

/**
 * Contact photo with a graceful fallback. An expired WhatsApp link shows
 * the initial instead of a broken image, and a fresh photo is fetched in
 * the background.
 */
export function ContactAvatar({
  contactId,
  url,
  name,
  className,
  upgrade = false,
  onResolved,
}: ContactAvatarProps) {
  const [override, setOverride] = useState<{ for: string | null | undefined; url: string | null } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = override && override.for === url ? override.url : url;
  const showImage = !!src && failedUrl !== src;

  const refresh = (from: string | null | undefined) => {
    if (!contactId) return;
    void requestAvatarRefresh(contactId).then((fresh) => {
      if (fresh && fresh !== from) {
        setOverride({ for: url, url: fresh });
        onResolved?.(fresh);
      }
    });
  };

  useEffect(() => {
    if (!upgrade || !contactId || !url || isStoredAvatar(url)) return;
    let alive = true;
    void requestAvatarRefresh(contactId).then((fresh) => {
      if (!alive || !fresh || fresh === url) return;
      setOverride({ for: url, url: fresh });
      onResolved?.(fresh);
    });
    return () => {
      alive = false;
    };
    // onResolved is a callback prop; re-running on its identity would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upgrade, contactId, url]);

  return (
    <div
      className={cn(
        "bg-muted text-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium",
        className
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => {
            setFailedUrl(src);
            refresh(src);
          }}
        />
      ) : (
        <span aria-hidden="true">{(name || "?").charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}
