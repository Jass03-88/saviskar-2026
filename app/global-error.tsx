"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f5f5f7",
          color: "#111",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#999",
              marginBottom: "1.5rem",
            }}
          >
            Saviskar 2026
          </p>

          <h1
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 600,
              letterSpacing: "-0.04em",
              margin: "0 0 1rem",
            }}
          >
            Something went wrong.
          </h1>

          <p
            style={{
              fontSize: "14px",
              color: "#777",
              maxWidth: "420px",
              margin: "0 auto 2rem",
              lineHeight: 1.7,
            }}
          >
            An unexpected error occurred. Please try again or refresh the page.
          </p>

          <button
            onClick={reset}
            style={{
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: "999px",
              padding: "14px 32px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "transform 0.15s",
            }}
            onMouseOver={(e) =>
              ((e.target as HTMLButtonElement).style.transform = "scale(1.03)")
            }
            onMouseOut={(e) =>
              ((e.target as HTMLButtonElement).style.transform = "scale(1)")
            }
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
