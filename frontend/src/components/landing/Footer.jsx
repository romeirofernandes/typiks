export default function Footer() {
  return (
    <footer className="w-full px-4 py-8 border-t border-border/40 mt-12 z-10 relative">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground [font-family:var(--font-sans)] lowercase">
        <div>
          <span className="font-semibold text-foreground">typiks</span> © 2026 all rights reserved.
        </div>
        <div>
          crafted by <span className="text-primary">romeiro</span>
        </div>
      </div>
    </footer>
  );
}
