import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      return NextResponse.json(
        { error: "Missing STRIPE_SECRET_KEY" },
        { status: 500 }
      );
    }

    const stripe = new Stripe(secretKey);

    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const customers = await stripe.customers.list({
      email,
      limit: 10,
    });

    if (!customers.data.length) {
      return NextResponse.json({ active: false });
    }

    for (const customer of customers.data) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: "all",
        limit: 20,
      });

      const hasActive = subscriptions.data.some((sub) =>
  ["active", "trialing"].includes(sub.status)
);

      if (hasActive) {
        return NextResponse.json({ active: true });
      }
    }

    return NextResponse.json({ active: false });
  } catch (error) {
    console.error("Restore Pro error:", error);
    return NextResponse.json(
      { error: "Unable to restore Pro" },
      { status: 500 }
    );
  }
}