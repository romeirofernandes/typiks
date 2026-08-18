import { memo } from "react";

export const WordDisplay = memo(function WordDisplay({ word, input }) {
  const activeWord = String(word || "");
  const activeInput = String(input || "");

  return (
    <div className="relative inline-block font-mono text-4xl font-medium leading-none tracking-wider sm:text-5xl">
      {activeWord.split("").map((char, charIndex) => {
        const typedChar = activeInput[charIndex];
        const isCurrentPosition = charIndex === activeInput.length;
        const isTyped = charIndex < activeInput.length;
        const isCorrect = isTyped && typedChar === char;
        const isWrong = isTyped && typedChar !== char;
        const renderedChar = char === " " ? "\u00A0" : char;
        const renderedTypedChar = isWrong && typedChar === " " ? "_" : typedChar;

        return (
          <span
            key={charIndex}
            className={`relative inline-block min-w-[0.45em] align-baseline transition-colors duration-75 ${
              isCorrect
                ? "text-primary"
                : isWrong
                  ? "text-destructive"
                  : "text-muted-foreground/50"
            }`}
          >
            {isCurrentPosition ? (
              <span
                className="absolute -left-[2px] top-0 h-full w-[3px] bg-primary"
                style={{ animation: "blink 1s ease-in-out infinite" }}
              />
            ) : null}
            {isWrong ? renderedTypedChar : renderedChar}
          </span>
        );
      })}
      {activeInput.length === activeWord.length && activeWord ? (
        <span
          className="absolute -right-[2px] top-0 h-full w-[3px] bg-primary"
          style={{ animation: "blink 1s ease-in-out infinite" }}
        />
      ) : null}
    </div>
  );
});
