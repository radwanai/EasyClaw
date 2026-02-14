import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const { tenantId } = params;

  // Verify membership
  const membership = await prisma.tenantMember.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const runtime = await prisma.tenantRuntime.findUnique({
    where: { tenantId },
  });

  if (!runtime || !runtime.runtimeUrl) {
    return NextResponse.json(
      { error: "Runtime not available. Provision and wait for healthy status." },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${runtime.runtimeUrl}/jobs/daily-brief`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-clawdbot-secret": process.env.CONTROL_PLANE_SHARED_SECRET || "",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Runtime returned error", detail: body },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to call runtime", detail: err.message },
      { status: 502 }
    );
  }
}
