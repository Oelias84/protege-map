/** tiny helpers shared by the route handlers */

import { NextResponse } from "next/server";

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);
export const created = <T>(data: T) => NextResponse.json(data, { status: 201 });
export const noContent = () => new NextResponse(null, { status: 204 });
export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });
export const notFound = (message = "not found") =>
  NextResponse.json({ error: message }, { status: 404 });

/** wrap a handler so thrown errors become 500 JSON instead of an HTML page */
export function handler<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      // ENOENT from the storage layer -> 404
      if (/ENOENT|no such file/.test(message)) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      console.error(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("invalid JSON body");
  }
}

const NUM = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const asUnitInterval = (v: unknown) => {
  const n = NUM(v);
  return n !== undefined && n >= 0 && n <= 1 ? n : undefined;
};
