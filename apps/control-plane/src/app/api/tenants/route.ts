import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const memberships = await prisma.tenantMember.findMany({
    where: { userId },
    include: {
      tenant: {
        include: {
          runtime: true,
          googleConnection: true,
        },
      },
    },
  });

  return NextResponse.json(
    memberships.map((m) => ({
      ...m.tenant,
      role: m.role,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const { name } = await req.json();

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return NextResponse.json(
      { error: "Tenant name must be at least 2 characters" },
      { status: 400 }
    );
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const tenant = await prisma.tenant.create({
    data: {
      name: name.trim(),
      slug,
      members: {
        create: {
          userId,
          role: "owner",
        },
      },
    },
    include: {
      runtime: true,
      googleConnection: true,
    },
  });

  return NextResponse.json(tenant, { status: 201 });
}
