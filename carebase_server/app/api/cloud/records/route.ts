import { NextResponse } from "next/server";
import {
  deleteRecord,
  getRecord,
  listRecords,
  upsertRecord,
} from "../../../../lib/cloud/records";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.CAREBASE_CORS_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function serializeRecord(record: ReturnType<typeof getRecord>) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    encryptedValue: Array.from(record.encryptedValue),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const since = url.searchParams.get("since");

  if (key) {
    const record = getRecord(key);
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    }
    return NextResponse.json({ record: serializeRecord(record) }, { headers: corsHeaders });
  }

  const records = listRecords(since ? Number(since) : undefined).map(
    (record) => serializeRecord(record)
  );
  return NextResponse.json({ records }, { headers: corsHeaders });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload?.record) {
    return NextResponse.json({ error: "Missing record" }, { status: 400, headers: corsHeaders });
  }

  upsertRecord({
    key: payload.record.key,
    encryptedValue: new Uint8Array(payload.record.encryptedValue),
    sensitivityLevel: payload.record.sensitivityLevel,
    createdAt: payload.record.createdAt,
    updatedAt: payload.record.updatedAt,
    syncedAt: payload.record.syncedAt ?? null,
  });

  return NextResponse.json({ status: "ok" }, { headers: corsHeaders });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400, headers: corsHeaders });
  }

  const deleted = deleteRecord(key);
  return NextResponse.json({ deleted }, { headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
