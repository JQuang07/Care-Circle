import { NextResponse } from "next/server";
import { listScenarios } from "@/lib/clips";

export const dynamic = "force-dynamic";
export const GET = () => NextResponse.json({ scenarios: listScenarios() });
