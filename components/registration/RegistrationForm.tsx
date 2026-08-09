"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  AlertCircle,
  QrCode,
  Plus,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";

type EventOption = {
  id: string;
  name: string;
  slug: string;
  category: string;
  registration_type: string | null;
  min_team_size: number | null;
  max_team_size: number | null;

  payment_type: "free" | "paid" | null;
  registration_fee: number | null;
  payment_unit: "per_student" | "per_team" | null;
};

export default function RegistrationForm() {
  const searchParams = useSearchParams();
  const selectedEventParam = searchParams.get("event") ?? "";

  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(selectedEventParam);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [qrCode, setQrCode] = useState("");
type TeamMember = {
  name: string;
  email: string;
  phone: string;
};

const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

function addTeamMember() {
  if (!selectedEvent?.max_team_size) return;

  const currentTotal = 1 + teamMembers.length;

  if (currentTotal >= selectedEvent.max_team_size) return;

  setTeamMembers((members) => [
    ...members,
    {
      name: "",
      email: "",
      phone: "",
    },
  ]);
}

function removeTeamMember(index: number) {
  setTeamMembers((members) =>
    members.filter((_, memberIndex) => memberIndex !== index)
  );
}

function updateTeamMember(
  index: number,
  field: keyof TeamMember,
  value: string
) {
  setTeamMembers((members) =>
    members.map((member, memberIndex) =>
      memberIndex === index
        ? { ...member, [field]: value }
        : member
    )
  );
}
  useEffect(() => {
    async function loadEvents() {
      setEventsLoading(true);

      const { data, error } = await supabase
        .from("events")
        .select(`
  id,
  name,
  slug,
  category,
  registration_type,
  min_team_size,
  max_team_size,
  payment_type,
  registration_fee,
  payment_unit
`)
        .eq("active", true)
        .order("name", { ascending: true });

      if (error) {
        console.error("EVENT LIST ERROR:", error);
        setErrorMessage("We couldn't load the event list. Please refresh and try again.");
        setEventsLoading(false);
        return;
      }

      const loaded = (data ?? []) as EventOption[];
      setEventOptions(loaded);

      // Accept both the current UUID query parameter and older slug links.
      const match = loaded.find(
        (item) => item.id === selectedEventParam || item.slug === selectedEventParam
      );
      if (match) setSelectedEventId(match.id);

      setEventsLoading(false);
    }

    loadEvents();
  }, [selectedEventParam]);

  const selectedEvent = useMemo(
    () => eventOptions.find((item) => item.id === selectedEventId) ?? null,
    [eventOptions, selectedEventId]
  );

  const pricing = useMemo(() => {
  if (!selectedEvent) {
    return {
      price: 0,
      paymentUnit: "free" as const,
    };
  }

  if (selectedEvent.payment_type !== "paid") {
    return {
      price: 0,
      paymentUnit: "free" as const,
    };
  }

  return {
    price: Number(selectedEvent.registration_fee || 0),
    paymentUnit:
      selectedEvent.payment_unit === "per_team"
        ? ("per_team" as const)
        : ("per_student" as const),
  };
}, [selectedEvent]);

const isTeamEvent = selectedEvent?.registration_type === "team";
  const teamSize =
    selectedEvent?.min_team_size && selectedEvent?.max_team_size
      ? `${selectedEvent.min_team_size}–${selectedEvent.max_team_size} members`
      : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  setLoading(true);
  setErrorMessage("");

  const form = event.currentTarget;
  const formData = new FormData(form);

  const eventId = formData.get("event") as string;
  const name = (formData.get("name") as string).trim();
  const college = (formData.get("college") as string).trim();
  const email = (formData.get("email") as string).trim();
  const phone = (formData.get("phone") as string).trim();
  const team = (formData.get("team") as string).trim() || null;

  try {
    /*
     * TEAM VALIDATION
     *
     * Team leader counts as Member 1.
     */
    if (isTeamEvent) {
      const totalTeamSize = 1 + teamMembers.length;

      if (
        selectedEvent?.min_team_size &&
        totalTeamSize < selectedEvent.min_team_size
      ) {
        throw new Error(
          `This event requires at least ${selectedEvent.min_team_size} team members.`
        );
      }

      if (
        selectedEvent?.max_team_size &&
        totalTeamSize > selectedEvent.max_team_size
      ) {
        throw new Error(
          `This event allows a maximum of ${selectedEvent.max_team_size} team members.`
        );
      }

      /*
       * Make sure every added member is complete.
       */
      for (const member of teamMembers) {
        if (
          !member.name.trim() ||
          !member.email.trim() ||
          !member.phone.trim()
        ) {
          throw new Error(
            "Please complete the name, email and phone number for every team member."
          );
        }
      }

      /*
       * Prevent duplicate emails inside the same team.
       */
      const allEmails = [
        email,
        ...teamMembers.map((member) => member.email),
      ].map((item) => item.trim().toLowerCase());

      if (new Set(allEmails).size !== allEmails.length) {
        throw new Error(
          "Each team member must use a different email address."
        );
      }
    }

   /*
 /*
 * CREATE REGISTRATION + TEAM MEMBERS
 *
 * Use the PostgreSQL function so the whole registration
 * is created server-side as one transaction.
 */
const { data: id, error } = await supabase.rpc(
  "create_event_registration",
  {
    p_event_id: eventId,
    p_name: name,
    p_college: college,
    p_email: email,
    p_phone: phone,
    p_team: team,
    p_members: isTeamEvent
      ? teamMembers.map((member) => ({
          name: member.name.trim(),
          email: member.email.trim().toLowerCase(),
          phone: member.phone.trim(),
        }))
      : [],
  }
);

if (error) {
  console.error(
    "REGISTRATION RPC ERROR:",
    JSON.stringify(error, null, 2)
  );

  if (
    error.code === "23505" &&
    error.message?.includes("registrations_event_email_unique")
  ) {
    throw new Error(
      "This email is already registered for this event. Please use a different email."
    );
  }

  throw new Error(
    error.message || "Could not create registration."
  );
}

if (!id) {
  throw new Error("Registration ID was not returned.");
}

/*
 * GENERATE QR CODE
 */
const generatedQr = await QRCode.toDataURL(id, {
  width: 500,
  margin: 2,
  errorCorrectionLevel: "H",
});

/*
 * SHOW CONFIRMATION SCREEN
 */
setRegistrationId(id);
setQrCode(generatedQr);
setSubmitted(true);

form.reset();
setTeamMembers([]);
  } catch (error) {
    console.error("Registration error:", error);

    setErrorMessage(
      error instanceof Error
        ? error.message
        : "We couldn't complete your registration. Please try again."
    );
  } finally {
    setLoading(false);
  }
}

  if (submitted) {
    return (
      <section className="px-6 pb-32 md:px-10 md:pb-44">
        <div className="mx-auto max-w-[1200px]">

          <div className="flex min-h-[650px] flex-col items-center justify-center rounded-[32px] bg-black px-6 py-16 text-center text-white">

            <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-full bg-white text-black">
              <Check size={22} />
            </div>

            <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
              Registration confirmed
            </p>

            <h2 className="max-w-[800px] text-[clamp(3rem,7vw,7rem)] font-semibold leading-[0.88] tracking-[-0.065em]">
              You&apos;re in.
            </h2>

            <p className="mt-7 max-w-md text-sm leading-6 text-white/45 md:text-base">
              Your registration for Saviskar has been successfully received.
            </p>

            {/* QR CODE */}

            {qrCode && (
              <div className="mt-10">

                <div className="rounded-[28px] bg-white p-5 shadow-2xl">

                  <img
                    src={qrCode}
                    alt="Registration QR Code"
                    className="h-[210px] w-[210px] md:h-[240px] md:w-[240px]"
                  />

                </div>

                <div className="mt-5 flex items-center justify-center gap-2 text-white/40">

                  <QrCode size={14} />

                  <p className="text-[10px] uppercase tracking-[0.2em]">
                    Entry QR Code
                  </p>

                </div>

              </div>
            )}

            {/* REGISTRATION ID */}

            {registrationId && (
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.05] px-6 py-4">

                <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-white/35">
                  Registration ID
                </p>

                <p className="break-all font-mono text-xs text-white/80 md:text-sm">
                  {registrationId}
                </p>

              </div>
            )}

            <p className="mt-6 max-w-sm text-xs leading-5 text-white/35">
              Keep this QR code available on your phone. It can be used to
              verify your registration at the event.
            </p>

            <button
              onClick={() => {
                setSubmitted(false);
                setRegistrationId("");
                setQrCode("");
                setErrorMessage("");
              }}
              className="mt-10 rounded-full border border-white/20 px-6 py-3 text-sm transition hover:bg-white hover:text-black"
            >
              Register another participant
            </button>

          </div>

        </div>
      </section>
    );
  }

  return (
    <section className="px-6 pb-32 md:px-10 md:pb-44">
      <div className="mx-auto max-w-[1200px]">

        <div className="rounded-[32px] bg-white p-6 shadow-[0_30px_100px_rgba(0,0,0,0.06)] md:p-12 lg:p-16">

          <div className="mb-14 border-b border-black/10 pb-10">

            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
              Registration form
            </p>

            <h2 className="text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
              Tell us about yourself.
            </h2>

          </div>

          <form onSubmit={handleSubmit} className="space-y-10">

            <Field label="Event">

              <select
                name="event"
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                required
                disabled={eventsLoading}
                className="w-full appearance-none border-b border-black/15 bg-transparent py-4 text-lg outline-none transition focus:border-black"
              >

                <option value="" disabled>
                  Select an event
                </option>

                {eventOptions.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}

              </select>

            </Field>

            {selectedEvent && (
              <div className="rounded-2xl border border-black/10 bg-black/[0.025] p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/35">
                      Registration fee
                    </p>
                   <p className="mt-2 text-2xl font-semibold tracking-tight">
  {pricing.price > 0
    ? `₹${pricing.price.toLocaleString("en-IN")} ${
        pricing.paymentUnit === "per_team"
          ? "per team"
          : "per student"
      }`
    : "Free"}
</p>
                  </div>
                  {isTeamEvent && teamSize && (
                    <p className="text-sm text-black/45">Team size: {teamSize}</p>
                  )}
                </div>
                
              </div>
            )}

            <div className="grid gap-10 md:grid-cols-2">

              <Field label="Full name">

                <input
                  type="text"
                  name="name"
                  placeholder="Your name"
                  required
                  minLength={2}
                  className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                />

              </Field>

              <Field label="College / University">

                <input
                  type="text"
                  name="college"
                  placeholder="Your institution"
                  required
                  minLength={2}
                  className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                />

              </Field>

            </div>

            <div className="grid gap-10 md:grid-cols-2">

              <Field label="Email">

                <input
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                />

              </Field>

              <Field label="Phone">

                <input
                  type="tel"
                  name="phone"
                  placeholder="+91 98765 43210"
                  required
                  pattern="[0-9+\-\s]{10,18}"
                  className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                />

              </Field>

            </div>

            <Field label={isTeamEvent ? "Team name" : "Team name — optional"}>

              <input
                type="text"
                name="team"
                placeholder="Enter your team name"
                required={Boolean(isTeamEvent)}
                className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
              />

            </Field>
{isTeamEvent && selectedEvent?.max_team_size && (
  <div className="space-y-8 border-t border-black/10 pt-10">

    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
          Team members
        </p>

        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
          Add your teammates.
        </h3>

        <p className="mt-2 text-sm text-black/40">
          The team leader is already counted as Member 1.
        </p>
      </div>

      <p className="shrink-0 text-sm text-black/40">
        {teamMembers.length + 1} / {selectedEvent.max_team_size}
      </p>
    </div>

    {teamMembers.map((member, index) => (
      <div
        key={index}
        className="rounded-[24px] border border-black/10 p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/35">
              Team member
            </p>

            <h4 className="mt-1 text-xl font-semibold">
              Member {index + 2}
            </h4>
          </div>

          <button
            type="button"
            onClick={() => removeTeamMember(index)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-red-200 text-red-500 transition hover:bg-red-50"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="grid gap-8 md:grid-cols-3">

          <Field label="Full name">
            <input
              type="text"
              value={member.name}
              onChange={(e) =>
                updateTeamMember(index, "name", e.target.value)
              }
              placeholder="Member name"
              required
              className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={member.email}
              onChange={(e) =>
                updateTeamMember(index, "email", e.target.value)
              }
              placeholder="member@example.com"
              required
              className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
            />
          </Field>

          <Field label="Phone">
            <input
              type="tel"
              value={member.phone}
              onChange={(e) =>
                updateTeamMember(index, "phone", e.target.value)
              }
              placeholder="+91 98765 43210"
              required
              className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
            />
          </Field>

        </div>
      </div>
    ))}

    {teamMembers.length + 1 < selectedEvent.max_team_size && (
      <button
        type="button"
        onClick={addTeamMember}
        className="flex items-center gap-2 rounded-full border border-black/15 px-5 py-3 text-sm font-medium transition hover:bg-black hover:text-white"
      >
        <Plus size={16} />
        Add team member
      </button>
    )}

  </div>
)}
            <label className="flex cursor-pointer items-start gap-3 border-t border-black/10 pt-8">

              <input
                type="checkbox"
                name="agreement"
                required
                className="mt-1 h-4 w-4 accent-black"
              />

              <span className="max-w-2xl text-sm leading-6 text-black/45">
                I confirm that the information provided above is correct and I
                agree to follow the official Saviskar event rules.
              </span>

            </label>

            {errorMessage && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700">

                <AlertCircle size={18} />

                {errorMessage}

              </div>
            )}

            <div className="flex justify-end pt-3">

              <button
                type="submit"
                disabled={loading}
                className="group flex min-w-[190px] items-center justify-center gap-3 rounded-full bg-black px-7 py-4 text-sm font-medium text-white transition-all hover:scale-[1.02] disabled:cursor-wait disabled:opacity-50"
              >

                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />

                    Registering
                  </>
                ) : (
                  <>
                    {pricing.price > 0 ? "Continue registration" : "Complete registration"}

                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </>
                )}

              </button>

            </div>

          </form>

        </div>

      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">

      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/40">
        {label}
      </span>

      {children}

    </label>
  );
}