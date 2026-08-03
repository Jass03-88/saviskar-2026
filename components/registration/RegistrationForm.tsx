"use client";

import {
  FormEvent,
  ReactNode,
  useEffect,
  useState,
} from "react";

import { useSearchParams } from "next/navigation";

import {
  ArrowRight,
  Check,
  AlertCircle,
  QrCode,
  Plus,
  Trash2,
  Users,
  Download,
  Ticket,
} from "lucide-react";

import QRCode from "qrcode";

import { supabase } from "@/lib/supabase";

type EventData = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  registration_type: string;
  min_team_size: number | null;
  max_team_size: number | null;
  registration_open: boolean;
  active: boolean;
};

type TeamMember = {
  name: string;
  email: string;
  phone: string;
};

type SubmittedRegistration = {
  eventName: string;
  eventCategory: string | null;
  name: string;
  college: string;
  email: string;
  phone: string;
  team: string | null;
  isTeamEvent: boolean;
  members: TeamMember[];
};

export default function RegistrationForm() {
  const searchParams = useSearchParams();

  const urlEventId = searchParams.get("event") ?? "";

  const [events, setEvents] = useState<EventData[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // Keep selected event in state so changing dropdown
  // immediately changes Individual / Team fields.
  const [selectedEventId, setSelectedEventId] =
    useState(urlEventId);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(
    []
  );

  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [registrationId, setRegistrationId] =
    useState("");

  const [qrCode, setQrCode] = useState("");

  const [submittedRegistration, setSubmittedRegistration] =
    useState<SubmittedRegistration | null>(null);

  /*
   * LOAD EVENTS
   */
  useEffect(() => {
    async function loadEvents() {
      setEventsLoading(true);

      try {
        const { data, error } = await supabase
          .from("events")
          .select(`
            id,
            slug,
            name,
            category,
            registration_type,
            min_team_size,
            max_team_size,
            registration_open,
            active
          `)
          .eq("active", true)
          .order("name", { ascending: true });

        if (error) {
          throw error;
        }

        setEvents((data ?? []) as EventData[]);
      } catch (error) {
        console.error("Error loading events:", error);

        setErrorMessage(
          "We couldn't load the event list. Please refresh the page."
        );
      } finally {
        setEventsLoading(false);
      }
    }

    loadEvents();
  }, []);

  /*
   * CURRENT EVENT
   */
  const currentSelectedEvent = events.find(
    (item) => item.id === selectedEventId
  );

  const isTeamEvent =
    currentSelectedEvent?.registration_type
      ?.toLowerCase()
      .trim() === "team";

  /*
   * TEAM SIZE
   *
   * min_team_size / max_team_size represent TOTAL
   * participants including the team leader.
   */
  const minTeamSize =
    currentSelectedEvent?.min_team_size ?? 1;

  const maxTeamSize =
    currentSelectedEvent?.max_team_size ?? 1;

  const minimumExtraMembers = Math.max(
    0,
    minTeamSize - 1
  );

  const maximumExtraMembers = Math.max(
    0,
    maxTeamSize - 1
  );

  /*
   * INITIALISE TEAM MEMBER FIELDS WHEN EVENT CHANGES
   */
  useEffect(() => {
    if (!currentSelectedEvent) {
      setTeamMembers([]);
      return;
    }

    const teamEvent =
      currentSelectedEvent.registration_type
        ?.toLowerCase()
        .trim() === "team";

    if (!teamEvent) {
      setTeamMembers([]);
      return;
    }

    const minimumMembers = Math.max(
      0,
      (currentSelectedEvent.min_team_size ?? 1) - 1
    );

    setTeamMembers(
      Array.from(
        { length: minimumMembers },
        () => ({
          name: "",
          email: "",
          phone: "",
        })
      )
    );
  }, [selectedEventId, currentSelectedEvent]);

  /*
   * ADD TEAM MEMBER
   */
  function addTeamMember() {
    if (teamMembers.length >= maximumExtraMembers) {
      return;
    }

    setTeamMembers((previous) => [
      ...previous,
      {
        name: "",
        email: "",
        phone: "",
      },
    ]);
  }

  /*
   * REMOVE TEAM MEMBER
   */
  function removeTeamMember(index: number) {
    if (teamMembers.length <= minimumExtraMembers) {
      return;
    }

    setTeamMembers((previous) =>
      previous.filter((_, i) => i !== index)
    );
  }

  /*
   * UPDATE TEAM MEMBER
   */
  function updateTeamMember(
    index: number,
    field: keyof TeamMember,
    value: string
  ) {
    setTeamMembers((previous) =>
      previous.map((member, i) =>
        i === index
          ? {
              ...member,
              [field]: value,
            }
          : member
      )
    );
  }

  /*
   * SUBMIT REGISTRATION
   */
  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);

    const eventId = formData.get("event") as string;

    if (!eventId) {
      setErrorMessage(
        "Please select an event before registering."
      );

      setLoading(false);
      return;
    }

    const selectedEvent = events.find(
      (item) => item.id === eventId
    );

    if (!selectedEvent) {
      setErrorMessage("Selected event was not found.");

      setLoading(false);
      return;
    }

    if (!selectedEvent.registration_open) {
      setErrorMessage(
        "Registration for this event is currently closed."
      );

      setLoading(false);
      return;
    }

    const teamEvent =
      selectedEvent.registration_type
        ?.toLowerCase()
        .trim() === "team";

    /*
     * VALIDATE TEAM
     */
    if (teamEvent) {
      const min =
        selectedEvent.min_team_size ?? 1;

      const max =
        selectedEvent.max_team_size ?? min;

      const totalParticipants =
        teamMembers.length + 1;

      if (totalParticipants < min) {
        setErrorMessage(
          `This event requires at least ${min} team members including the team leader.`
        );

        setLoading(false);
        return;
      }

      if (totalParticipants > max) {
        setErrorMessage(
          `This event allows a maximum of ${max} team members including the team leader.`
        );

        setLoading(false);
        return;
      }

      for (let i = 0; i < teamMembers.length; i++) {
        const member = teamMembers[i];

        if (
          !member.name.trim() ||
          !member.email.trim() ||
          !member.phone.trim()
        ) {
          setErrorMessage(
            `Please complete all details for Team Member ${
              i + 2
            }.`
          );

          setLoading(false);
          return;
        }
      }
    }

    /*
     * MAIN REGISTRATION
     */
    const registration = {
      event_id: eventId,

      name: (
        formData.get("name") as string
      ).trim(),

      college: (
        formData.get("college") as string
      ).trim(),

      email: (
        formData.get("email") as string
      ).trim(),

      phone: (
        formData.get("phone") as string
      ).trim(),

      team: teamEvent
        ? (
            formData.get("team") as string
          ).trim() || null
        : null,

      created_at: new Date().toISOString(),
    };

    try {
      /*
       * CREATE REGISTRATION THROUGH THE SERVER
       *
       * The browser no longer writes directly to registrations or
       * registration_members. The API validates the event/team rules and
       * performs the database writes with the server-only Supabase key.
       */
      const registrationResponse = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId,
          name: registration.name,
          college: registration.college,
          email: registration.email,
          phone: registration.phone,
          team: registration.team,
          members: teamEvent
            ? teamMembers.map((member) => ({
                name: member.name.trim(),
                email: member.email.trim(),
                phone: member.phone.trim(),
              }))
            : [],
        }),
      });

      const registrationResult = await registrationResponse
        .json()
        .catch(() => null);

      if (!registrationResponse.ok) {
        throw new Error(
          registrationResult?.error ||
            "We couldn't complete your registration."
        );
      }

      const id =
        typeof registrationResult?.registrationId === "string"
          ? registrationResult.registrationId
          : "";

      if (!id) {
        throw new Error(
          "Registration ID was not returned."
        );
      }

      setRegistrationId(id);

      /*
       * GENERATE ONE QR FOR THE REGISTRATION / TEAM
       */
      const generatedQr =
        await QRCode.toDataURL(id, {
          width: 500,
          margin: 2,
          errorCorrectionLevel: "H",
        });

      setQrCode(generatedQr);
      /*
 * SEND CONFIRMATION EMAIL
 *
 * Email failure must NOT cancel a successful registration.
 */
try {
  const emailResponse = await fetch("/api/registration-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      registrationId: id,
    }),
  });

  if (!emailResponse.ok) {
    const emailError = await emailResponse
      .json()
      .catch(() => null);

    // Registration has already succeeded at this point.
    // Do not trigger the Next.js development error overlay for an email-only failure.
    console.log(
      "Confirmation email failed:",
      emailError
    );
  } else {
    console.log(
      "Saviskar confirmation email sent."
    );
  }
} catch (emailError) {
  // Email delivery is non-critical: the database registration remains valid.
  console.log(
    "Confirmation email request failed:",
    emailError
  );
}
      setSubmittedRegistration({
        eventName: selectedEvent.name,
        eventCategory: selectedEvent.category,
        name: registration.name,
        college: registration.college,
        email: registration.email,
        phone: registration.phone,
        team: registration.team,
        isTeamEvent: teamEvent,
        members: teamMembers.map((member) => ({ ...member })),
      });

      setSubmitted(true);

      form.reset();

      setTeamMembers([]);
    } catch (error) {
      console.error(
        "Registration error:",
        error
      );

      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't complete your registration. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * DOWNLOAD QR
   */
  function downloadQrCode() {
    if (!qrCode || !registrationId) return;

    const link = document.createElement("a");
    link.href = qrCode;
    link.download = `saviskar-${registrationId}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /*
   * DOWNLOAD ENTRY PASS
   *
   * Generates a self-contained PNG ticket in the browser.
   */
  async function downloadEntryPass() {
    if (!qrCode || !registrationId || !submittedRegistration) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = submittedRegistration.isTeamEvent ? 1750 : 1550;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#050505";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "#ffffff";
    context.font = "600 42px Arial, sans-serif";
    context.fillText("SAVISKAR 2026", 90, 110);

    context.fillStyle = "rgba(255,255,255,0.45)";
    context.font = "500 22px Arial, sans-serif";
    context.fillText("OFFICIAL ENTRY PASS", 90, 155);

    context.fillStyle = "#ffffff";
    context.font = "700 76px Arial, sans-serif";
    context.fillText(submittedRegistration.eventName, 90, 280);

    context.fillStyle = "rgba(255,255,255,0.45)";
    context.font = "500 22px Arial, sans-serif";
    context.fillText(
      submittedRegistration.isTeamEvent ? "TEAM / PARTICIPANT" : "PARTICIPANT",
      90,
      365
    );

    context.fillStyle = "#ffffff";
    context.font = "600 46px Arial, sans-serif";
    context.fillText(
      submittedRegistration.team || submittedRegistration.name,
      90,
      425
    );

    if (submittedRegistration.team) {
      context.fillStyle = "rgba(255,255,255,0.55)";
      context.font = "400 26px Arial, sans-serif";
      context.fillText(`Team Leader: ${submittedRegistration.name}`, 90, 475);
    }

    context.fillStyle = "rgba(255,255,255,0.45)";
    context.font = "500 20px Arial, sans-serif";
    context.fillText("COLLEGE / UNIVERSITY", 90, 555);

    context.fillStyle = "#ffffff";
    context.font = "500 30px Arial, sans-serif";
    context.fillText(submittedRegistration.college, 90, 605);

    const qrImage = new Image();
    qrImage.src = qrCode;

    await new Promise<void>((resolve, reject) => {
      qrImage.onload = () => resolve();
      qrImage.onerror = () => reject(new Error("Could not load QR image."));
    });

    const qrSize = 500;
    const qrX = (canvas.width - qrSize) / 2;
    const qrY = 690;

    context.fillStyle = "#ffffff";
    context.fillRect(qrX - 30, qrY - 30, qrSize + 60, qrSize + 60);
    context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

    context.fillStyle = "rgba(255,255,255,0.55)";
    context.font = "500 20px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("PRESENT THIS QR CODE AT ENTRY", canvas.width / 2, 1270);

    context.fillStyle = "rgba(255,255,255,0.35)";
    context.font = "400 18px monospace";
    context.fillText(registrationId, canvas.width / 2, 1320);

    if (
      submittedRegistration.isTeamEvent &&
      submittedRegistration.members.length > 0
    ) {
      context.textAlign = "left";
      context.fillStyle = "rgba(255,255,255,0.45)";
      context.font = "500 20px Arial, sans-serif";
      context.fillText("TEAM MEMBERS", 90, 1410);

      context.fillStyle = "#ffffff";
      context.font = "500 25px Arial, sans-serif";

      submittedRegistration.members.slice(0, 8).forEach((member, index) => {
        context.fillText(
          `${index + 2}. ${member.name}`,
          90,
          1460 + index * 42
        );
      });
    }

    context.textAlign = "left";
    context.fillStyle = "rgba(255,255,255,0.3)";
    context.font = "400 18px Arial, sans-serif";
    context.fillText(
      "Keep this pass available on your phone for event verification.",
      90,
      canvas.height - 70
    );

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `saviskar-entry-pass-${registrationId}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /*
   * SUCCESS SCREEN
   */
  if (submitted && submittedRegistration) {
    return (
      <section className="px-6 pb-32 md:px-10 md:pb-44">
        <div className="mx-auto max-w-[1200px]">
          <div className="overflow-hidden rounded-[32px] bg-black text-white">
            <div className="grid lg:grid-cols-[1.05fr_0.95fr]">

              {/* PASS DETAILS */}
              <div className="flex flex-col justify-between p-7 md:p-12 lg:p-14">
                <div>
                  <div className="mb-10 flex items-center justify-between gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black">
                      <Check size={22} />
                    </div>

                    <div className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                      <Ticket size={13} />
                      Entry Pass
                    </div>
                  </div>

                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">
                    Registration confirmed
                  </p>

                  <h2 className="mt-4 text-[clamp(3rem,7vw,6.5rem)] font-semibold leading-[0.88] tracking-[-0.065em]">
                    You&apos;re in.
                  </h2>

                  <p className="mt-7 max-w-md text-sm leading-6 text-white/45 md:text-base">
                    Your Saviskar 2026 registration is confirmed. Keep this pass
                    available on your phone and present the QR code at entry.
                  </p>

                  <div className="mt-10 border-t border-white/10 pt-8">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/30">
                      Event
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
                      {submittedRegistration.eventName}
                    </p>

                    {submittedRegistration.eventCategory && (
                      <p className="mt-2 text-sm capitalize text-white/35">
                        {submittedRegistration.eventCategory} event
                      </p>
                    )}
                  </div>

                  <div className="mt-8 grid gap-6 sm:grid-cols-2">
                    <PassDetail
                      label={
                        submittedRegistration.isTeamEvent
                          ? "Team leader"
                          : "Participant"
                      }
                      value={submittedRegistration.name}
                    />

                    {submittedRegistration.team && (
                      <PassDetail
                        label="Team"
                        value={submittedRegistration.team}
                      />
                    )}

                    <PassDetail
                      label="College / University"
                      value={submittedRegistration.college}
                    />

                    <PassDetail
                      label="Email"
                      value={submittedRegistration.email}
                    />
                  </div>

                  {submittedRegistration.isTeamEvent &&
                    submittedRegistration.members.length > 0 && (
                      <div className="mt-8 border-t border-white/10 pt-7">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/30">
                          Team members
                        </p>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {submittedRegistration.members.map((member, index) => (
                            <div
                              key={`${member.email}-${index}`}
                              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
                            >
                              <p className="text-[9px] uppercase tracking-[0.16em] text-white/25">
                                Member {index + 2}
                              </p>
                              <p className="mt-1 text-sm text-white/80">
                                {member.name}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>

                <div className="mt-10">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/30">
                    Registration ID
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-white/55">
                    {registrationId}
                  </p>
                </div>
              </div>

              {/* QR TICKET */}
              <div className="flex flex-col items-center justify-center border-t border-white/10 bg-white/[0.04] p-7 text-center lg:border-l lg:border-t-0 md:p-12">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                  Saviskar 2026
                </p>

                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                  Entry QR
                </h3>

                {qrCode && (
                  <div className="mt-8 rounded-[30px] bg-white p-5 shadow-2xl">
                    <img
                      src={qrCode}
                      alt="Saviskar registration entry QR code"
                      className="h-[230px] w-[230px] md:h-[280px] md:w-[280px]"
                    />
                  </div>
                )}

                <div className="mt-6 flex items-center gap-2 text-white/40">
                  <QrCode size={14} />
                  <p className="text-[10px] uppercase tracking-[0.2em]">
                    Present at entry
                  </p>
                </div>

                <p className="mt-4 max-w-xs text-xs leading-5 text-white/35">
                  This QR is linked to your registration. For team events, one
                  QR represents the complete team.
                </p>

                <div className="mt-8 grid w-full max-w-sm gap-3">
                  <button
                    type="button"
                    onClick={downloadEntryPass}
                    className="flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-medium text-black transition hover:scale-[1.01]"
                  >
                    <Download size={15} />
                    Download Entry Pass
                  </button>

                  <button
                    type="button"
                    onClick={downloadQrCode}
                    className="flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3.5 text-sm text-white/75 transition hover:bg-white hover:text-black"
                  >
                    <QrCode size={15} />
                    Download QR Only
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setRegistrationId("");
                    setQrCode("");
                    setSubmittedRegistration(null);
                    setErrorMessage("");
                  }}
                  className="mt-6 text-xs text-white/35 underline decoration-white/20 underline-offset-4 transition hover:text-white"
                >
                  Register another participant
                </button>
              </div>

            </div>
          </div>
        </div>
      </section>
    );
  }

  /*
   * REGISTRATION FORM
   */
  return (
    <section className="px-6 pb-32 md:px-10 md:pb-44">

      <div className="mx-auto max-w-[1200px]">

        <div className="rounded-[32px] bg-white p-6 shadow-[0_30px_100px_rgba(0,0,0,0.06)] md:p-12 lg:p-16">

          {/* HEADER */}

          <div className="mb-14 border-b border-black/10 pb-10">

            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
              Registration form
            </p>

            <h2 className="text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
              {isTeamEvent
                ? "Register your team."
                : "Tell us about yourself."}
            </h2>

          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-10"
          >

            {/* EVENT */}

            <Field label="Event">

              {eventsLoading ? (

                <div className="border-b border-black/15 py-4 text-lg text-black/70">
                  Loading events...
                </div>

              ) : (

                <select
                  name="event"
                  value={selectedEventId}
                  onChange={(event) => {
                    setSelectedEventId(
                      event.target.value
                    );

                    setErrorMessage("");
                  }}
                  required
                  className="w-full appearance-none border-b border-black/15 bg-transparent py-4 text-lg outline-none transition focus:border-black"
                >

                  <option value="" disabled>
                    Select an event
                  </option>

                  {events.map((event) => (

                    <option
                      key={event.id}
                      value={event.id}
                      disabled={
                        !event.registration_open
                      }
                    >
                      {event.name}
                      {!event.registration_open
                        ? " — Registration closed"
                        : ""}
                    </option>

                  ))}

                </select>

              )}

            </Field>

            {/* EVENT INFORMATION */}

            {currentSelectedEvent && (
              <div className="rounded-2xl bg-black/[0.035] px-5 py-4">

                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/35">
                  Registering for
                </p>

                <p className="mt-2 text-lg font-medium">
                  {currentSelectedEvent.name}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-3">

                  {currentSelectedEvent.category && (
                    <span className="text-sm capitalize text-black/40">
                      {currentSelectedEvent.category} Event
                    </span>
                  )}

                  <span className="rounded-full bg-black px-3 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-white">
                    {isTeamEvent
                      ? "Team"
                      : "Individual"}
                  </span>

                </div>

                {isTeamEvent && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-black/45">
                    <Users size={15} />

                    Team size: {minTeamSize}
                    {maxTeamSize !== minTeamSize
                      ? `–${maxTeamSize}`
                      : ""}{" "}
                    members
                  </div>
                )}

              </div>
            )}

            {/* LEADER / PARTICIPANT */}

            {isTeamEvent && (
              <div className="border-b border-black/10 pb-3">

                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                  Team leader
                </p>

                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                  Leader details
                </h3>

              </div>
            )}

            {/* NAME + COLLEGE */}

            <div className="grid gap-10 md:grid-cols-2">

              <Field
                label={
                  isTeamEvent
                    ? "Team leader name"
                    : "Full name"
                }
              >

                <input
                  type="text"
                  name="name"
                  placeholder={
                    isTeamEvent
                      ? "Leader's full name"
                      : "Your name"
                  }
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

            {/* EMAIL + PHONE */}

            <div className="grid gap-10 md:grid-cols-2">

              <Field
                label={
                  isTeamEvent
                    ? "Team leader email"
                    : "Email"
                }
              >

                <input
                  type="email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                />

              </Field>

              <Field
                label={
                  isTeamEvent
                    ? "Team leader phone"
                    : "Phone"
                }
              >

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

            {/* TEAM REGISTRATION */}

            {isTeamEvent && (
              <div className="space-y-10">

                {/* TEAM NAME */}

                <Field label="Team name">

                  <input
                    type="text"
                    name="team"
                    placeholder="Enter your team name"
                    required
                    minLength={2}
                    className="w-full border-b border-black/15 bg-transparent py-4 text-lg outline-none transition placeholder:text-black/25 focus:border-black"
                  />

                </Field>

                {/* MEMBERS HEADER */}

                <div className="flex flex-col gap-4 border-t border-black/10 pt-8 sm:flex-row sm:items-end sm:justify-between">

                  <div>

                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-black/35">
                      Team members
                    </p>

                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                      Add your teammates.
                    </h3>

                    <p className="mt-2 text-sm text-black/40">
                      The team leader is already counted
                      as Member 1.
                    </p>

                  </div>

                  <div className="text-sm text-black/40">
                    {teamMembers.length + 1} /{" "}
                    {maxTeamSize} members
                  </div>

                </div>

                {/* MEMBER CARDS */}

                {teamMembers.map(
                  (member, index) => (

                    <div
                      key={index}
                      className="rounded-[24px] border border-black/10 p-5 md:p-7"
                    >

                      <div className="mb-7 flex items-center justify-between">

                        <div>

                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-black/35">
                            Team member
                          </p>

                          <h4 className="mt-1 text-xl font-semibold">
                            Member {index + 2}
                          </h4>

                        </div>

                        {teamMembers.length >
                          minimumExtraMembers && (
                          <button
                            type="button"
                            onClick={() =>
                              removeTeamMember(index)
                            }
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-red-200 text-red-500 transition hover:bg-red-50"
                            aria-label={`Remove member ${
                              index + 2
                            }`}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}

                      </div>

                      <div className="grid gap-8 md:grid-cols-3">

                        <Field label="Full name">

                          <input
                            type="text"
                            value={member.name}
                            onChange={(event) =>
                              updateTeamMember(
                                index,
                                "name",
                                event.target.value
                              )
                            }
                            placeholder="Member name"
                            required
                            minLength={2}
                            className="w-full border-b border-black/15 bg-transparent py-4 text-base outline-none transition placeholder:text-black/25 focus:border-black"
                          />

                        </Field>

                        <Field label="Email">

                          <input
                            type="email"
                            value={member.email}
                            onChange={(event) =>
                              updateTeamMember(
                                index,
                                "email",
                                event.target.value
                              )
                            }
                            placeholder="Email address"
                            required
                            className="w-full border-b border-black/15 bg-transparent py-4 text-base outline-none transition placeholder:text-black/25 focus:border-black"
                          />

                        </Field>

                        <Field label="Phone">

                          <input
                            type="tel"
                            value={member.phone}
                            onChange={(event) =>
                              updateTeamMember(
                                index,
                                "phone",
                                event.target.value
                              )
                            }
                            placeholder="+91 98765 43210"
                            required
                            pattern="[0-9+\-\s]{10,18}"
                            className="w-full border-b border-black/15 bg-transparent py-4 text-base outline-none transition placeholder:text-black/25 focus:border-black"
                          />

                        </Field>

                      </div>

                    </div>

                  )
                )}

                {/* ADD MEMBER */}

                {teamMembers.length <
                  maximumExtraMembers && (

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

            {/* AGREEMENT */}

            <label className="flex cursor-pointer items-start gap-3 border-t border-black/10 pt-8">

              <input
                type="checkbox"
                name="agreement"
                required
                className="mt-1 h-4 w-4 accent-black"
              />

              <span className="max-w-2xl text-sm leading-6 text-black/45">
                I confirm that the information
                provided above is correct and I agree
                to follow the official Saviskar event
                rules.
              </span>

            </label>

            {/* ERROR */}

            {errorMessage && (
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700">

                <AlertCircle size={18} />

                {errorMessage}

              </div>
            )}

            {/* SUBMIT */}

            <div className="flex justify-end pt-3">

              <button
                type="submit"
                disabled={
                  loading ||
                  eventsLoading ||
                  !selectedEventId
                }
                className="group flex min-w-[190px] items-center justify-center gap-3 rounded-full bg-black px-7 py-4 text-sm font-medium text-white transition-all hover:scale-[1.02] disabled:cursor-wait disabled:opacity-50"
              >

                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />

                    Registering
                  </>
                ) : (
                  <>
                    {isTeamEvent
                      ? "Register team"
                      : "Complete registration"}

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

/*
 * FIELD COMPONENT
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
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

function PassDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
        {label}
      </p>
      <p className="mt-2 break-words text-sm leading-6 text-white/80">
        {value}
      </p>
    </div>
  );
}

