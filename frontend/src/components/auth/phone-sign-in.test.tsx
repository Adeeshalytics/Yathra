import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { PhoneCodeSent, User } from "@/lib/api/types";
import { readPhoneProof } from "@/lib/auth/phone-proof";

const auth = vi.hoisted(() => ({
  requestPhoneCode: vi.fn(),
  signInWithPhone: vi.fn(),
  login: vi.fn(),
}));
const authState = vi.hoisted(() => ({ status: "unauthenticated", user: null as User | null }));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, requestPhoneCode: auth.requestPhoneCode },
  };
});
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    ...authState,
    reason: null,
    isAuthenticated: false,
    signInWithPhone: auth.signInWithPhone,
    login: auth.login,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

import { LoginPanel } from "./login-panel";
import { PhoneSignIn } from "./phone-sign-in";

const SENT: PhoneCodeSent = {
  phone: "+94771234567",
  masked_phone: "+9477*****67",
  code_length: 6,
  expires_in: 300,
  resend_in: 60,
};

const NEW_CUSTOMER: User = {
  id: "user-9",
  name: "",
  email: null,
  phone: "+94771234567",
  phone_verified: true,
  has_password: false,
  role: "customer",
  is_active: true,
  created_at: "2030-09-01T09:00:00+05:30",
  updated_at: "2030-09-01T09:00:00+05:30",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function askForCode(person: ReturnType<typeof userEvent.setup>, phone = "077 123 4567") {
  await person.type(screen.getByLabelText("Mobile number"), phone);
  await person.click(screen.getByRole("button", { name: "Text me a code" }));
}

describe("PhoneSignIn", () => {
  beforeEach(() => {
    Object.values(auth).forEach((fn) => fn.mockReset());
    sessionStorage.clear();
  });

  it("checks the number before texting anything", async () => {
    const person = userEvent.setup();
    render(<PhoneSignIn />, { wrapper });

    await askForCode(person, "12");

    expect(await screen.findByText("Enter a valid mobile number, e.g. 077 123 4567.")).toBeInTheDocument();
    expect(auth.requestPhoneCode).not.toHaveBeenCalled();
  });

  it("texts a code, then signs in as soon as six digits are typed", async () => {
    const person = userEvent.setup();
    const onSignedIn = vi.fn();
    auth.requestPhoneCode.mockResolvedValue(SENT);
    auth.signInWithPhone.mockResolvedValue({ access: "token", user: NEW_CUSTOMER, created: true });
    render(<PhoneSignIn onSignedIn={onSignedIn} />, { wrapper });

    await askForCode(person);

    expect(auth.requestPhoneCode).toHaveBeenCalledWith("077 123 4567");
    expect(await screen.findByText("+9477*****67")).toBeInTheDocument();
    expect(screen.getByText(/ask again in \d+s/)).toBeInTheDocument();
    const code = screen.getByLabelText("6-digit code");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");

    await person.type(code, "12 34-56");

    await waitFor(() => expect(auth.signInWithPhone).toHaveBeenCalledWith("+94771234567", "123456"));
    expect(onSignedIn).toHaveBeenCalledWith(NEW_CUSTOMER, true);
  });

  it("says how many tries are left after a wrong code", async () => {
    const person = userEvent.setup();
    auth.requestPhoneCode.mockResolvedValue(SENT);
    auth.signInWithPhone.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "code_invalid",
        message: "That code isn’t right. You have 4 tries left.",
        details: { attempts_left: 4 },
      }),
    );
    render(<PhoneSignIn />, { wrapper });

    await askForCode(person);
    await person.type(await screen.findByLabelText("6-digit code"), "000000");

    expect(await screen.findByText("That code isn’t right. You have 4 tries left.")).toBeInTheDocument();
  });

  it("offers a new code straight away when the old one has expired", async () => {
    const person = userEvent.setup();
    auth.requestPhoneCode.mockResolvedValue(SENT);
    auth.signInWithPhone.mockRejectedValue(
      new ApiError({ status: 400, code: "code_expired", message: "This code has expired. Ask for a new one." }),
    );
    render(<PhoneSignIn />, { wrapper });

    await askForCode(person);
    await person.type(await screen.findByLabelText("6-digit code"), "123456");

    expect(await screen.findByText("This code has expired. Ask for a new one.")).toBeInTheDocument();
    await person.click(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(auth.requestPhoneCode).toHaveBeenCalledTimes(2));
  });

  it("explains a wait when codes are asked for too quickly", async () => {
    const person = userEvent.setup();
    auth.requestPhoneCode.mockRejectedValue(
      new ApiError({ status: 429, code: "throttled", message: "Too many requests.", details: { retry_after: 42 } }),
    );
    render(<PhoneSignIn />, { wrapper });

    await askForCode(person);

    expect(await screen.findByText("Please wait 42 seconds before asking for another code.")).toBeInTheDocument();
  });

  it("keeps the proof and points to email when the number has a password account", async () => {
    const person = userEvent.setup();
    auth.requestPhoneCode.mockResolvedValue(SENT);
    auth.signInWithPhone.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "password_required",
        message: "This number is already on an account with a password.",
        details: { phone_proof: "signed-proof" },
      }),
    );
    render(<PhoneSignIn emailSignInHref="/login?next=%2Ftrips%2Ftrip-1" />, { wrapper });

    await askForCode(person);
    await person.type(await screen.findByLabelText("6-digit code"), "123456");

    const link = await screen.findByRole("link", { name: "Sign in with your email" });
    expect(link).toHaveAttribute("href", "/login?next=%2Ftrips%2Ftrip-1");
    expect(readPhoneProof()).toEqual({ phone: "+94771234567", proof: "signed-proof" });
  });
});

describe("LoginPanel", () => {
  beforeEach(() => {
    Object.values(auth).forEach((fn) => fn.mockReset());
    sessionStorage.clear();
  });

  it("offers the phone first to customers", () => {
    render(<LoginPanel next="/trips/trip-1" />, { wrapper });

    expect(screen.getByRole("tab", { name: "Phone number" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Mobile number")).toBeInTheDocument();
  });

  it("opens on email for the operator and admin areas", () => {
    render(<LoginPanel next="/operator" />, { wrapper });

    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
  });

  it("finishes linking a proven phone with the password sign-in", async () => {
    const person = userEvent.setup();
    sessionStorage.setItem(
      "yathra:phone-proof",
      JSON.stringify({ phone: "+94771234567", proof: "signed-proof" }),
    );
    auth.login.mockResolvedValue({ ...NEW_CUSTOMER, name: "Kasuni", has_password: true });
    render(<LoginPanel />, { wrapper });

    expect(await screen.findByText(/\+94771234567 is on an account with a password/)).toBeInTheDocument();
    await person.type(screen.getByRole("textbox", { name: "Email" }), "kasuni@example.com");
    await person.type(screen.getByLabelText("Password"), "Str0ng-Test-Pass!");
    await person.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(auth.login).toHaveBeenCalledWith({
        email: "kasuni@example.com",
        password: "Str0ng-Test-Pass!",
        phone_proof: "signed-proof",
      }),
    );
    await waitFor(() => expect(readPhoneProof()).toBeNull());
  });
});
