import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTenantRuntimeStatus, useMock } from "@/lib/provisioner";

export async function POST(
  req: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId } = params;

  const runtime = await prisma.tenantRuntime.findUnique({
    where: { tenantId },
  });

  if (!runtime) {
    return NextResponse.json(
      { error: "Runtime not provisioned" },
      { status: 404 }
    );
  }

  try {
    // Check ECS service status
    const ecsStatus = await getTenantRuntimeStatus(tenantId);

    if (!ecsStatus) {
      await prisma.tenantRuntime.update({
        where: { tenantId },
        data: { status: "error" },
      });
      return NextResponse.json({ status: "error", detail: "Service not found in ECS" });
    }

    // If running, try to ping /health
    let healthResponse: any = null;
    if (ecsStatus.runningCount > 0) {
      const runtimeUrl = runtime.runtimeUrl || (useMock ? "http://localhost:8080" : null);

      if (runtimeUrl) {
        try {
          const res = await fetch(`${runtimeUrl}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            healthResponse = await res.json();
          }
        } catch {
          // health check failed, but service might still be starting
        }
      }
    }

    const newStatus =
      healthResponse?.status === "healthy"
        ? "healthy"
        : ecsStatus.runningCount > 0
        ? "provisioning"
        : "error";

    await prisma.tenantRuntime.update({
      where: { tenantId },
      data: {
        status: newStatus,
        lastHealthAt: newStatus === "healthy" ? new Date() : undefined,
        runtimeUrl:
          ecsStatus.taskIp && !runtime.runtimeUrl
            ? `http://${ecsStatus.taskIp}:8080`
            : undefined,
      },
    });

    return NextResponse.json({
      status: newStatus,
      ecs: ecsStatus,
      health: healthResponse,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Health check failed", detail: err.message },
      { status: 500 }
    );
  }
}
