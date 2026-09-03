import Link from "next/link";
import { listPlans } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const plans = await listPlans().catch(() => []);
  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Plans</h1>
        <Link className="btn btn--primary" href="/upload">
          Upload plan
        </Link>
      </div>

      {plans.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No plans yet. Upload a vector building-plan PDF to start.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
          {plans.map((p) => (
            <li
              key={p.id}
              className="row"
              style={{
                justifyContent: "space-between",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 8,
                background: "var(--panel)",
              }}
            >
              <div>
                <strong>{p.name}</strong>
                <span style={{ color: "var(--muted)", marginInlineStart: 8 }}>{p.status}</span>
              </div>
              <div className="row">
                <Link className="btn" href={`/authoring/${p.id}`}>
                  Author
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
