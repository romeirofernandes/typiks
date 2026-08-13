import { motion, useReducedMotion } from "framer-motion";
import { Children, useCallback, useEffect, useRef, useState } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export function SharedLayoutBg({
  children,
  className,
  onMouseLeave,
  pillClassName,
  pillContainerClassName,
  inset = 20,
  activeKey = null,
}) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);
  const [bounds, setBounds] = useState(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!activeRef.current) return;
    measure();
  });

  const measure = useCallback(() => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    const c = container.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    const next = {
      left: r.left - c.left,
      top: r.top - c.top,
      width: r.width,
      height: r.height,
    };
    setBounds((prev) => {
      if (
        prev &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  const handleMouseLeave = (event) => {
    if (activeKey == null) {
      activeRef.current = null;
      setBounds(null);
    }
    onMouseLeave?.(event);
  };

  return (
    <div
      ref={containerRef}
      onMouseLeave={handleMouseLeave}
      className={cn("relative w-full overflow-clip", className)}
    >
      {bounds ? (
        <motion.div
          aria-hidden
          initial={false}
          animate={{
            left: bounds.left - inset,
            top: bounds.top - inset,
            width: bounds.width + inset * 2,
            height: bounds.height + inset * 2,
          }}
          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
          className={cn(
            "pointer-events-none absolute rounded-md bg-primary",
            pillClassName,
            pillContainerClassName
          )}
        />
      ) : null}

      {Children.map(children, (child, index) => {
        if (child === null || child === undefined) return child;
        const key = child.key ?? index;
        const isActive = activeKey != null && key === activeKey;
        return (
          <div
            key={key}
            ref={
              isActive
                ? (node) => {
                    activeRef.current = node;
                  }
                : undefined
            }
            className="relative"
            onMouseEnter={
              activeKey == null
                ? (event) => {
                    activeRef.current = event.currentTarget;
                    measure();
                  }
                : undefined
            }
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}