import { Toaster as SonnerToaster } from "sonner";

export function Toaster(props) {
  return (
    <SonnerToaster
      className="toaster group"
      closeButton
      theme="system"
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--card)",
          color: "var(--card-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        },
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          title: "font-sans text-sm font-semibold tracking-tight text-card-foreground",
          description: "font-mono text-xs text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:hover:bg-primary/90",
          cancelButton:
            "group-[.toast]:bg-secondary group-[.toast]:text-secondary-foreground group-[.toast]:hover:bg-secondary/80",
          closeButton:
            "group-[.toast]:border-border group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:hover:bg-accent",
          success: "border-primary/40",
          error: "border-destructive/40",
          warning: "border-chart-5/50",
          info: "border-chart-3/40",
        },
      }}
      {...props}
    />
  );
}
