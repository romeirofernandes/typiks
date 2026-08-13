import { motion, useReducedMotion } from "framer-motion";

export default function FreePlay() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex min-h-full min-w-0 flex-col items-center justify-center gap-2"
    >
      <motion.p
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.08 }}
        className="text-xs uppercase tracking-[0.25em] text-muted-foreground"
      >
        Free Play
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.14 }}
        className="text-2xl font-semibold sm:text-3xl"
      >
        Coming Soon
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, delay: 0.2 }}
        className="mt-1 text-sm text-muted-foreground"
      >
        This mode is on its way.
      </motion.p>
    </motion.div>
  );
}