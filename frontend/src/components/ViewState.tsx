import { Link } from "react-router-dom";

/**
 * Empty and loading states.
 *
 * An empty view is not an error — it is usually the app working correctly and
 * having nothing to show yet. So these say what the screen is *for* and what
 * puts something on it, rather than reporting "no data" and leaving the reader
 * to work out whether something is broken. Each one names the next action and,
 * where there is one, links to the module that performs it.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="neu-inset rounded-xl px-6 py-14 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/55">{body}</p>
      {action && (
        <Link
          to={action.to}
          className="neu-raised-sm neu-toggle mt-5 inline-block rounded-lg px-4 py-2 text-sm font-medium text-accent hover:text-accent active:shadow-[inset_3px_3px_7px_var(--neu-dark),inset_-3px_-3px_7px_var(--neu-light)]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/**
 * Shown only before the first data arrives. Once the board has content, a
 * refresh holds the previous render rather than flashing a skeleton — a layout
 * jump on every reconnect is worse than a moment of slightly stale numbers.
 */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="neu-inset rounded-xl px-6 py-14 text-center" aria-live="polite" aria-busy>
      <span className="inline-flex items-center gap-2.5 text-sm text-ink/55">
        <span
          aria-hidden
          className="h-2 w-2 animate-pulse rounded-full bg-accent"
        />
        {label}
      </span>
    </div>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="neu-inset rounded-xl px-6 py-10 text-center">
      <p className="text-sm font-semibold text-bad">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/55">{body}</p>
    </div>
  );
}

/** The standard page heading: title, one line of purpose, a figure on the right. */
export function ViewHeader({
  title,
  description,
  meta,
}: {
  title: string;
  description: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-0.5 text-sm text-ink/55">{description}</p>
      </div>
      {meta && <span className="text-sm text-ink/45" data-num>{meta}</span>}
    </div>
  );
}
