import { NextResponse } from "next/server";
import { getLastSync, listRecords, setLastSync } from "../../../../lib/cloud/records";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.CAREBASE_CORS_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function serializeRecord(record: ReturnType<typeof listRecords>[number]) {
  return {
    ...record,
    encryptedValue: Array.from(record.encryptedValue),
  };
}

export async function GET() {
  const lastSync = getLastSync();
  const records = listRecords(lastSync ?? undefined).map(serializeRecord);
  return NextResponse.json({ lastSync, records }, { headers: corsHeaders });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload?.timestamp) {
    return NextResponse.json({ error: "Missing timestamp" }, { status: 400, headers: corsHeaders });
  }
  setLastSync(Number(payload.timestamp));
  return NextResponse.json({ status: "ok" }, { headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
