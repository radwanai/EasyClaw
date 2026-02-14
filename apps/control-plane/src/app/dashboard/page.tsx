"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  role: string;
  runtime: {
    status: string;
    runtimeUrl: string | null;
    lastHealthAt: string | null;
  } | null;
  googleConnection: {
    email: string;
  } | null;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (session) loadTenants();
  }, [session]);

  async function loadTenants() {
    const res = await fetch("/api/tenants");
    if (res.ok) setTenants(await res.json());
  }

  async function createTenant() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      setNewName("");
      await loadTenants();
    }
    setCreating(false);
  }

  if (status === "loading") {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">Welcome to ClawdBot</h2>
        <p className="text-gray-600 mb-6">
          Sign in to manage your personal assistant tenants.
        </p>
        <button
          onClick={() => signIn("google")}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold">Your Tenants</h2>
        <span className="text-sm text-gray-500">{session.user?.email}</span>
      </div>

      {/* Create tenant */}
      <div className="bg-white rounded-lg border p-4 mb-6 flex gap-3">
        <input
          type="text"
          placeholder="New tenant name (e.g. My Assistant)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createTenant()}
          className="flex-1 px-3 py-2 border rounded-md text-sm"
        />
        <button
          onClick={createTenant}
          disabled={creating || !newName.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create Tenant"}
        </button>
      </div>

      {/* Tenant list */}
      {tenants.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          No tenants yet. Create one above.
        </div>
      ) : (
        <div className="grid gap-4">
          {tenants.map((tenant) => (
            <Link
              key={tenant.id}
              href={`/dashboard/tenants/${tenant.id}`}
              className="block bg-white rounded-lg border p-5 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{tenant.name}</h3>
                  <p className="text-sm text-gray-500">
                    {tenant.slug} &middot; {tenant.role}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {tenant.googleConnection && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                      Google: {tenant.googleConnection.email}
                    </span>
                  )}
                  <RuntimeBadge status={tenant.runtime?.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimeBadge({ status }: { status?: string }) {
  if (!status) {
    return (
      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
        Not provisioned
      </span>
    );
  }

  const colors: Record<string, string> = {
    healthy: "bg-green-100 text-green-700",
    provisioning: "bg-yellow-100 text-yellow-700",
    error: "bg-red-100 text-red-700",
    pending: "bg-gray-100 text-gray-600",
    stopped: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`text-xs px-2 py-1 rounded ${colors[status] || colors.pending}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
