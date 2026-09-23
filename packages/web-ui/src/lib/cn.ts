import { extendTailwindMerge } from "tailwind-merge";

// Tailwind emits same-property utilities in discovery order, so `w-64` passed to a
// component can lose to its own `w-full`. Merging drops the overridden class.
// Custom theme values from tailwind.config.js are registered so they merge too.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["glow"] }],
      ease: [{ ease: ["out-expo", "spring", "theme-ease"] }],
      transition: [{ transition: ["theme", "size"] }],
    },
  },
});

/** Join class names, skipping falsy entries; later classes override conflicting earlier ones. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return twMerge(classes.filter(Boolean).join(" "));
}
