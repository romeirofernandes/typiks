export default function BackgroundGrid({ children }) {
  return (
    <div className="relative w-full">
      {/* Fixed viewport background grid (content scrolls over this) */}
      <div className="fixed inset-0 bg-background pointer-events-none z-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, var(--border) 1px, transparent 1px),
              linear-gradient(to bottom, var(--border) 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0, 0 0",
            maskImage: `
              repeating-linear-gradient(
                to right,
                black 0px,
                black 3px,
                transparent 3px,
                transparent 8px
              ),
              repeating-linear-gradient(
                to bottom,
                black 0px,
                black 3px,
                transparent 3px,
                transparent 8px
              ),
              radial-gradient(ellipse 100% 80% at 50% 100%, #000 50%, transparent 90%)
            `,
            WebkitMaskImage: `
              repeating-linear-gradient(
                to right,
                black 0px,
                black 3px,
                transparent 3px,
                transparent 8px
              ),
              repeating-linear-gradient(
                to bottom,
                black 0px,
                black 3px,
                transparent 3px,
                transparent 8px
              ),
              radial-gradient(ellipse 100% 80% at 50% 100%, #000 50%, transparent 90%)
            `,
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        />
      </div>

      {/* Page Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}