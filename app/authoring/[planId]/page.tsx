import { notFound } from "next/navigation";
import { getPlanBundle } from "@/lib/db";
import { AuthoringView } from "@/components/AuthoringView";

export const dynamic = "force-dynamic";

export default async function AuthoringPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const bundle = await getPlanBundle(planId);
  if (!bundle) notFound();
  return <AuthoringView bundle={bundle} />;
}
