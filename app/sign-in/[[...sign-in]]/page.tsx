import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="h-full flex items-center justify-center">
      <SignIn />
    </div>
  );
}
