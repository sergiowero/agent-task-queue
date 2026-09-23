# Skeleton

A shimmering placeholder block that you size with `className` to match the content it stands in for.

- Pass width, height and radius classes: `h-4 w-3/4` for a title line, `h-5 w-16 rounded-full` for a badge, `h-9 w-9 rounded-xl` for an icon well.
- Compose skeletons inside the real container (a `.card`) so the layout doesn't jump when data lands.
- The shimmer is a 1.6s linear sweep between `surface-tertiary` and `surface-secondary`. It is `aria-hidden`, so mark the region `aria-busy`.
