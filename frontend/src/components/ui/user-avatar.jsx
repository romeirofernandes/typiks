import { Blobatar } from "blobatar/react";
import "blobatar/motion.css";
import { m, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export function UserAvatar({
  username = "Player",
  className = "",
  size = "md",
  plain = false,
  expandOnClick = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const overlayButtonRef = useRef(null);
  const dimensions =
    size === "sm"
      ? "h-7 w-7"
      : size === "lg"
      ? "h-14 w-14"
      : size === "xl"
      ? "h-20 w-20"
      : "h-8 w-8";
  const wrapperClass = cn(
    "inline-flex items-center justify-center rounded-full overflow-hidden",
    plain ? "" : "border border-border/60 bg-background shadow-sm",
    dimensions,
    className
  );

  const avatar = (
    <Blobatar
      name={username}
      size={48}
      animate="hover"
      title={`${username} avatar`}
      className="size-full"
    />
  );

  useEffect(() => {
    if (!expandOnClick) return;

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
  }, [expandOnClick, isOpen]);

  useEffect(() => {
    if (!expandOnClick || !isOpen) return;

    const keydown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    overlayButtonRef.current?.focus();
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [expandOnClick, isOpen]);

  if (!expandOnClick) {
    return <span className={wrapperClass}>{avatar}</span>;
  }

  return (
    <>
    <m.button
      type="button"
      onClick={() => setIsOpen(true)}
      aria-label={`Open ${username} avatar`}
      className={cn(
        wrapperClass,
        "transition-transform duration-200 hover:scale-105 focus:outline-none focus-visible:outline-none"
      )}
      whileTap={{ scale: 0.96 }}
    >
      {avatar}
    </m.button>

    <AnimatePresence>
      {isOpen ? (
        <m.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsOpen(false)}
        >
          <m.button
            ref={overlayButtonRef}
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
            <Blobatar
              name={username}
              size={200}
              animate="hover"
              title={`${username} avatar full`}
              className="size-full"
            />
          </m.button>
        </m.div>
      ) : null}
    </AnimatePresence>
    </>
  );
}
