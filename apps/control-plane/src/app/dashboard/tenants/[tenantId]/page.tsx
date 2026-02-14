"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  runtime: {
    status: string;
    ecsServiceName: string;
    ecsCluster: string;
    taskDefArn: string | null;
    runtimeUrl: string | null;
    lastHealthAt: string | null;
    secretsArn: string | null;
  } | null;
  googleConnection: {
    email: string;
    scope: string;
    connectedAt: string;
  } | null;
}

export default function TenantDetailPage() {
  const { data: session } = useSession();
  const { tenantId } = useParams<{ tenantId: string }>();
  const searchParams = useSearchParams();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [briefResult, setBriefResult] = useState<any>(null);
  const [runningBrief, setRunningBrief] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (session) loadTenant();
    const googleStatus = searchParams.get("google");
    const error = searchParams.get("error");
    if (googleStatus === "connected") setMessage("Google account connected!");
    if (error) setMessage(`Error: ${error}`);
  }, [session, searchParams]);

  async function loadTenant() {
    const res = await fetch("/api/tenants");
    if (res.ok) {
      const tenants = await res.json();
      const t = tenants.find((t: any) => t.id === tenantId);
      if (t) setTenant(t);
    }
  }

  async function provision() {
    setProvisioning(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/provision`, {
        method: "POST",
      });
      if (res.ok) {
        setMessage("Provisioning started!");
        await loadTenant();
      } else {
        const body = await res.json();
        setMessage(`Provisioning failed: ${body.error}`);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setProvisioning(false);
  }

  async function checkHealth() {
    setChecking(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/health`, {
        method: "POST",
      });
      const data = await res.json();
      setMessage(`Health: ${data.status || data.error}`);
      await loadTenant();
    } catch (err: any) {
      setMessage(`Health check failed: ${err.message}`);
    }
    setChecking(false);
  }

  async function runDailyBrief() {
    setRunningBrief(true);
    setBriefResult(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/daily-brief`, {
        method: "POST",
      });
      const data = await res.json();
      setBriefResult(data);
    } catch (err: any) {
      setBriefResult({ error: err.message });
    }
    setRunningBrief(false);
  }

  if (!tenant) {
    return <div className="text-gray-500">Loading tenant...</div>;
  }

  const region = process.env.NEXT_PUBLIC_AWS_REGION || "us-east-1";
  const logGroupUrl = tenant.runtime
    ? `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/$252Fecs$252Fclawdbot$252Ftenant-runtime`
    : null;

  return (
    <div>
      <Link
        href="/dashboard"
        className="text-blue-600 text-sm hover:underline mb-4 inline-block"
      >
        &larr; Back to Dashboard
      </Link>

      <h2 className="text-2xl font-bold mb-2">{tenant.name}</h2>
      <p className="text-gray-500 text-sm mb-6">ID: {tenant.id}</p>

      {message && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-md p-3 mb-6">
          {message}
        </div>
      )}

      {/* Runtime Section */}
      <section className="bg-white rounded-lg border p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">Runtime</h3>

        {tenant.runtime ? (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <StatusBadge status={tenant.runtime.status} />
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Service</span>
              <span className="font-mono">{tenant.runtime.ecsServiceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cluster</span>
              <span className="font-mono">{tenant.runtime.ecsCluster}</span>
            </div>
            {tenant.runtime.runtimeUrl && (
              <div className="flex justify-between">
                <span className="text-gray-500">URL</span>
                <span className="font-mono">{tenant.runtime.runtimeUrl}</span>
              </div>
            )}
            {tenant.runtime.lastHealthAt && (
              <div className="flex justify-between">
                <span className="text-gray-500">Last Healthy</span>
                <span>
                  {new Date(tenant.runtime.lastHealthAt).toLocaleString()}
                </span>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={checkHealth}
                disabled={checking}
                className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
              >
                {checking ? "Checking..." : "Ping Health"}
              </button>
              <button
                onClick={provision}
                disabled={provisioning}
                className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200 disabled:opacity-50"
              >
                {provisioning ? "Reprovisioning..." : "Reprovision"}
              </button>
              {logGroupUrl && (
                <a
                  href={logGroupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200"
                >
                  View Logs
                </a>
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-gray-500 text-sm mb-3">
              No runtime provisioned yet.
            </p>
            <button
              onClick={provision}
              disabled={provisioning}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {provisioning ? "Provisioning..." : "Provision ClawdBot"}
            </button>
          </div>
        )}
      </section>

      {/* Google Connection */}
      <section className="bg-white rounded-lg border p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">Google Connection</h3>

        {tenant.googleConnection ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span>{tenant.googleConnection.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Connected</span>
              <span>
                {new Date(tenant.googleConnection.connectedAt).toLocaleString()}
              </span>
            </div>
            <div className="pt-2">
              <a
                href={`/api/tenants/${tenantId}/connect-google`}
                className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200 inline-block"
              >
                Reconnect Google
              </a>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-gray-500 text-sm mb-3">
              Connect Google to enable Gmail and Calendar features.
            </p>
            <a
              href={`/api/tenants/${tenantId}/connect-google`}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 inline-block"
            >
              Connect Google Account
            </a>
          </div>
        )}
      </section>

      {/* Daily Brief */}
      <section className="bg-white rounded-lg border p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">Daily Brief</h3>

        <button
          onClick={runDailyBrief}
          disabled={runningBrief || !tenant.runtime}
          className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 disabled:opacity-50"
        >
          {runningBrief ? "Running..." : "Run Daily Brief"}
        </button>

        {!tenant.runtime && (
          <p className="text-gray-400 text-xs mt-2">
            Provision a runtime first.
          </p>
        )}

        {briefResult && (
          <pre className="mt-4 bg-gray-50 rounded-md p-4 text-xs overflow-auto max-h-96">
            {typeof briefResult === "string"
              ? briefResult
              : JSON.stringify(briefResult, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: "bg-green-100 text-green-700",
    provisioning: "bg-yellow-100 text-yellow-700",
    error: "bg-red-100 text-red-700",
    pending: "bg-gray-100 text-gray-600",
    stopped: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`text-xs px-2 py-1 rounded font-medium ${colors[status] || colors.pending}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
