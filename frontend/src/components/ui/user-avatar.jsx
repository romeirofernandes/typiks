import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { getAvatarPath, normalizeAvatarId } from "@/lib/player-meta";
import { useEffect, useState } from "react";

export function UserAvatar({
  avatarId,
  username = "Player",
  className = "",
  size = "md",
  plain = false,
  expandOnClick = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedAvatar = normalizeAvatarId(avatarId);
  const dimensions =
    size === "sm"
      ? "h-7 w-7"
      : size === "lg"
      ? "h-14 w-14"
      : "h-9 w-9";
  const wrapperClass = cn(
    "inline-flex items-center justify-center rounded-full overflow-hidden",
    plain ? "" : "border border-border/60 bg-background shadow-sm",
    dimensions,
    className
  );

  if (!expandOnClick) {
    return (
      <span className={wrapperClass}>
        <img
          src={getAvatarPath(normalizedAvatar)}
          alt={`${username} avatar`}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("typiks:avatar-preview-state", {
        detail: { open: isOpen },
      })
    );

    return () => {
      window.dispatchEvent(
        new CustomEvent("typiks:avatar-preview-state", {
          detail: { open: false },
        })
      );
    };
  }, [isOpen]);

  return (
    <>
    <motion.button
      type="button"
      onClick={() => setIsOpen(true)}
      aria-label={`Open ${username} avatar`}
      className={cn(
        wrapperClass,
        "transition-transform duration-200 hover:scale-105 focus:outline-none focus-visible:outline-none"
      )}
      whileTap={{ scale: 0.96 }}
    >
      <img
        src={getAvatarPath(normalizedAvatar)}
        alt={`${username} avatar`}
        className="h-full w-full rounded-full object-cover"
        loading="lazy"
        decoding="async"
      />
    </motion.button>

    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsOpen(false)}
        >
          <motion.button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsOpen(false);
            }}
            className="relative h-40 w-40 overflow-hidden rounded-full border border-border/70 bg-background shadow-2xl focus:outline-none focus-visible:outline-none sm:h-52 sm:w-52"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <img
              src={getAvatarPath(normalizedAvatar)}
              alt={`${username} avatar full`}
              className="h-full w-full object-cover"
            />
          </motion.button>
        </motion.div>
      ) : null}
    </AnimatePresence>
    </>
  );
}
