import { redirect } from "next/navigation";

export default function AdminInviteRedirect() {
  redirect("/admin/reset-password");
}