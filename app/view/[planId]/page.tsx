import { notFound } from "next/navigation";
import { getPlanBundle } from "@/lib/db";
import { ViewerView } from "@/components/ViewerView";

export const dynamic = "force-dynamic";

export default async function ViewPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const bundle = await getPlanBundle(planId);
  if (!bundle) notFound();
  return <ViewerView bundle={bundle} />;
}
