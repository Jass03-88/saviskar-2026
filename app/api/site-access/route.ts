import { NextResponse } from "next/server";
import { getSiteAccess } from "@/lib/config/site-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const siteAccess = await getSiteAccess();
  return NextResponse.json(
    { siteAccess },
    {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    }
  );
}
