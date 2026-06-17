// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let shouldThrowError = false;

function BuggyComponent() {
  if (shouldThrowError) {
    throw new Error("Test crash");
  }
  return <div>Normal Content</div>;
}

describe("ErrorBoundary Component", () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // Silence console.error output from react and error boundary during expected crashes
    originalConsoleError = console.error;
    console.error = vi.fn();
    shouldThrowError = false;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    cleanup();
  });

  it("renders children normally when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div>All Good</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("All Good")).toBeInTheDocument();
  });

  it("catches errors and renders fallback error UI", () => {
    shouldThrowError = true;

    render(
      <ErrorBoundary>
        <BuggyComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.queryByText("Normal Content")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("resets boundary state and renders children when 'Try again' is clicked and bug is fixed", () => {
    shouldThrowError = true;

    render(
      <ErrorBoundary>
        <BuggyComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();

    // Now make the component healthy
    shouldThrowError = false;

    const tryAgainBtn = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(tryAgainBtn);

    expect(screen.getByText("Normal Content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });
});
