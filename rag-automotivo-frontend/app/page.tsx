import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardClient } from "./dashboard-client";

export default async function Home() {
  const cookieStore = await cookies();
  const hasAccessToken = cookieStore.has("accessToken");
  const hasRefreshToken = cookieStore.has("refreshToken");

  if (!hasAccessToken && !hasRefreshToken) {
    redirect("/signin");
  }

  return <DashboardClient />;
}
