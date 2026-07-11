"use client";

import { useEffect } from "react";

import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled HS Tracker application error", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>HS Tracker | Something went wrong</title>
        <main className="status-page">
          <p className="status-code">500</p>
          <p className="status-kicker">The application could not load</p>
          <h1>Something went wrong.</h1>
          <p className="status-copy">
            HS Tracker could not start correctly. Try loading the public
            workspace again.
          </p>
          <button
            className="status-action"
            type="button"
            onClick={unstable_retry}
          >
            Try again
            <span aria-hidden="true">↻</span>
          </button>
        </main>
      </body>
    </html>
  );
}
