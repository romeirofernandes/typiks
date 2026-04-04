import { cn } from "@/lib/utils";

export function Spinner({ className, ...props }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
      {...props}
    />
  );
}

export default Spinner;