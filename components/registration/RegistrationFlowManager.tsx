"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import RegistrationAuthGate from "./RegistrationAuthGate";
import RegistrationForm from "./RegistrationForm";

interface RegistrationFlowManagerProps {
  initialAuthenticated: boolean;
  initialEmail?: string;
  isAccommodationLocked?: boolean;
  isRegistrationLocked?: boolean;
}

export default function RegistrationFlowManager({
  initialAuthenticated,
  initialEmail = "",
  isAccommodationLocked = false,
  isRegistrationLocked = false,
}: RegistrationFlowManagerProps) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(initialAuthenticated);
  const [verifiedEmail, setVerifiedEmail] = useState(initialEmail);

  const handleAuthenticated = (email: string) => {
    setVerifiedEmail(email);
    setIsAuthenticated(true);
    // Refresh server state to recognize the newly set session cookie
    router.refresh();
  };

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch (err) {
      console.error("Sign out failed:", err);
    }
    setVerifiedEmail("");
    setIsAuthenticated(false);
    router.refresh();
  };

  if (!isAuthenticated) {
    return (
      <RegistrationAuthGate
        initialEmail={verifiedEmail}
        onAuthenticated={handleAuthenticated}
        isRegistrationLocked={isRegistrationLocked}
      />
    );
  }

  return (
    <RegistrationForm
      sessionEmail={verifiedEmail}
      onSignOut={handleSignOut}
      isAccommodationLocked={isAccommodationLocked}
      isRegistrationLocked={isRegistrationLocked}
    />
  );
}
