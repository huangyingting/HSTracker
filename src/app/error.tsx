"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled HS Tracker page error", error);
  }, [error]);

  return (
    <main className="status-page">
      <p className="status-code">500</p>
      <p className="status-kicker">The workspace could not load</p>
      <h1>Something went wrong.</h1>
      <p className="status-copy">
        HS Tracker could not complete this request. Try loading the public
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
  );
}
