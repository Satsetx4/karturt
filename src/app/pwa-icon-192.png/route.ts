import { createPwaIcon } from "@/lib/pwa/icon";

export const runtime = "nodejs";
export function GET() { return createPwaIcon(192); }
