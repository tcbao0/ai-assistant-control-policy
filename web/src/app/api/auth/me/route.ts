import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/services/auth.service";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  try { return NextResponse.json({ owner: await requireOwner(req) }); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
}
