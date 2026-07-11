import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <p className="status-code">404</p>
      <p className="status-kicker">Outside the public workspace</p>
      <h1>Page not found.</h1>
      <p className="status-copy">
        This address does not match a published HS Tracker page. Return to the
        public workspace to continue.
      </p>
      <Link className="status-action" href="/">
        Return to HS Tracker
        <span aria-hidden="true">↗</span>
      </Link>
    </main>
  );
}
