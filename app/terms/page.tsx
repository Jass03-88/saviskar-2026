import type { Metadata } from "next";
import TermsViewerPage from "./TermsViewerPage";

export const metadata: Metadata = {
  title: "Official Terms & Conditions | Saviskar 2K26",
  description:
    "Official Terms and Conditions, Rules, Regulations, and Participant Code of Conduct for Saviskar 2026: Aevorian Reverie at CGC University, Mohali.",
};

export default function TermsPage() {
  return <TermsViewerPage />;
}
