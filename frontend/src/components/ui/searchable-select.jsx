import * as React from "react";
import { cn } from "@/lib/utils";

function SearchableSelect({
  value,
  onValueChange,
  options = [],
  placeholder = "Select...",
  disabled = false,
  className,
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);
  const containerRef = React.useRef(null);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const lower = query.toLowerCase();
    return options.filter((opt) =>
      (opt.label || opt.value || opt).toLowerCase().includes(lower)
    );
  }, [options, query]);

  const selectedLabel = React.useMemo(() => {
    const found = options.find(
      (opt) => (opt.value || opt) === value
    );
    return found ? found.label || found.value || found : value || "";
  }, [options, value]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const select = (val) => {
    onValueChange?.(val);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightedIndex]) {
        const val = filtered[highlightedIndex].value || filtered[highlightedIndex];
        select(val);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !value && "text-muted-foreground",
          className
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <svg
          className="size-4 shrink-0 opacity-50"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
          <div className="border-b border-border p-1">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              className="w-full rounded-sm bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            ref={listRef}
            className="max-h-64 overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No results found
              </div>
            ) : (
              filtered.map((opt, index) => {
                const itemValue = opt.value || opt;
                const itemLabel = opt.label || opt;
                const isSelected = itemValue === value;
                const isHighlighted = index === highlightedIndex;

                return (
                  <button
                    key={itemValue}
                    type="button"
                    onClick={() => select(itemValue)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={cn(
                      "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none",
                      "hover:bg-accent hover:text-accent-foreground",
                      isHighlighted && "bg-accent text-accent-foreground",
                      isSelected && "font-medium"
                    )}
                  >
                    <span className="truncate">{itemLabel}</span>
                    {isSelected && (
                      <span className="absolute right-2 flex size-3.5 items-center justify-center">
                        <svg
                          className="size-4"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { SearchableSelect };
