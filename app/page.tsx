import Link from "next/link";
import { listPlans } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const plans = await listPlans().catch(() => []);
  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Sheets</h1>
        <Link className="btn btn--primary" href="/upload">
          Upload a sheet
        </Link>
      </div>

      {plans.length === 0 ? (
        <p style={{ color: "var(--graphite-60)", marginTop: 24 }}>
          No sheets yet. Upload a vector building-plan PDF to mark up its מקרא.
        </p>
      ) : (
        <ul className="sheet-list">
          {plans.map((p) => (
            <li key={p.id} className="sheet-list__row">
              <div>
                <span className="tb-label">Sheet</span>
                <div className="sheet-list__name">{p.name}</div>
              </div>
              <span className="tb-value tb-status" data-status={p.status}>
                {p.status}
              </span>
              <div className="row">
                <Link className="btn" href={`/authoring/${p.id}`}>
                  Mark up
                </Link>
                <Link className="btn" href={`/view/${p.id}`}>
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
