import type { Metadata } from "next";
import Link from "next/link";

import { FindBookingForm } from "@/components/booking/find-booking-form";

export const metadata: Metadata = {
  title: "Find my booking",
  description: "Lost your ticket? We’ll text it to the phone number on your booking.",
};

export default function FindBookingPage() {
  return (
    <div className="container-page flex flex-1 justify-center py-10 sm:py-16">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Find my booking</h1>
          <p className="text-muted-foreground">
            Lost your ticket text? Enter your booking reference and the mobile number on the booking,
            and we’ll send the ticket again.
          </p>
        </div>
        <FindBookingForm />
        <p className="text-center text-sm text-muted-foreground">
          Booked with your phone or email?{" "}
          <Link href="/login?next=/account" className="font-semibold text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>{" "}
          to see all your trips.
        </p>
      </div>
    </div>
  );
}
