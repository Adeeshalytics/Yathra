/**
 * The first thing a keyboard or screen-reader user reaches: a link straight past the navigation.
 * Every layout renders a `<main id="main-content">`, so one link serves them all.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
    >
      Skip to content
    </a>
  );
}
