import { ArrowUp01Icon } from "hugeicons-react";

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export default function BackToTopButton() {
  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      title="Back to top"
      className="fixed bottom-6 right-6 z-50 h-11 w-11 grid place-items-center border border-border/70 bg-card/70 text-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/40"
    >
      <ArrowUp01Icon size={18} />
    </button>
  );
}
