export function MaintenancePage() {
  return (
    <main className="maintenance-page">
      <div className="maintenance-card">
        <div className="maintenance-icon" aria-hidden="true">
          ⚠
        </div>
        <h1>Temporary Maintenance</h1>
        <p className="maintenance-lead">
          Aztec Mainnet RPC is currently unavailable. Bridge and claim operations are paused until
          the node endpoint is restored.
        </p>
        <p className="maintenance-detail">
          We are monitoring the situation and will re-enable the app as soon as connectivity is
          stable. Thank you for your patience.
        </p>
        <p className="maintenance-status">
          <span className="maintenance-status-dot" aria-hidden="true" />
          Mainnet RPC offline
        </p>
      </div>
    </main>
  );
}
