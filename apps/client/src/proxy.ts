import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/proxy";

export async function proxy(request: NextRequest) {
  console.log("TEST");
  return await updateSession(request);
}

export const config = {
  matcher: ["/", "/sign-in"],
};
