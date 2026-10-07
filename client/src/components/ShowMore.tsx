import { type ReactNode, useState } from 'react';

/** Renders the first `initial` items with a toggle for the rest. */
export function ShowMore<T>({
  items,
  initial,
  noun,
  children,
}: {
  items: T[];
  initial: number;
  noun: string;
  children: (visible: T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const visible = all ? items : items.slice(0, initial);
  return (
    <>
      {children(visible)}
      {items.length > initial && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-2 text-sm font-medium text-accent-700 hover:underline dark:text-accent-300"
        >
          {all ? 'Show fewer' : `Show all ${items.length} ${noun}`}
        </button>
      )}
    </>
  );
}
