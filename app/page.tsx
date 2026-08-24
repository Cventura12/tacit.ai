import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Surface } from "@/components/Surface";

export default async function Home() {
  const { userId } = await auth();

  // Proxy already blocks unauthenticated users, but check again defensively.
  if (!userId) redirect("/sign-in");

  // Owner-only: being signed in via Clerk is not enough — must be my account.
  const ownerId = process.env.OWNER_CLERK_USER_ID;
  if (!ownerId || userId !== ownerId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-6">
          <p className="text-[15px] font-medium text-ink mb-1">Access denied</p>
          <p className="text-[13px] text-gray-2">This application is private.</p>
        </div>
      </div>
    );
  }

  return <Surface />;
}
