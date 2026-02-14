import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureTenantSecret,
  provisionTenantEcsService,
} from "@/lib/provisioner";

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

  // Verify user is a member
  const membership = await prisma.tenantMember.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this tenant" }, { status: 403 });
  }

  try {
    // 1. Ensure Secrets Manager secret exists
    const secretArn = await ensureTenantSecret(tenantId);

    // 2. Update status to provisioning
    await prisma.tenantRuntime.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ecsCluster: process.env.ECS_CLUSTER_NAME || "clawdbot-cluster",
        ecsServiceName: `clawdbot-tenant-${tenantId}`,
        status: "provisioning",
        secretsArn: secretArn,
      },
      update: {
        status: "provisioning",
        secretsArn: secretArn,
      },
    });

    // 3. Create/update ECS service
    const result = await provisionTenantEcsService(tenantId, secretArn);

    // 4. Update runtime record with results
    const runtime = await prisma.tenantRuntime.update({
      where: { tenantId },
      data: {
        ecsCluster: result.cluster,
        ecsServiceName: result.serviceName,
        taskDefArn: result.taskDefArn,
        status: "provisioning", // Will become healthy after health check passes
        secretsArn: secretArn,
      },
    });

    return NextResponse.json(runtime);
  } catch (err: any) {
    console.error(`[provision] Error provisioning tenant ${tenantId}:`, err);

    // Update status to error
    await prisma.tenantRuntime.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ecsCluster: process.env.ECS_CLUSTER_NAME || "clawdbot-cluster",
        ecsServiceName: `clawdbot-tenant-${tenantId}`,
        status: "error",
      },
      update: {
        status: "error",
      },
    });

    return NextResponse.json(
      { error: "Provisioning failed", detail: err.message },
      { status: 500 }
    );
  }
}
