"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="bg-white rounded-lg border p-8 max-w-sm w-full text-center">
        <h2 className="text-2xl font-bold mb-2">Sign In</h2>
        <p className="text-gray-500 text-sm mb-6">
          Sign in to manage your ClawdBot tenants.
        </p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
