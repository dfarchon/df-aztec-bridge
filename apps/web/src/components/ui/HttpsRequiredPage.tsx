/** Production hard-stop when the page is served over plain HTTP (non-loopback). */
export function HttpsRequiredPage() {
  return (
    <main className="maintenance-page">
      <div className="maintenance-card">
        <div className="maintenance-icon" aria-hidden="true">
          ⚠
        </div>
        <h1>HTTPS required</h1>
        <p className="maintenance-lead">
          This bridge DApp must run on a secure origin. Open the site over HTTPS.
        </p>
        <p className="maintenance-detail">
          Production hosting (Netlify) enforces TLS. Plain HTTP is blocked in production builds as
          defense-in-depth.
        </p>
      </div>
    </main>
  );
}
