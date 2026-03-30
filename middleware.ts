import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const PROTECTED = ["/dashboard", "/generate", "/history", "/profile"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PROTECTED.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get("__session")?.value;
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  try {
    await adminAuth.verifySessionCookie(sessionCookie, true);
    return NextResponse.next();
  } catch {
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set("__session", "", { maxAge: 0, path: "/" });
    return res;
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/generate/:path*", "/history/:path*", "/profile/:path*"],
};
