import { clsx } from "clsx";

// shadcn's cn() normally wraps clsx with tailwind-merge to de-dupe conflicting
// Tailwind classes. tailwind-merge isn't installed in this project, so we fall
// back to clsx alone — fine here because we don't pass conflicting utilities.
export function cn(...inputs) {
  return clsx(inputs);
}
